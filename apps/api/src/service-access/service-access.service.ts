import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  GROUP_PRICES,
  groupTermPrice,
  localDate,
  schoolTermOn,
  type SchoolTerm,
} from "@kinder/contracts";
import Decimal from "decimal.js";
import { AuditRepository } from "../audit/audit.repository";
import type { Actor } from "../authz/actor";
import { TenantAccessService } from "../authz/tenant-access.service";
import { loadEnv } from "../config/env";
import { QpayService } from "../integrations/qpay/qpay.service";
import type { ServiceInvoiceParams } from "../reports/report-params";
import { ReportsQueue } from "../reports/reports.queue";
import { ReportsRepository } from "../reports/reports.repository";
import { StorageService } from "../storage/storage.service";
import { ServiceAccessRepository } from "./service-access.repository";

/** The red «1» on «Үйлчилгээний эрх» — the user, 2026-10-12. */
export const REMIND_DAYS = 14;
const MONTHS = { TERM: 3, YEAR: 9 } as const;
const DOWNLOAD_TTL_SECONDS = 5 * 60;

type Period = keyof typeof MONTHS;

/**
 * A kindergarten's own NomadKids access — how long its contract runs, and the
 * invoice that renews it (#211 items 6–7).
 *
 * ★ A director of a **contracted** kindergarten only. A solo workspace never
 * pays (teachers never pay — #195), so it is a 404 here.
 *
 * ★★ The price is the shared sheet's (`@kinder/contracts` `GROUP_PRICES`)
 * for a contract at the standard monthly fee, × the groups running now, and
 * `perGroupMonthlyFee × months` for a negotiated one — `perGroupFor`. A
 * contract from before per-group pricing has none, and its renewal is the
 * operator's to quote.
 *
 * ★★★ No QPay (CLAUDE.md §7), and no reminder written anywhere: the bell is
 * the kindergarten's notice board, which families read too. `remind` on the
 * status is what the red «1» reads.
 */
@Injectable()
export class ServiceAccessService {
  private readonly logger = new Logger(ServiceAccessService.name);

  constructor(
    private readonly repo: ServiceAccessRepository,
    private readonly tenants: TenantAccessService,
    private readonly reports: ReportsRepository,
    private readonly queue: ReportsQueue,
    private readonly storage: StorageService,
    private readonly audit: AuditRepository,
    private readonly qpay: QpayService,
  ) {}

  async status(actor: Actor, kindergartenId?: string) {
    const kindergarten = await this.resolve(actor, kindergartenId);
    const [contract, groupCount] = await Promise.all([
      this.repo.activeContract(kindergarten.id),
      this.repo.currentGroupCount(kindergarten.id),
    ]);

    const expiresAt = contract?.endsOn ?? null;
    const daysLeft = expiresAt ? daysUntil(expiresAt) : null;
    const fee = contract?.perGroupMonthlyFee ?? null;
    const term = contract ? quote(contract, groupCount, "TERM") : null;
    const year = contract ? quote(contract, groupCount, "YEAR") : null;

    return {
      kindergartenId: kindergarten.id,
      expiresAt: expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
      // ★ Lower case: the web's schema reads "term" | "year".
      period: contract?.billingPeriod
        ? contract.billingPeriod === "TERM"
          ? "term"
          : "year"
        : null,
      groupCount,
      daysLeft,
      remind: daysLeft !== null && daysLeft <= REMIND_DAYS,
      perGroupMonthlyFee: fee?.toString() ?? null,
      termAmount: fee ? (term?.amount ?? null) : null,
      yearAmount: fee ? (year?.amount ?? null) : null,
      // What each would extend the contract to — said before the QR (№6).
      termCoversTo: term?.coversTo ?? null,
      yearCoversTo: year?.coversTo ?? null,
      /*
       * What each period is, as the invoice and the QR name it — «II улирал
       * (2026.12.01 – 2027.02.28)», «2026–2027 хичээлийн жил, II улирал, III
       * улирал». From December "the year" is what is left of it, priced as
       * terms (the user, 2026-10-18), so the screen cannot say «хичээлийн жил»
       * on its own.
       */
      termLabel: term?.label ?? null,
      yearLabel: year?.label ?? null,
    };
  }

