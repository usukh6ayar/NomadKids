import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import { ChildAccessService } from "../authz/child-access.service";
import type { Actor } from "../authz/actor";
import { paginate, toSkipTake, type PageParams } from "../common/pagination";
import {
  invoiceNumberPrefix,
  lineFor,
  monthBounds,
  nextInvoiceNumber,
  type BillingCounts,
  type DraftLine,
  type Tariff,
} from "./invoice-math";
import { InvoicesRepository } from "./invoices.repository";
import type {
  GenerateInvoiceDto,
  GenerateMonthDto,
  ListInvoicesQuery,
  MarkRefundedDto,
  RecordPaymentDto,
  UpdateInvoiceDto,
  VoidPaymentDto,
} from "./invoices.dto";

const EXTRA_LINE_TYPES = new Set(["CLUB", "BUS", "EXTRA", "OTHER"]);

/** Shared zero, so no call site builds one from a literal number. */
const ZERO = new Decimal(0);

@Injectable()
export class InvoicesService {
  constructor(
    private readonly repo: InvoicesRepository,
    private readonly tenants: TenantAccessService,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * One child's own invoices — the guardian-facing read, нэмэлт.md §7/§10.
   *
   * ★ `assertCanViewFinance`, not `assertCanReadFinance` — a different
   * predicate on purpose. The kindergarten-wide list above is for the
   * accountant and the admin; this one additionally admits the child's own
   * guardian and, unlike every other route in this file, deliberately does
   * NOT admit a teacher even though a teacher may otherwise read this child's
   * record — see `canViewChildFinance`'s own comment.
   */
  async listForChild(actor: Actor, childId: string, query: ListInvoicesQuery) {
    await this.childAccess.assertCanViewFinance(actor, childId);

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.listForChild(childId, toSkipTake(page));

    return paginate(items, total, page);
  }

  /**
   * ★ The accountant and the administrator, throughout this service — the
   * same `assertCanReadFinance` predicate `FundingService` uses, on purpose.
   * That service already treats the name as "may touch finance," not
   * narrowly "may read"; a second predicate that said the same thing under a
   * different name would be a distinction with no difference.
   */
  async list(actor: Actor, kindergartenId: string, query: ListInvoicesQuery) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.listInvoices(
      kindergartenId,
      {
        month: query.month ? toMonthDate(query.month) : undefined,
        childId: query.childId,
        status: query.status,
        q: query.q,
      },
      toSkipTake(page),
    );

    return paginate(items, total, page);
  }

  async get(actor: Actor, id: string) {
    const ref = await this.repo.findInvoiceRef(id);
    if (!ref) throw new NotFoundException();
    this.tenants.assertCanReadFinance(actor, ref.kindergartenId);

    return this.repo.findInvoice(id);
  }

  /**
   * Generates (or regenerates) one child's invoice for one month —
   * нэмэлт.md §7.
   *
   * ★ `previousBalance` is read, never re-entered — нэмэлт.md §17's
   * single-entry principle applied to billing. The four frozen summary
   * columns are computed once, here, and never recalculated on read
   * (`FINANCE_SCOPE.md` §4.3 — the same rule `FundingCalculation` already
   * follows for the state's side of the ledger).
   *
   * ★★ Regenerating an invoice that already has money against it is refused.
   * `нэмэлт.md` §14: a confirmed financial transaction gets a correction or a
   * reversal, not a bill quietly rewritten underneath it.
   */
  async generate(actor: Actor, kindergartenId: string, dto: GenerateInvoiceDto) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    const month = toMonthDate(dto.month);
    const dueDate = toDate(dto.dueDate);

    // ★ The arithmetic is `decimal.js`, never JS numbers, and every money
    // field is then forced through `.toFixed(2)` before it reaches Prisma.
    //
    // Two separate reasons, both load-bearing. Precision: a month's bill is a
    // sum of many lines and `0.1 + 0.2 !== 0.3`, so a float error surfaces
    // where it costs most — reconciling against a bank statement, where one
    // tögrög of drift casts doubt on every figure beside it. Formatting: a
    // `Decimal` built from a bare number carries no decimal places of its own,
    // so a sibling field built from a padded string would round-trip as
    // "150000.00" while this one came back as "150000", and two fields on one
    // invoice would disagree about how many decimals a tögrög has.
    const base = sumLines(dto.lineItems, (t) => t === "TUITION");
    const meal = sumLines(dto.lineItems, (t) => t === "MEAL");
    const extra = sumLines(dto.lineItems, (t) => EXTRA_LINE_TYPES.has(t));
    const discount = new Decimal(dto.discountAmount ?? "0");

