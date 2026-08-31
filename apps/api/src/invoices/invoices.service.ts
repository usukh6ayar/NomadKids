import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, toSkipTake } from "../common/pagination";
import { InvoicesRepository } from "./invoices.repository";
import {
  invoiceNumberPrefix,
  invoiceTotals,
  lineFor,
  monthBounds,
  nextInvoiceNumber,
  statusFor,
  ZERO,
  type BillingCounts,
  type DraftLine,
  type Tariff,
} from "./invoice-math";
import type {
  CreateInvoiceDto,
  GenerateInvoicesDto,
  ListInvoicesQuery,
  RecordPaymentDto,
  ReversePaymentDto,
  UpdateInvoiceDto,
} from "./invoices.dto";

/**
 * Parent invoices and payments — `нэмэлт.md` §7, §8, §14.
 *
 * ★ Two audiences, two authorization paths, one service.
 *
 * An accountant reads every invoice in their kindergarten
 * (`TenantAccessService.canReadFinance`); a parent reads their own child's and
 * nobody else's (`ChildAccessService`). §13 is explicit that a **teacher** sees
 * neither — "Багш санхүүгийн бүрэн мэдээллийг харах эрхгүй" — which is why
 * `assertStaff` appears nowhere in this file.
 *
 * ★★ Every refusal is a 404, including a parent asking for another family's
 * invoice (CLAUDE.md §1.7). A 403 would confirm the invoice exists, and an
 * invoice's existence is itself information about a family.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly repo: InvoicesRepository,
    private readonly tenants: TenantAccessService,
    private readonly children: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  // ── Reading ────────────────────────────────────────────────────────────────

  /**
   * One kindergarten's invoices.
   *
   * Finance staff only. A parent reaches their own child's invoices through
   * `listForChild`, which authorizes on the child rather than the tenant — a
   * parent has no business paging through the kindergarten's billing.
   */
  async list(actor: Actor, kindergartenId: string, query: ListInvoicesQuery) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    const { skip, take } = toSkipTake(query);
    const { rows, total } = await this.repo.listInvoices({
      kindergartenId,
      month: query.month ? monthBounds(query.month).first : undefined,
      childId: query.childId,
      status: query.status,
      skip,
      take,
    });

    return paginate(rows.map(serialiseInvoice), total, query);
  }

  /**
   * One child's invoices — the parent's own view, and the finance tab on the
   * child profile (`нэмэлт.md` §10).
   *
   * ★ Authorized through `ChildAccessService`, which admits this child's
   * guardians, their assigned teacher and the kindergarten's admin. The teacher
   * is then **excluded again** below, because §13 says they may not see
   * finance. Going through the child check first is still right: it is the one
   * place that knows the guardian chain, and re-deriving it here would be the
   * second copy CLAUDE.md §1.1 forbids.
   */
  async listForChild(actor: Actor, childId: string, query: ListInvoicesQuery) {
    const facts = await this.children.assertCanAccess(actor, childId);
    const kindergartenId = kindergartenOf(facts);

    if (!this.mayReadChildFinance(actor, childId, kindergartenId, facts)) {
      throw new NotFoundException();
    }

    const { skip, take } = toSkipTake(query);
    const { rows, total } = await this.repo.listInvoices({
      kindergartenId,
      childId,
      month: query.month ? monthBounds(query.month).first : undefined,
      status: query.status,
      skip,
      take,
    });

    return paginate(rows.map(serialiseInvoice), total, query);
  }

  /** One invoice, with its lines and payments. */
  async findOne(actor: Actor, id: string) {
    const invoice = await this.repo.findInvoice(id);
    if (!invoice) throw new NotFoundException();

    await this.assertCanReadInvoice(actor, invoice.kindergartenId, invoice.childId);

    const paidAmount = await this.repo.paidTotal(id);

    return {
      ...serialiseInvoice(invoice),
      paidAmount: paidAmount.toFixed(2),
      balanceAmount: invoice.totalAmount.sub(paidAmount).toFixed(2),
      lines: invoice.lines.map((line) => ({
        id: line.id,
        kind: line.kind,
        label: line.label,
        quantity: line.quantity.toFixed(2),
        unitAmount: line.unitAmount.toFixed(2),
        amount: line.amount.toFixed(2),
        note: line.note,
      })),
      payments: invoice.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toFixed(2),
        method: payment.method,
        status: payment.status,
        paidAt: payment.paidAt,
        providerPaymentId: payment.providerPaymentId,
        isReversal: payment.reversalOfId !== null,
        note: payment.note,
        createdAt: payment.createdAt,
      })),
    };
  }

  // ── Issuing ────────────────────────────────────────────────────────────────

  /**
   * A month's invoices for every enrolled child — `нэмэлт.md` §7.
   *
   * ★ Runs inside the request, and that is a deliberate bound rather than an
   * oversight of CLAUDE.md §6. The work is three grouped queries plus one write
   * per child; for a kindergarten of a few hundred that is well under a second.
   * If a chain of kindergartens ever runs this across thousands of children it
   * belongs on BullMQ, and the note stays here so that decision is made with
   * the numbers rather than by drift.
   *
   * ★★ Children who already have a live invoice for the month are **skipped**,
   * not overwritten. Re-running after fixing one child's attendance must not
   * silently reissue documents families have already been sent.
   */
  async generate(actor: Actor, kindergartenId: string, dto: GenerateInvoicesDto) {
    this.tenants.assertCanManageFinance(actor, kindergartenId);

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
    const attended = new Map(inputs.attendance.map((row) => [row.childId, row._count._all]));
    const wanted = dto.childIds ? new Set(dto.childIds) : null;

    const created: unknown[] = [];
    const skipped: { childId: string; reason: string }[] = [];

    // Sequential on purpose: each invoice reads the previous number and the
    // child's outstanding balance, and running them in parallel would race on
    // both. A month's billing is not a hot path.
    for (const enrollment of inputs.enrollments) {
      const childId = enrollment.childId;
      if (wanted && !wanted.has(childId)) continue;

      const existing = await this.repo.findLiveInvoiceFor(childId, first);
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

      const invoice = await this.issue({
        actor,
        kindergartenId,
        childId,
        month: first,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        discountAmount: ZERO,
        note: null,
        lines,
      });

      created.push(invoice);
    }

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Invoice",
      metadata: { month: dto.month, created: created.length, skipped: skipped.length },
    });

    return { month: dto.month, created, skipped };
  }

  /** One invoice, typed in by hand. */
  async create(actor: Actor, kindergartenId: string, dto: CreateInvoiceDto) {
    this.tenants.assertCanManageFinance(actor, kindergartenId);

    /*
     * ★ The child must be enrolled **here**, or an accountant could bill
     * another kindergarten's child by supplying their id.
     *
     * This asks the tenancy question directly rather than going through
     * `ChildAccessService`. That service answers "may this person read the
     * child's developmental record", and `нэмэлт.md` §13 says an accountant may
     * not — so an accountant creating a legitimate invoice was refused by it.
     * The first version of this method called it anyway and the integration
     * suite caught it: `a hand-written invoice > totals the lines` returned 404
     * for the accountant who is the whole point of the role.
     *
     * Widening `canAccessChild` to admit accountants would have made the test
     * pass and handed them every observation in the kindergarten.
     */
    if (!(await this.repo.isEnrolledIn(dto.childId, kindergartenId))) {
      throw new NotFoundException();
    }

    const { first } = monthBounds(dto.month);

    const existing = await this.repo.findLiveInvoiceFor(dto.childId, first);
    if (existing) {
      throw new ConflictException(
        `Энэ сард ${existing.number} дугаартай нэхэмжлэл аль хэдийн байна`,
      );
    }

    const lines: DraftLine[] = dto.lines.map((line) => {
      const quantity = new Decimal(line.quantity);
      const unitAmount = new Decimal(line.unitAmount);
      return {
        kind: line.kind,
        label: line.label,
        quantity,
        unitAmount,
        amount: unitAmount.mul(quantity),
        fundingRuleId: "",
      };
    });

    return this.issue({
      actor,
      kindergartenId,
      childId: dto.childId,
      month: first,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      discountAmount: dto.discountAmount ? new Decimal(dto.discountAmount) : ZERO,
      note: dto.note ?? null,
      lines,
    });
  }

  /**
   * The one place an invoice is written.
   *
   * ★ Both entry points funnel through here so that the number allocation, the
   * carried balance and the totals are computed once. Two code paths that each
   * "just" build an invoice is how two different totals for one month appear.
   */
  private async issue(input: {
    actor: Actor;
    kindergartenId: string;
    childId: string;
    month: Date;
    dueDate: Date | null;
    discountAmount: Decimal;
    note: string | null;
    lines: DraftLine[];
  }) {
    const year = input.month.getUTCFullYear();
    const last = await this.repo.lastInvoiceNumber(input.kindergartenId, invoiceNumberPrefix(year));

    // Өмнөх үлдэгдэл — what this family still owed before this month.
    const outstanding = await this.repo.outstandingFor(input.childId, input.month);
    const carried = outstanding.billed.sub(outstanding.paid);
    const previousBalance = carried.isPositive() ? carried : ZERO;

    const totals = invoiceTotals({
      lines: input.lines,
      discountAmount: input.discountAmount,
      previousBalance,
    });

    const invoice = await this.repo.createInvoice({
      kindergarten: { connect: { id: input.kindergartenId } },
      child: { connect: { id: input.childId } },
      month: input.month,
      number: nextInvoiceNumber(year, last?.number ?? null),
      dueDate: input.dueDate,
      discountAmount: input.discountAmount,
      previousBalance,
      subtotalAmount: totals.subtotalAmount,
      totalAmount: totals.totalAmount,
      note: input.note,
      // Issued immediately: a draft state exists in the schema for a future
      // review step, and creating everything as a draft that nothing ever
      // issues would be a state machine with an unreachable end.
      issuedAt: new Date(),
      createdBy: { connect: { id: input.actor.userId } },
      lines: {
        create: input.lines.map((line) => ({
          kindergartenId: input.kindergartenId,
          kind: line.kind,
          label: line.label,
          quantity: line.quantity,
          unitAmount: line.unitAmount,
          amount: line.amount,
          ...(line.fundingRuleId ? { fundingRule: { connect: { id: line.fundingRuleId } } } : {}),
        })),
      },
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: input.kindergartenId,
      actorUserId: input.actor.userId,
      objectType: "Invoice",
      objectId: invoice.id,
      childId: input.childId,
      metadata: {
        number: invoice.number,
        month: invoice.month.toISOString().slice(0, 10),
        totalAmount: invoice.totalAmount.toFixed(2),
      },
    });

    return serialiseInvoice(invoice);
  }

  /** Editing the due date, discount or note — never the lines or the child. */
  async update(actor: Actor, id: string, dto: UpdateInvoiceDto) {
    const facts = await this.repo.invoiceFacts(id);
    if (!facts) throw new NotFoundException();
    this.tenants.assertCanManageFinance(actor, facts.kindergartenId);

    const current = await this.repo.findInvoice(id);
    if (!current) throw new NotFoundException();

    const discountAmount =
      dto.discountAmount !== undefined ? new Decimal(dto.discountAmount) : current.discountAmount;

    const totals = invoiceTotals({
      lines: current.lines,
      discountAmount,
      previousBalance: current.previousBalance,
    });

    const paidAmount = await this.repo.paidTotal(id);
    const dueDate = dto.dueDate !== undefined ? toDateOrNull(dto.dueDate) : current.dueDate;

    const saved = await this.repo.updateInvoice(id, {
      ...(dto.dueDate !== undefined ? { dueDate } : {}),
      ...(dto.discountAmount !== undefined
        ? { discountAmount, subtotalAmount: totals.subtotalAmount, totalAmount: totals.totalAmount }
        : {}),
      ...(dto.note !== undefined ? { note: dto.note } : {}),
      status: statusFor({
        totalAmount: totals.totalAmount,
        paidAmount,
        dueDate,
        now: new Date(),
        current: current.status,
      }),
    });

    // §14 names "Invoice зассан" as an event that must be recorded, with the
    // old value beside the new one.
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: facts.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Invoice",
      objectId: id,
      childId: facts.childId,
      metadata: {
        fields: Object.keys(dto),
        previous: {
          discountAmount: current.discountAmount.toFixed(2),
          totalAmount: current.totalAmount.toFixed(2),
          dueDate: current.dueDate?.toISOString().slice(0, 10) ?? null,
        },
        next: {
          discountAmount: saved.discountAmount.toFixed(2),
          totalAmount: saved.totalAmount.toFixed(2),
          dueDate: saved.dueDate?.toISOString().slice(0, 10) ?? null,
        },
      },
    });

    return serialiseInvoice(saved);
  }

  /**
   * Voiding an invoice.
   *
   * ★ Refused once money has been received against it. §14's rule — a confirmed
   * transaction is corrected, never removed — is about payments, and voiding
   * the invoice a payment points at would strand the money: the ledger would
   * hold a `PAID` row whose invoice no report can find. The accountant reverses
   * the payment first, which is a decision they have to make explicitly.
   */
  async remove(actor: Actor, id: string) {
    const facts = await this.repo.invoiceFacts(id);
    if (!facts) throw new NotFoundException();
    this.tenants.assertCanManageFinance(actor, facts.kindergartenId);

    const paidAmount = await this.repo.paidTotal(id);
    if (!paidAmount.isZero()) {
      throw new ConflictException(
        "Төлбөр хийгдсэн нэхэмжлэлийг устгах боломжгүй. Эхлээд төлбөрийг буцаана уу.",
      );
    }

    await this.repo.softDeleteInvoice(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: facts.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Invoice",
      objectId: id,
      childId: facts.childId,
      metadata: { totalAmount: facts.totalAmount.toFixed(2) },
    });

    return { id };
  }

  // ── Payments ───────────────────────────────────────────────────────────────

  /**
   * Money received outside a payment provider — cash, a bank transfer read off
   * a statement. `нэмэлт.md` §8.
   */
  async recordPayment(actor: Actor, invoiceId: string, dto: RecordPaymentDto) {
    const facts = await this.repo.invoiceFacts(invoiceId);
    if (!facts) throw new NotFoundException();
    this.tenants.assertCanManageFinance(actor, facts.kindergartenId);

    const amount = new Decimal(dto.amount);
    if (amount.isZero()) throw new BadRequestException("Дүн тэг байж болохгүй");

    const payment = await this.repo.createPayment({
      kindergarten: { connect: { id: facts.kindergartenId } },
      invoice: { connect: { id: invoiceId } },
      amount,
      method: dto.method,
      // A manually entered payment is money the accountant is asserting has
      // already arrived — there is no provider to confirm it later.
      status: "PAID",
      paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      note: dto.note ?? null,
      recordedBy: { connect: { id: actor.userId } },
    });

    await this.refreshStatus(invoiceId);

    await this.audit.append({
      action: "CREATE",
      kindergartenId: facts.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Payment",
      objectId: payment.id,
      childId: facts.childId,
      metadata: { invoiceId, amount: amount.toFixed(2), method: dto.method },
    });

    return serialisePayment(payment);
  }

  /**
   * Reversing a confirmed payment — `нэмэлт.md` §14.
   *
   * > "Баталгаажсан санхүүгийн гүйлгээг шууд устгахгүй. Залруулга эсвэл
   * > reversal transaction ашиглана."
   *
   * ★ Writes a **new row** carrying the negative amount and `reversalOfId`. The
   * original is never touched, so the ledger keeps both the mistake and the
   * correction, and an invoice's paid total falls out of the arithmetic rather
   * than needing a second code path that knows about reversals.
   *
   * ★★ One reversal per payment. Reversing a reversal, or reversing the same
   * payment twice, would credit the invoice in the wrong direction — and the
   * accountant who wants that outcome wants a new payment, not a second
   * correction of an old one.
   */
  async reversePayment(actor: Actor, paymentId: string, dto: ReversePaymentDto) {
    const payment = await this.repo.findPayment(paymentId);
    if (!payment) throw new NotFoundException();
    this.tenants.assertCanManageFinance(actor, payment.kindergartenId);

    if (payment.status !== "PAID") {
      throw new ConflictException("Зөвхөн баталгаажсан төлбөрийг буцаана");
    }
    if (payment.reversalOfId !== null) {
      throw new ConflictException("Буцаалтын гүйлгээг дахин буцаах боломжгүй");
    }

    const already = await this.repo.findReversalOf(paymentId);
    if (already) throw new ConflictException("Энэ төлбөр аль хэдийн буцаагдсан байна");

    const facts = await this.repo.invoiceFacts(payment.invoiceId);

    const reversal = await this.repo.createPayment({
      kindergarten: { connect: { id: payment.kindergartenId } },
      invoice: { connect: { id: payment.invoiceId } },
      amount: payment.amount.neg(),
      method: payment.method,
      status: "PAID",
      paidAt: new Date(),
      note: dto.reason,
      recordedBy: { connect: { id: actor.userId } },
      reversalOf: { connect: { id: paymentId } },
    });

    await this.refreshStatus(payment.invoiceId);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: payment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Payment",
      objectId: reversal.id,
      childId: facts?.childId ?? null,
      metadata: {
        reversalOf: paymentId,
        invoiceId: payment.invoiceId,
        previous: { amount: payment.amount.toFixed(2) },
        next: { amount: reversal.amount.toFixed(2) },
        reason: dto.reason,
      },
    });

    return serialisePayment(reversal);
  }

  /**
   * Recomputes an invoice's status from what has actually been received.
   *
   * Called after every payment write. The status is derived rather than set so
   * that the invoice screen and the overdue report cannot disagree — see
   * `statusFor`.
   */
  private async refreshStatus(invoiceId: string) {
    const facts = await this.repo.invoiceFacts(invoiceId);
    if (!facts) return;

    const paidAmount = await this.repo.paidTotal(invoiceId);
    const invoice = await this.repo.findInvoice(invoiceId);
    if (!invoice) return;

    await this.repo.updateInvoice(invoiceId, {
      status: statusFor({
        totalAmount: invoice.totalAmount,
        paidAmount,
        dueDate: invoice.dueDate,
        now: new Date(),
        current: invoice.status,
      }),
    });
  }

  // ── Authorization helpers ──────────────────────────────────────────────────

  /**
   * May this actor read this invoice?
   *
   * Finance staff of the kindergarten, or one of the child's own guardians.
   * A teacher assigned to the child's group passes `canAccessChild` and is
   * still refused here — §13.
   */
  private async assertCanReadInvoice(actor: Actor, kindergartenId: string, childId: string) {
    if (this.tenants.canReadFinance(actor, kindergartenId)) return;

    const facts = await this.children.assertCanAccess(actor, childId);
    if (!this.mayReadChildFinance(actor, childId, kindergartenId, facts)) {
      throw new NotFoundException();
    }
  }

  /**
   * The guardian half of the rule above.
   *
   * ★ Checks guardianship directly rather than trusting that
   * `canAccessChild` passed: that predicate also admits assigned teachers, and
   * §13 excludes them from finance. Reading the fact off the same
   * `ChildAccessFacts` the authorization service loaded keeps the decision on
   * `authz/`'s data without a second query.
   */
  private mayReadChildFinance(
    actor: Actor,
    _childId: string,
    kindergartenId: string,
    facts: { guardianships: readonly { guardianUserId: string; canView: boolean }[] },
  ): boolean {
    if (this.tenants.canReadFinance(actor, kindergartenId)) return true;

    return facts.guardianships.some((g) => g.guardianUserId === actor.userId && g.canView);
  }
}