  /** Queues the renewal invoice; Chromium renders it in the worker (CLAUDE.md §6). */
  async requestInvoice(actor: Actor, period: Period, kindergartenId?: string) {
    const kindergarten = await this.resolve(actor, kindergartenId);
    const env = loadEnv();
    const bank = {
      name: env.SERVICE_INVOICE_BANK_NAME,
      account: env.SERVICE_INVOICE_BANK_ACCOUNT,
      holder: env.SERVICE_INVOICE_ACCOUNT_HOLDER,
    };
    if (!bank.name || !bank.account || !bank.holder) {
      throw new BadRequestException(
        "Нэхэмжлэхийн дансны мэдээлэл тохируулаагүй байна. NomadKids-тэй холбогдоно уу.",
      );
    }

    const [contract, groupCount] = await Promise.all([
      this.repo.activeContract(kindergarten.id),
      this.repo.currentGroupCount(kindergarten.id),
    ]);
    if (!contract?.perGroupMonthlyFee) {
      throw new BadRequestException(
        "Гэрээнд бүлгийн төлбөр тогтоогоогүй байна. NomadKids-тэй холбогдож нэхэмжлэх авна уу.",
      );
    }
    if (groupCount === 0) {
      throw new BadRequestException("Одоогийн хичээлийн жилд идэвхтэй бүлэг алга байна.");
    }

    const fee = contract.perGroupMonthlyFee.toString();
    const priced = quote(contract, groupCount, period);
    const invoice: ServiceInvoiceParams = {
      period,
      months: priced.months,
      groupCount,
      perGroupMonthlyFee: fee,
      perGroupAmount: priced.perGroup,
      periodLabel: priced.label,
      amount: priced.amount,
      kindergartenName: kindergarten.name,
      contractNumber: contract.number,
      issuedOn: localDate(),
      bank,
    };

    const job = await this.reports.createJob({
      kindergartenId: kindergarten.id,
      // ★ No child — the guard every child report path opens with.
      childId: null,
      type: "SERVICE_INVOICE",
      params: { serviceInvoice: invoice },
      requestedById: actor.userId,
    });

    // After the commit — CLAUDE.md §3.5.
    try {
      await this.queue.enqueue(job.id);
    } catch (error) {
      this.logger.error(`Could not enqueue service invoice ${job.id}`, error as Error);
      await this.reports
        .markFailed(job.id, "Нэхэмжлэхийн дараалал ажиллахгүй байна. Дахин оролдоно уу.")
        .catch(() => undefined);
    }

    await this.audit.append({
      action: "CREATE",
      kindergartenId: kindergarten.id,
      actorUserId: actor.userId,
      objectType: "ServiceInvoice",
      objectId: job.id,
      metadata: { period, groupCount, amount: invoice.amount },
    });

    return this.shape(job);
  }

  async invoice(actor: Actor, jobId: string) {
    return this.shape(await this.load(actor, jobId));
  }

  /** A short-lived link, minted only after the check — a presigned URL is a credential. */
  async downloadUrl(actor: Actor, jobId: string) {
    const job = await this.load(actor, jobId);
    if (job.status !== "DONE" || !job.resultMedia) {
      throw new BadRequestException("Нэхэмжлэх хараахан бэлэн болоогүй байна");
    }
    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) throw new NotFoundException();

    await this.audit.append({
      action: "DOWNLOAD",
      kindergartenId: job.kindergartenId,
      actorUserId: actor.userId,
      objectType: "ServiceInvoice",
      objectId: jobId,
    });

