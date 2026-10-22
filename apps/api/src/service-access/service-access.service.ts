import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  GROUP_PRICES,
  groupYearMonths,
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

type Kindergarten = { id: string; name: string };
type ActiveContract = NonNullable<Awaited<ReturnType<ServiceAccessRepository["activeContract"]>>>;
type PaymentRow = NonNullable<Awaited<ReturnType<ServiceAccessRepository["findPayment"]>>>;

/**
 * A kindergarten's own NomadKids access — how long its contract runs, the
 * contract the director accepts online, and how each period is paid (#211
 * items 6–7, №6).
 *
 * ★ A director of a **contracted** kindergarten only. A solo workspace never
 * pays (teachers never pay — #195), so it is a 404 here.
 *
 * ★★ A renewal is priced by `quote()` from the shared sheet (`@kinder/
 * contracts` `GROUP_PRICES`), × the groups running now, or `fee × months`
 * for a negotiated fee. The contract's **first** period is its own
 * `periodFee`, the figure the PDF prints and the director accepted — the
 * sheet's by default, the operator's when they negotiated one (the user,
 * 2026-10-18).
 *
 * ★★★ Paid by QPay or by a bank transfer against an invoice, which the
 * operator records (`ContractPaymentsService`) — state kindergartens pay that
 * way (client, 2026-10-18). No reminder is written anywhere: the bell is the
 * kindergarten's notice board, which families read too. `remind` on the
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
    const [contract, toSign, groupCount] = await Promise.all([
      this.repo.activeContract(kindergarten.id),
      this.repo.contractToSign(kindergarten.id),
      this.repo.currentGroupCount(kindergarten.id),
    ]);
    const due = contract ? await this.repo.dueInitial(contract.id) : null;

    // ★ An accepted contract whose first period is unpaid runs to nothing yet:
    // the screen says what is owed, never «2027.05.31 хүртэл».
    const expiresAt = contract && !due ? contract.endsOn : null;
    const daysLeft = expiresAt ? daysUntil(expiresAt) : null;
    const fee = contract?.perGroupMonthlyFee ?? null;
    const term = contract ? quote(contract, groupCount, "TERM") : null;
    const year = contract ? quote(contract, groupCount, "YEAR") : null;

    return {
      kindergartenId: kindergarten.id,
      expiresAt: expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
      // ★ Lower case: the web's schema reads "term" | "year".
      period: contract?.billingPeriod ? lower(contract.billingPeriod) : null,
      groupCount,
      daysLeft,
      remind: Boolean(toSign) || Boolean(due) || (daysLeft !== null && daysLeft <= REMIND_DAYS),
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
      // How many months each charges — a year bought later is its months left (2026-10-22).
      termMonths: term?.months ?? null,
      yearMonths: year?.months ?? null,
      // Whether «Жилээр» is the whole school year at the year's price.
      yearWhole: year ? year.months === MONTHS.YEAR : null,
      /** The contract issued and waiting for the director's acceptance (2026-10-18). */
      contractToSign: toSign
        ? {
            id: toSign.id,
            number: toSign.number,
            version: toSign.version,
            groupCount: toSign.groupCount,
            period: toSign.billingPeriod ? lower(toSign.billingPeriod) : null,
            perGroupMonthlyFee: toSign.perGroupMonthlyFee?.toFixed(2) ?? null,
            periodFee: toSign.periodFee?.toFixed(2) ?? null,
            startsOn: isoDay(toSign.startsOn),
            endsOn: isoDay(toSign.endsOn),
            pdfReady: Boolean(toSign.pdfMediaFileId),
          }
        : null,
      /** The accepted contract's first period, unpaid — paid before any renewal. */
      due: due && contract ? dueView(due, contract.number) : null,
    };
  }

  /**
   * The contract's PDF for its own director — the document they accept. A
   * short-lived link, minted after the check: a presigned URL is a credential.
   */
  async contractPdfUrl(actor: Actor, contractId: string, kindergartenId?: string) {
    const kindergarten = await this.resolve(actor, kindergartenId);
    const contract = await this.repo.contractOf(contractId, kindergarten.id);
    if (!contract) throw new NotFoundException();
    if (!contract.pdf || contract.pdf.deletedAt) {
      throw new BadRequestException(
        "Гэрээний PDF бэлэн болоогүй байна. Түр хүлээгээд дахин оролдоно уу.",
      );
    }

    await this.audit.append({
      action: "DOWNLOAD",
      kindergartenId: kindergarten.id,
      actorUserId: actor.userId,
      objectType: "Contract",
      objectId: contract.id,
    });

    const url = await this.storage.presignedGetUrl(
      contract.pdf.storageKey,
      contract.pdf.originalName,
    );
    return { url, expiresIn: DOWNLOAD_TTL_SECONDS };
  }

  /**
   * The director accepts the contract online — the user, 2026-10-18
   * («онлайнаар гэрээ байгуулдаг»). The contract becomes ACTIVE, the
   * acceptance is recorded (who, when, from where, which PDF at which
   * version, the figures), and the first period is owed at the contract's
   * own `periodFee`.
   *
   * ★ `version` is the one the director read: a contract re-issued meanwhile
   * is refused rather than accepted unseen. ★★ A record of consent, not a
   * certified e-signature (RFP Phase IV).
   */
  async acceptContract(
    actor: Actor,
    contractId: string,
    body: { version: number; kindergartenId?: string },
    context: { ipAddress: string | null; userAgent: string | null },
  ) {
    const kindergarten = await this.resolve(actor, body.kindergartenId);
    const contract = await this.repo.contractOf(contractId, kindergarten.id);
    if (!contract) throw new NotFoundException();
    if (contract.status !== "PENDING_SIGNATURE") {
      throw new ConflictException("Гэрээ аль хэдийн баталгаажсан байна.");
    }
    if (contract.version !== body.version) {
      throw new ConflictException("Гэрээ шинэчлэгдсэн байна. Дахин уншаад баталгаажуулна уу.");
    }
    if (!contract.pdfMediaFileId || !contract.pdf || contract.pdf.deletedAt) {
      throw new BadRequestException(
        "Гэрээний PDF бэлэн болоогүй байна. Түр хүлээгээд дахин оролдоно уу.",
      );
    }
    if (!contract.groupCount || !contract.billingPeriod || !contract.periodFee) {
      throw new BadRequestException(
        "Гэрээний нөхцөл бүрэн биш байна. NomadKids-тэй холбогдоно уу.",
      );
    }

    const periodFee = new Decimal(contract.periodFee.toString());
    const terms = {
      groupCount: contract.groupCount,
      billingPeriod: contract.billingPeriod,
      perGroupMonthlyFee: contract.perGroupMonthlyFee?.toFixed(2) ?? null,
      periodFee: periodFee.toFixed(2),
      startsOn: isoDay(contract.startsOn),
      endsOn: isoDay(contract.endsOn),
    };
    const accepted = await this.repo.acceptContract({
      contractId: contract.id,
      kindergartenId: kindergarten.id,
      version: contract.version,
      pdfMediaFileId: contract.pdfMediaFileId,
      userId: actor.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      terms,
      contractNumber: contract.number,
      acceptedAt: new Date(),
      initialPayment: periodFee.gt(0)
        ? {
            period: contract.billingPeriod,
            termNumber:
              contract.billingPeriod === "TERM"
                ? (schoolTermOn(isoDay(contract.startsOn))?.number ?? null)
                : null,
            coversFrom: contract.startsOn,
            coversTo: contract.endsOn,
            groupCount: contract.groupCount,
            perGroupAmount: periodFee.div(contract.groupCount).toFixed(2),
            amount: periodFee.toFixed(2),
            createdById: actor.userId,
          }
        : null,
    });
    // Accepted by another tab, or re-issued, between the read and the claim.
    if (!accepted) throw new ConflictException("Гэрээ аль хэдийн баталгаажсан байна.");

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: kindergarten.id,
      actorUserId: actor.userId,
      objectType: "Contract",
      objectId: contract.id,
      metadata: {
        before: { status: "PENDING_SIGNATURE" },
        after: { status: "ACTIVE" },
        acceptanceId: accepted.acceptance.id,
        version: contract.version,
        ipAddress: context.ipAddress,
        initialPaymentId: accepted.payment?.id ?? null,
        amount: terms.periodFee,
      },
    });

    return {
      contract: { id: contract.id, number: contract.number, status: "ACTIVE" as const },
      due: accepted.payment ? dueView(accepted.payment, contract.number) : null,
    };
  }

  /** Queues the renewal invoice; Chromium renders it in the worker (CLAUDE.md §6). */
  async requestInvoice(actor: Actor, period: Period, kindergartenId?: string) {
    const kindergarten = await this.resolve(actor, kindergartenId);
    const bank = bankDetails();
    const { contract, groupCount } = await this.renewable(kindergarten.id);
    // ★ The invoice is for a row the operator can record a transfer against
    // (client, 2026-10-18): the same period row the QR would pay.
    const { payment, priced } = await this.renewalRow(
      actor,
      kindergarten,
      contract,
      groupCount,
      period,
    );
    return this.queueInvoice(actor, kindergarten, {
      period,
      months: priced.months,
      groupCount,
      perGroupMonthlyFee: contract.perGroupMonthlyFee!.toString(),
      perGroupAmount: priced.perGroup,
      periodLabel: priced.label,
      amount: priced.amount,
      kindergartenName: kindergarten.name,
      contractNumber: contract.number,
      contractPaymentId: payment.id,
      issuedOn: localDate(),
      bank,
    });
  }

  /**
   * An invoice for one unpaid period already owed — the contract's first, for
   * a state kindergarten paying by transfer (client, 2026-10-18).
   */
  async paymentInvoice(actor: Actor, paymentId: string, kindergartenId?: string) {
    const kindergarten = await this.resolve(actor, kindergartenId);
    const payment = await this.repo.paymentOf(paymentId, kindergarten.id);
    if (!payment) throw new NotFoundException();
    if (payment.status === "PAID") throw alreadyPaid();
    const bank = bankDetails();

    const amount = new Decimal(payment.amount.toString());
    const perGroup = amount.div(payment.groupCount);
    return this.queueInvoice(actor, kindergarten, {
      period: payment.period,
      months: MONTHS[payment.period],
      groupCount: payment.groupCount,
      perGroupMonthlyFee: "0",
      // ★ Shown only when it divides exactly — 270,000₮ over 13 groups is not
      // 20,769.23₮ × 13, and the invoice must not print a sum that is off.
      perGroupAmount: perGroup.isInteger() ? perGroup.toFixed(2) : null,
      periodLabel: paymentLabel(payment, payment.contract.number),
      amount: amount.toFixed(2),
      kindergartenName: kindergarten.name,
      contractNumber: payment.contract.number,
      contractPaymentId: payment.id,
      issuedOn: localDate(),
      bank,
    });
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
   * The next period of the contract, paid by QPay — №6 (the user,
   * 2026-10-16/18). Priced here (`quote`), never from the request; the period
   * row is reused while unpaid and re-priced to the groups running now, and a
   * period already paid is refused. Paid, the contract runs to `coversTo`
   * (`QpayRepository.markContractPaymentPaid`).
   */
  async payWithQpay(actor: Actor, period: Period, kindergartenId?: string) {
    const kindergarten = await this.resolve(actor, kindergartenId);
    const { contract, groupCount } = await this.renewable(kindergarten.id);
    const { payment, priced } = await this.renewalRow(
      actor,
      kindergarten,
      contract,
      groupCount,
      period,
    );

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

  /**
   * The contract's first period, paid by QPay — at the figure the director
   * accepted, never re-priced (2026-10-18). A renewal row goes through
   * `payWithQpay`, which prices it.
   */
  async payDueWithQpay(actor: Actor, paymentId: string, kindergartenId?: string) {
    const kindergarten = await this.resolve(actor, kindergartenId);
    const payment = await this.repo.paymentOf(paymentId, kindergarten.id);
    if (!payment || !payment.initial) throw new NotFoundException();
    if (payment.status === "PAID") throw alreadyPaid();

    const amount = payment.amount.toFixed(2);
    const attempt = await this.qpay.createForContractPayment(actor, {
      id: payment.id,
      kindergartenId: kindergarten.id,
      amount,
      description: `${kindergarten.name}, ${paymentLabel(payment, payment.contract.number)}`,
    });
    return { payment: paymentView({ ...payment, amount }), attempt };
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

  /**
   * The contract a renewal extends — ACTIVE, per-group, with groups running,
   * and its own first period paid (2026-10-18: renewing on top of an unpaid
   * contract would sell time after time nobody paid for).
   */
  private async renewable(kindergartenId: string) {
    const [contract, groupCount] = await Promise.all([
      this.repo.activeContract(kindergartenId),
      this.repo.currentGroupCount(kindergartenId),
    ]);
    if (!contract?.perGroupMonthlyFee) {
      throw new BadRequestException(
        "Гэрээнд бүлгийн төлбөр тогтоогоогүй байна. NomadKids-тэй холбогдоно уу.",
      );
    }
    if (await this.repo.dueInitial(contract.id)) {
      throw new BadRequestException("Эхлээд гэрээний төлбөрөө төлнө үү.");
    }
    if (groupCount === 0) {
      throw new BadRequestException("Одоогийн хичээлийн жилд идэвхтэй бүлэг алга байна.");
    }
    return { contract, groupCount };
  }

  /**
   * The renewal row for `period`: created once (two requests at once share
   * it), re-priced while unpaid to the groups running now, refused once paid.
   */
  private async renewalRow(
    actor: Actor,
    kindergarten: Kindergarten,
    contract: ActiveContract,
    groupCount: number,
    period: Period,
  ): Promise<{ payment: PaymentRow; priced: ReturnType<typeof quote> }> {
    const priced = quote(contract, groupCount, period);
    const coversFrom = new Date(`${priced.coversFrom}T00:00:00.000Z`);

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
      // ★ The groups changed since the last QR or invoice. An older QR may
      // still be paid at its own amount — the settlement records what moved,
      // not this (`settleContractPayment`).
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
    return { payment, priced };
  }

  private async queueInvoice(
    actor: Actor,
    kindergarten: Kindergarten,
    invoice: ServiceInvoiceParams,
  ) {
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
      metadata: {
        period: invoice.period,
        groupCount: invoice.groupCount,
        amount: invoice.amount,
        contractPaymentId: invoice.contractPaymentId ?? null,
      },
    });

    return this.shape(job);
  }

  /**
   * The kindergarten asked about: the one named, or the director's only one.
   * Anything but a contracted kindergarten they administer is a 404.
   */
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

function alreadyPaid() {
  return new BadRequestException("Энэ хугацааны төлбөр аль хэдийн төлөгдсөн.");
}

/** The account a transfer goes to — a deployment setting; no invoice without it. */
function bankDetails() {
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
  return { name: bank.name, account: bank.account, holder: bank.holder };
}

function lower(period: Period): "term" | "year" {
  return period === "TERM" ? "term" : "year";
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** «Гэрээ №NK-2026-000001 (2026.09.01 – 2027.05.31)» — the first period, named. */
function paymentLabel(
  payment: { initial: boolean; coversFrom: Date; coversTo: Date },
  contractNumber: string,
): string {
  const span = `${isoDay(payment.coversFrom).replaceAll("-", ".")} – ${isoDay(payment.coversTo).replaceAll("-", ".")}`;
  return payment.initial ? `Гэрээ №${contractNumber} (${span})` : `Сунгалт (${span})`;
}

function dueView(
  payment: {
    id: string;
    initial: boolean;
    coversFrom: Date;
    coversTo: Date;
    groupCount: number;
    amount: { toString(): string };
  },
  contractNumber: string,
) {
  return {
    id: payment.id,
    contractNumber,
    coversFrom: isoDay(payment.coversFrom),
    coversTo: isoDay(payment.coversTo),
    groupCount: payment.groupCount,
    amount: new Decimal(payment.amount.toString()).toFixed(2),
    label: paymentLabel(payment, contractNumber),
  };
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
 * 2026-09-01..2027-05-31 at the whole year's price a group before.
 *
 * ★★ The price is the sheet's for a contract at the standard 4,000₮ a month
 * — 28,000₮ a group a year, «I-р улирал» 4,000₮ through 2026-11-30, then
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
    // ★ The III term runs to 30 June — June is a bonus, not charged (2026-10-22,
    // the user). `schoolTermOn` keeps 31 May: the family fee reads it too.
    const coversTo = term.number === 3 ? juneBonus(term.endsOn) : term.endsOn;
    return {
      coversFrom: term.startsOn,
      coversTo,
      term,
      months: MONTHS.TERM,
      perGroup: perGroup.toFixed(2),
      amount: perGroup.times(Math.max(0, groups)).toFixed(2),
      label: `${term.label} (${term.startsOn.replaceAll("-", ".")} – ${coversTo.replaceAll("-", ".")})`,
    };
  }

  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  const first = month >= 6 ? year : year - 1;
  const yearStart = `${first}-09-01`;
  // ★ To 30 June — nine months charged, June a bonus (2026-10-22, the user).
  const coversTo = `${first + 1}-06-30`;
  const schoolYear = `${first}–${first + 1} хичээлийн жил`;
  const monthly = new Decimal(standard ? GROUP_PRICES.monthly : fee);

  if (start <= yearStart) {
    const perGroup = standard ? new Decimal(GROUP_PRICES.year) : monthly.times(MONTHS.YEAR);
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

  /*
   * ★ A year bought after it began — 2026-10-22, the user: charged from the
   * NEXT month to May at the monthly price, valid from today to 30 June. On
   * 22 October that is November–May, seven months: 28,000₮ a group. A
   * renewal that starts on the 1st (the old period ran to the month's end)
   * charges that month too — nothing of it has been used.
   */
  const monthsLeft = groupYearMonths(start);
  const perGroup = monthly.times(monthsLeft);
  return {
    coversFrom: start,
    coversTo,
    term: null,
    months: monthsLeft,
    perGroup: perGroup.toFixed(2),
    amount: perGroup.times(Math.max(0, groups)).toFixed(2),
    label: `${schoolYear} (${start.replaceAll("-", ".")} – ${coversTo.replaceAll("-", ".")})`,
  };
}

/** 31 May → 30 June of the same year: the bonus month on the III term. */
function juneBonus(mayEnd: string): string {
  return `${mayEnd.slice(0, 4)}-06-30`;
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
  initial: boolean;
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
    initial: payment.initial,
    period: payment.period === "TERM" ? "term" : "year",
    coversFrom: payment.coversFrom.toISOString().slice(0, 10),
    coversTo: payment.coversTo.toISOString().slice(0, 10),
    groupCount: payment.groupCount,
    amount: new Decimal(payment.amount.toString()).toFixed(2),
    status: payment.status,
    paidAt: payment.paidAt,
  };
}