/** The kindergarten an invoice's child belongs to, from the access facts. */
function kindergartenOf(facts: {
  childKindergartenId: string;
  enrollments: readonly { kindergartenId: string }[];
}): string {
  return facts.enrollments[0]?.kindergartenId ?? facts.childKindergartenId;
}

function appliesToBand(tariff: Tariff, ageBand: string | null): boolean {
  // A rule with no age band applies to everyone — `FundingRule.ageBand` says so.
  return tariff.ageBand === null || tariff.ageBand === ageBand;
}

function toTariff(rule: {
  id: string;
  name: string;
  invoiceItemKind: string | null;
  ageBand: string | null;
  dailyRate: Decimal | null;
  monthlyRate: Decimal | null;
  dependsOnAttendance: boolean;
  dependsOnMeals: boolean;
}): Tariff {
  return {
    id: rule.id,
    name: rule.name,
    // Guarded by the repository query, which filters `invoiceItemKind: { not: null }`.
    invoiceItemKind: rule.invoiceItemKind as Tariff["invoiceItemKind"],
    ageBand: rule.ageBand,
    dailyRate: rule.dailyRate,
    monthlyRate: rule.monthlyRate,
    dependsOnAttendance: rule.dependsOnAttendance,
    dependsOnMeals: rule.dependsOnMeals,
  };
}