    const url = await this.storage.presignedGetUrl(
      job.resultMedia.storageKey,
      job.resultMedia.originalName,
    );
    return { url, expiresIn: DOWNLOAD_TTL_SECONDS };
  }

  /**
   * The kindergarten asked about: the one named, or the director's only one.
   * Anything but a contracted kindergarten they administer is a 404.
   */
  /**
   * The next period of the contract, paid by QPay — №6 (the user,
   * 2026-10-16/18). Priced here (`quote`), never from the request; the period
   * row is reused while unpaid and re-priced to the groups running now, and a
   * period already paid is refused. Paid, the contract runs to `coversTo`
   * (`QpayRepository.markContractPaymentPaid`).
   */
  async payWithQpay(actor: Actor, period: Period, kindergartenId?: string) {
    const kindergarten = await this.resolve(actor, kindergartenId);
    const [contract, groupCount] = await Promise.all([
      this.repo.activeContract(kindergarten.id),
      this.repo.currentGroupCount(kindergarten.id),
    ]);
    if (!contract?.perGroupMonthlyFee) {
      throw new BadRequestException(
        "Гэрээнд бүлгийн төлбөр тогтоогоогүй байна. NomadKids-тэй холбогдоно уу.",
      );
    }
    if (groupCount === 0) {
      throw new BadRequestException("Одоогийн хичээлийн жилд идэвхтэй бүлэг алга байна.");
    }

    const priced = quote(contract, groupCount, period);
    const coversFrom = new Date(`${priced.coversFrom}T00:00:00.000Z`);
    const alreadyPaid = () =>
      new BadRequestException("Энэ хугацааны төлбөр аль хэдийн төлөгдсөн.");

    let payment = await this.repo.findPayment(contract.id, period, coversFrom);
    if (!payment) {
      // ★ Two requests at once (a double tap, two tabs) both find nothing; the
      // unique key lets one create, and the other reads that row back.
      const { row, created } = await this.repo.createPayment({
        kindergartenId: kindergarten.id,
        contractId: contract.id,
        period,
        termNumber: priced.term?.number ?? null,
        coversFrom,
        coversTo: new Date(`${priced.coversTo}T00:00:00.000Z`),
        groupCount,
        perGroupAmount: priced.perGroup,
        amount: priced.amount,
        createdById: actor.userId,
      });
      payment = row;
      if (created) {
        await this.audit.append({
          action: "CREATE",
          kindergartenId: kindergarten.id,
          actorUserId: actor.userId,
          objectType: "ContractPayment",
          objectId: row.id,
          metadata: { period, coversTo: priced.coversTo, groupCount, amount: priced.amount },
        });
      }
    }
    if (payment.status === "PAID") throw alreadyPaid();

    if (payment.amount.toFixed(2) !== priced.amount) {
      // ★ The groups changed since the last QR. An older QR may still be paid
      // at its own amount — the claim records what QPay took, not this
      // (`QpayRepository.markContractPaymentPaid`).
      const before = {
        groupCount: payment.groupCount,
        perGroupAmount: payment.perGroupAmount.toFixed(2),
        amount: payment.amount.toFixed(2),
      };
      const after = { groupCount, perGroupAmount: priced.perGroup, amount: priced.amount };
      const repriced = await this.repo.repricePending(payment.id, after);
      // Paid between the read and the update — never draw a second QR for it.
      if (repriced.count === 0) throw alreadyPaid();
      await this.audit.append({
        action: "UPDATE",
        kindergartenId: kindergarten.id,
        actorUserId: actor.userId,
        objectType: "ContractPayment",
        objectId: payment.id,
        metadata: { before, after },
      });
    }

    const attempt = await this.qpay.createForContractPayment(actor, {
      id: payment.id,
      kindergartenId: kindergarten.id,
      amount: priced.amount,
      description: `${kindergarten.name}, ${priced.label}`,
    });
    return {
      payment: paymentView({ ...payment, groupCount, amount: priced.amount }),
      attempt,
    };
  }

  /** One of this kindergarten's contract payments and its latest QR, reconciled. */
  async qpayStatus(actor: Actor, paymentId: string, kindergartenId?: string) {
    const kindergarten = await this.resolve(actor, kindergartenId);
    const before = await this.repo.paymentOf(paymentId, kindergarten.id);
    if (!before) throw new NotFoundException();
    const attempt = await this.qpay.statusForContractPayment(paymentId);
    const payment = (await this.repo.paymentOf(paymentId, kindergarten.id)) ?? before;
    return { payment: paymentView(payment), attempt };
  }

  private async resolve(actor: Actor, kindergartenId?: string) {
    const administered = this.tenants.adminKindergartenIds(actor);
    const id = kindergartenId ?? (administered.length === 1 ? administered[0] : undefined);
    if (!id) {
      if (administered.length === 0) throw new NotFoundException();
      throw new BadRequestException("Цэцэрлэгээ сонгоно уу.");
    }
    this.tenants.assertAdmin(actor, id);

    const kindergarten = await this.repo.kindergarten(id);
    if (!kindergarten || kindergarten.kind !== "CONTRACTED") throw new NotFoundException();
    return kindergarten;
  }

  /** ★ The type check keeps this route from serving any other report's file. */
  private async load(actor: Actor, jobId: string) {
    const job = await this.reports.findJob(jobId);
    if (!job || job.type !== "SERVICE_INVOICE") throw new NotFoundException();
    this.tenants.assertAdmin(actor, job.kindergartenId);
    return job;
  }

  private shape(job: {
    id: string;
    status: string;
    errorMessage: string | null;
    requestedAt: Date;
    completedAt: Date | null;
    expiresAt?: Date | null;
    params: unknown;
  }) {
    const expired = Boolean(job.expiresAt && job.expiresAt.getTime() < Date.now());
    const invoice = (job.params as { serviceInvoice?: ServiceInvoiceParams }).serviceInvoice;
    return {
      id: job.id,
      status: job.status,
      period: invoice?.period === "TERM" ? "term" : "year",
      amount: invoice?.amount ?? null,
      errorMessage: job.errorMessage,
      requestedAt: job.requestedAt,
      completedAt: job.completedAt,
      downloadable: job.status === "DONE" && !expired,
    };
  }
}

/** fee × groups × months, in decimal.js — never floats for money (§2.2). */
type ContractForQuote = { perGroupMonthlyFee: { toString(): string } | null; endsOn: Date };