    const previous = await this.repo.findLastInvoiceForChild(dto.childId, month);
    // `previous.balance` is a `Prisma.Decimal`; it crosses into decimal.js by
    // string rather than by `.toNumber()`, which keeps this service clear of
    // both a float and a `Prisma.Decimal` import (CLAUDE.md §2.2).
    const previousBalance = previous ? new Decimal(previous.balance.toString()) : ZERO;

    const totalDueValue = base.plus(meal).plus(extra).plus(previousBalance).minus(discount);

    const baseAmount = base.toFixed(2);
    const mealAmount = meal.toFixed(2);
    const extraAmount = extra.toFixed(2);
    const discountAmount = discount.toFixed(2);
    const totalDue = totalDueValue.toFixed(2);
    const previousBalanceAmount = previousBalance.toFixed(2);

    const lineItems = dto.lineItems.map((line) => ({
      type: line.type,
      description: line.description ?? null,
      amount: line.amount,
    }));

    const existing = await this.repo.findByChildAndMonth(dto.childId, month);

    if (existing) {
      if (!new Decimal(existing.paidAmount.toString()).isZero()) {
        throw new BadRequestException(
          "Энэ сарын нэхэмжлэлд төлбөр бүртгэгдсэн тул дахин үүсгэх боломжгүй. Хөнгөлөлт эсвэл засвар хэрэгтэй бол зөвхөн тэмдэглэл, төлөх хугацааг өөрчилнө үү.",
        );
      }

      const before = {
        baseAmount: existing.baseAmount.toString(),
        mealAmount: existing.mealAmount.toString(),
        extraAmount: existing.extraAmount.toString(),
        discountAmount: existing.discountAmount.toString(),
        totalDue: existing.totalDue.toString(),
      };

      const updated = await this.repo.replaceInvoice(
        existing.id,
        {
          baseAmount,
          mealAmount,
          extraAmount,
          discountAmount,
          previousBalance: previousBalanceAmount,
          totalDue,
          dueDate,
          note: dto.note ?? null,
          balance: totalDue,
          status: "UNPAID",
        },
        lineItems,
      );

      await this.audit.append({
        action: "UPDATE",
        kindergartenId,
        actorUserId: actor.userId,
        objectType: "Invoice",
        objectId: updated.id,
        childId: dto.childId,
        metadata: {
          before,
          after: { baseAmount, mealAmount, extraAmount, discountAmount, totalDue },
        },
      });

      return updated;
    }

    // ★ Numbered only on creation. A regenerate above keeps the number the
    // family was already given — a bill that changes its reference between the
    // day it is issued and the day it is paid cannot be matched to a transfer.
    const year = month.getUTCFullYear();
    const last = await this.repo.lastInvoiceNumber(kindergartenId, invoiceNumberPrefix(year));
    const number = nextInvoiceNumber(year, last?.number ?? null);