function toDateOrNull(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

/**
 * Money leaves this service as a **decimal string**, never a number.
 *
 * `JSON.stringify` turns a `Decimal` into an object, and coercing one to
 * a number reintroduces the float error the whole module avoids. `toFixed(2)`
 * is the wire format the web app already parses for funding.
 */
function serialiseInvoice(invoice: {
  id: string;
  childId: string;
  month: Date;
  number: string;
  status: string;
  subtotalAmount: Decimal;
  discountAmount: Decimal;
  previousBalance: Decimal;
  totalAmount: Decimal;
  dueDate: Date | null;
  issuedAt: Date | null;
  note: string | null;
  child?: { id: string; lastName: string; firstName: string };
}) {
  return {
    id: invoice.id,
    childId: invoice.childId,
    child: invoice.child ?? null,
    month: invoice.month.toISOString().slice(0, 7),
    number: invoice.number,
    status: invoice.status,
    subtotalAmount: invoice.subtotalAmount.toFixed(2),
    discountAmount: invoice.discountAmount.toFixed(2),
    previousBalance: invoice.previousBalance.toFixed(2),
    totalAmount: invoice.totalAmount.toFixed(2),
    dueDate: invoice.dueDate,
    issuedAt: invoice.issuedAt,
    note: invoice.note,
  };
}

function serialisePayment(payment: {
  id: string;
  amount: Decimal;
  method: string;
  status: string;
  paidAt: Date | null;
  providerPaymentId: string | null;
  reversalOfId: string | null;
  note: string | null;
  createdAt: Date;
}) {
  return {
    id: payment.id,
    amount: payment.amount.toFixed(2),
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt,
    providerPaymentId: payment.providerPaymentId,
    isReversal: payment.reversalOfId !== null,
    note: payment.note,
    createdAt: payment.createdAt,
  };
}