/**
 * What renewing buys and costs — №6, 2026-10-18. One answer for the status,
 * the invoice and the QR.
 *
 * ★ The period after the contract's current end (or from today, once it has
 * ended): the calendar term that day falls in — or the next September's first
 * term, from a summer day — or the school year, September to May. Whole
 * periods, as a contract starting mid-term pays the whole term (the user,
 * 2026-10-14).
 *
 * ★ A year never re-sells a term already paid (review of #258, 2026-10-18).
 * From inside a school year — a contract running to 2026-11-30 after
 * «I-р улирал» — "the year" is what is left of it, from the term that day
 * falls in to 31 May, priced as those terms: `endsOn` 2026-11-30 bought
 * 2026-09-01..2027-05-31 at the whole year's 30,000₮ a group before.
 *
 * ★★ The price is the sheet's for a contract at the standard 4,000₮ a month
 * — 30,000₮ a group a year, «I-р улирал» 6,000₮ through 2026-11-30, then
 * 12,000₮ a term — and `fee × months` for a negotiated monthly fee, which is
 * the operator's agreement rather than the sheet's.
 */
export function quote(
  contract: ContractForQuote,
  groups: number,
  period: Period,
  today: string = localDate(),
): {
  coversFrom: string;
  coversTo: string;
  term: SchoolTerm | null;
  months: number;
  perGroup: string;
  amount: string;
  label: string;
} {
  const ends = contract.endsOn.toISOString().slice(0, 10);
  const start = ends >= today ? addDay(ends) : today;
  const fee = contract.perGroupMonthlyFee?.toString() ?? "0";
  const standard = new Decimal(fee).equals(GROUP_PRICES.monthly);
  const termPrice = (term: SchoolTerm) =>
    standard ? new Decimal(groupTermPrice(term)) : new Decimal(fee).times(MONTHS.TERM);

  if (period === "TERM") {
    const term = schoolTermOn(start) ?? schoolTermOn(`${Number(start.slice(0, 4))}-09-01`)!;
    const perGroup = termPrice(term);
    return {
      coversFrom: term.startsOn,
      coversTo: term.endsOn,
      term,
      months: MONTHS.TERM,
      perGroup: perGroup.toFixed(2),
      amount: perGroup.times(Math.max(0, groups)).toFixed(2),
      label: `${term.label} (${term.startsOn.replaceAll("-", ".")} – ${term.endsOn.replaceAll("-", ".")})`,
    };
  }

  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  const first = month >= 6 ? year : year - 1;
  const yearStart = `${first}-09-01`;
  const coversTo = `${first + 1}-05-31`;
  const terms = [`${first}-09-01`, `${first}-12-01`, `${first + 1}-03-01`].map(
    (day) => schoolTermOn(day)!,
  );
  const whole = start <= yearStart || schoolTermOn(start)!.startsOn === yearStart;
  const schoolYear = `${first}–${first + 1} хичээлийн жил`;

  if (whole) {
    const perGroup = standard
      ? new Decimal(GROUP_PRICES.year)
      : new Decimal(fee).times(MONTHS.YEAR);
    return {
      coversFrom: yearStart,
      coversTo,
      term: null,
      months: MONTHS.YEAR,
      perGroup: perGroup.toFixed(2),
      amount: perGroup.times(Math.max(0, groups)).toFixed(2),
      label: schoolYear,
    };
  }

  const left = terms.filter((term) => term.endsOn >= start);
  const perGroup = left.reduce((sum, term) => sum.plus(termPrice(term)), new Decimal(0));
  return {
    coversFrom: left[0]!.startsOn,
    coversTo,
    term: null,
    months: MONTHS.TERM * left.length,
    perGroup: perGroup.toFixed(2),
    amount: perGroup.times(Math.max(0, groups)).toFixed(2),
    label: `${schoolYear}, ${left.map((term) => term.label).join(", ")}`,
  };
}

function addDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from Ulaanbaatar's today to a DATE column's day. */
function daysUntil(day: Date): number {
  const today = new Date(`${localDate()}T00:00:00.000Z`);
  return Math.round((day.getTime() - today.getTime()) / 86_400_000);
}

function paymentView(payment: {
  id: string;
  period: Period;
  coversFrom: Date;
  coversTo: Date;
  groupCount: number;
  amount: { toString(): string } | string;
  status: "PENDING" | "PAID";
  paidAt: Date | null;
}) {
  return {
    id: payment.id,
    period: payment.period === "TERM" ? "term" : "year",
    coversFrom: payment.coversFrom.toISOString().slice(0, 10),
    coversTo: payment.coversTo.toISOString().slice(0, 10),
    groupCount: payment.groupCount,
    amount: new Decimal(payment.amount.toString()).toFixed(2),
    status: payment.status,
    paidAt: payment.paidAt,
  };
}
