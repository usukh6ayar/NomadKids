import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { localDate } from "@kinder/contracts";
import Decimal from "decimal.js";
import { AuditRepository } from "../audit/audit.repository";
import type { Actor } from "../authz/actor";
import { TenantAccessService } from "../authz/tenant-access.service";
import { loadEnv } from "../config/env";
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
 * ★★ The price is the contract's frozen `perGroupMonthlyFee`, × the groups
 * running now × 3 or 9 months — not a third copy of the price sheet. A
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
      termAmount: fee ? amountFor(fee.toString(), groupCount, "TERM") : null,
      yearAmount: fee ? amountFor(fee.toString(), groupCount, "YEAR") : null,
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
    const invoice: ServiceInvoiceParams = {
      period,
      months: MONTHS[period],
      groupCount,
      perGroupMonthlyFee: fee,
      amount: amountFor(fee, groupCount, period),
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
function amountFor(fee: string, groups: number, period: Period): string {
  return new Decimal(fee).times(groups).times(MONTHS[period]).toFixed(2);
}

/** Whole days from Ulaanbaatar's today to a DATE column's day. */
function daysUntil(day: Date): number {
  const today = new Date(`${localDate()}T00:00:00.000Z`);
  return Math.round((day.getTime() - today.getTime()) / 86_400_000);
}