    const created = await this.repo.createInvoice(
      {
        kindergartenId,
        childId: dto.childId,
        month,
        number,
        baseAmount,
        mealAmount,
        extraAmount,
        discountAmount,
        previousBalance: previousBalanceAmount,
        totalDue,
        balance: totalDue,
        dueDate,
        note: dto.note ?? null,
      },
      lineItems,
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Invoice",
      objectId: created.id,
      childId: dto.childId,
      metadata: { after: { baseAmount, mealAmount, extraAmount, discountAmount, totalDue } },
    });

    return created;
  }

  /**
   * A whole month's invoices, generated from the `PARENT` tariffs —
   * `нэмэлт.md` §3, §7.
   *
   * ★ **Why this exists beside `generate`.** `generate` bills one child from
   * lines somebody typed. That is the right shape for a correction, and the
   * wrong shape for a month: a forty-child kindergarten would be forty requests
   * and forty chances to mistype a rate that is already recorded in
   * `FundingRule`. This route reads the rules and the month's attendance and
   * meal-day counts and produces the lines itself.
   *
   * ★★ Sequential, deliberately. Each invoice reads the child's previous
   * balance, and running them in parallel would race on it. A month's billing
   * is not a hot path — it happens once.
   *
   * ★★★ An existing invoice for the month is **skipped, never overwritten**.
   * `generate` refuses to rewrite a bill with money against it (`нэмэлт.md`
   * §14); a bulk run is the last place that judgement should be made
   * implicitly, so it declines to touch any month a child already has and says
   * which ones it left alone.
   */
  async generateMonth(actor: Actor, kindergartenId: string, dto: GenerateMonthDto) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    const { from, to, first } = monthBounds(dto.month);
    const [tariffRows, inputs] = await Promise.all([
      this.repo.parentTariffsInForce(kindergartenId, to),
      this.repo.billingInputs(kindergartenId, from, to),
    ]);

    if (tariffRows.length === 0) {
      // The rule table ships empty by `нэмэлт.md` §4's own instruction, so this
      // is the expected first-run state and deserves a sentence an
      // administrator can act on rather than an empty result.
      throw new BadRequestException(
        "Эцэг эхийн төлбөрийн тариф тохируулаагүй байна. Санхүүжилтийн дүрэм дээр эхлээд тариф үүсгэнэ үү.",
      );
    }

    const tariffs = tariffRows.map(toTariff);
    const attended = new Map(inputs.attendance.map((row) => [row.childId, row._count?._all ?? 0]));
    const wanted = dto.childIds ? new Set(dto.childIds) : null;

    const created: string[] = [];
    const skipped: { childId: string; reason: "already_invoiced" | "nothing_to_bill" }[] = [];

    for (const enrollment of inputs.enrollments) {
      const childId = enrollment.childId;
      if (wanted && !wanted.has(childId)) continue;

      const existing = await this.repo.findByChildAndMonth(childId, first);
      if (existing) {
        skipped.push({ childId, reason: "already_invoiced" });
        continue;
      }

      const counts: BillingCounts = {
        daysAttended: attended.get(childId) ?? 0,
        daysFed: inputs.fedDays.get(childId) ?? 0,
      };

      const lines = tariffs
        .filter((tariff) => appliesToBand(tariff, enrollment.group?.ageBand ?? null))
        .map((tariff) => lineFor(tariff, counts))
        .filter((line): line is DraftLine => line !== null);

      if (lines.length === 0) {
        skipped.push({ childId, reason: "nothing_to_bill" });
        continue;
      }

      const invoice = await this.generate(actor, kindergartenId, {
        childId,
        month: dto.month,
        dueDate: dto.dueDate,
        // ★ The surviving line model carries `description` and `amount` but no
        // quantity or unit rate, so "20 өдөр × 3,500₮" is written into the text
        // a parent reads rather than held as two columns. It is the one thing
        // lost in the merge that a family would actually notice, so it is
        // spelled out here rather than dropped.
        lineItems: lines.map((line) => ({
          type: line.kind,
          description: line.quantity.equals(1)
            ? line.label
            : `${line.label} — ${line.quantity.toFixed(0)} × ${line.unitAmount.toFixed(2)}₮`,
          amount: line.amount.toFixed(2),
        })),
      });

      created.push(invoice.id);
    }

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Invoice",
      objectId: kindergartenId,
      metadata: { month: dto.month, created: created.length, skipped },
    });

    return { created: created.length, invoiceIds: created, skipped };
  }

  async update(actor: Actor, id: string, dto: UpdateInvoiceDto) {
    const ref = await this.repo.findInvoiceRef(id);
    if (!ref) throw new NotFoundException();
    this.tenants.assertCanReadFinance(actor, ref.kindergartenId);

    const data: Record<string, unknown> = {};
    if (dto.dueDate !== undefined) data.dueDate = toDate(dto.dueDate);
    if (dto.note !== undefined) data.note = dto.note;

    const updated = await this.repo.updateInvoice(id, data);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: ref.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Invoice",
      objectId: id,
      childId: ref.childId,
      metadata: { after: data },
    });

    return updated;
  }

  /** Only a never-paid invoice can be removed — see the model's own comment. */
  async remove(actor: Actor, id: string) {
    const ref = await this.repo.findInvoiceRef(id);
    if (!ref) throw new NotFoundException();
    this.tenants.assertCanReadFinance(actor, ref.kindergartenId);

    if (!new Decimal(ref.paidAmount.toString()).isZero()) {
      throw new BadRequestException(
        "Төлбөр орсон нэхэмжлэлийг устгах боломжгүй. Буцаалт бол төлбөрийг цуцлана уу.",
      );
    }

    await this.repo.softDeleteInvoice(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: ref.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Invoice",
      objectId: id,
      childId: ref.childId,
    });

    return { id };
  }

  // ── Payments — нэмэлт.md §7/§8's non-gateway half ───────────────────────────

  /**
   * A manual payment — cash in person or a reported bank transfer.
   *
   * QPAY/SOCIALPAY are excluded at the DTO level (`recordPaymentSchema`), not
   * here — see that file's comment for why a person typing "QPay" into a form
   * is not the same fact as a gateway confirming one.
   */
  async recordPayment(actor: Actor, invoiceId: string, dto: RecordPaymentDto) {
    const ref = await this.repo.findInvoiceRef(invoiceId);
    if (!ref) throw new NotFoundException();
    this.tenants.assertCanReadFinance(actor, ref.kindergartenId);

    const { payment, invoice } = await this.repo.recordPayment(invoiceId, {
      kindergartenId: ref.kindergartenId,
      invoiceId,
      amount: new Decimal(dto.amount).toFixed(2),
      method: dto.method,
      recordedById: actor.userId,
      note: dto.note ?? null,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: ref.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Payment",
      objectId: payment.id,
      childId: ref.childId,
      metadata: { after: { invoiceId, amount: dto.amount, method: dto.method } },
    });

    return invoice;
  }

  /**
   * Cancelling a payment — a reversal row, never a delete. See the `Payment`
   * model's own comment and нэмэлт.md §14.
   */
  async voidPayment(actor: Actor, paymentId: string, dto: VoidPaymentDto) {
    const payment = await this.repo.findPayment(paymentId);
    if (!payment) throw new NotFoundException();
    this.tenants.assertCanReadFinance(actor, payment.kindergartenId);
    if (payment.voidedAt || payment.reversalOfId) throw new NotFoundException();

    const invoiceRef = await this.repo.findInvoiceRef(payment.invoiceId);

    const { reversal, invoice } = await this.repo.voidPayment(
      paymentId,
      dto.note ?? null,
      actor.userId,
    );

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: payment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Payment",
      objectId: payment.id,
      childId: invoiceRef?.childId ?? null,
      metadata: {
        before: { voidedAt: null },
        after: { voidedAt: reversal.createdAt.toISOString(), reversalId: reversal.id },
      },
    });

    return invoice;
  }

  /**
   * A person's call, not a computed one — see `InvoicesRepository`'s own
   * comment on why `recomputeTotals` never writes this status itself.
   */
  async markRefunded(actor: Actor, invoiceId: string, dto: MarkRefundedDto) {
    const ref = await this.repo.findInvoiceRef(invoiceId);
    if (!ref) throw new NotFoundException();
    this.tenants.assertCanReadFinance(actor, ref.kindergartenId);

    const before = ref.status;
    const updated = await this.repo.setStatus(invoiceId, "REFUNDED");

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: ref.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Invoice",
      objectId: invoiceId,
      childId: ref.childId,
      metadata: {
        before: { status: before },
        after: { status: "REFUNDED", note: dto.note ?? null },
      },
    });

    return updated;
  }
}

/** A rule with no age band applies to everyone — `FundingRule.ageBand` says so. */
function appliesToBand(tariff: Tariff, ageBand: string | null): boolean {
  return tariff.ageBand === null || tariff.ageBand === ageBand;
}

/**
 * A `FundingRule` row as the arithmetic sees it. `invoiceItemKind` is non-null
 * by the time this runs — `parentTariffsInForce` filters on it — but the column
 * is nullable for the rules that never bill a parent, so the cast is where that
 * guarantee is stated.
 */
function toTariff(rule: {
  id: string;
  name: string;
  invoiceItemKind: string | null;
  ageBand: string | null;
  dailyRate: { toString(): string } | null;
  monthlyRate: { toString(): string } | null;
  dependsOnAttendance: boolean;
  dependsOnMeals: boolean;
}): Tariff {
  return {
    id: rule.id,
    name: rule.name,
    invoiceItemKind: rule.invoiceItemKind as Tariff["invoiceItemKind"],
    ageBand: rule.ageBand,
    dailyRate: rule.dailyRate ? new Decimal(rule.dailyRate.toString()) : null,
    monthlyRate: rule.monthlyRate ? new Decimal(rule.monthlyRate.toString()) : null,
    dependsOnAttendance: rule.dependsOnAttendance,
    dependsOnMeals: rule.dependsOnMeals,
  };
}

function sumLines(
  lineItems: { type: string; amount: string }[],
  matches: (type: string) => boolean,
): Decimal {
  return lineItems
    .filter((l) => matches(l.type))
    .reduce((sum, l) => sum.plus(new Decimal(l.amount)), ZERO);
}

/** `YYYY-MM` to its first day, in UTC — matches `funding.service.ts`'s own `monthBounds`. */
function toMonthDate(month: string): Date {
  const [year, monthNum] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, monthNum - 1, 1));
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
