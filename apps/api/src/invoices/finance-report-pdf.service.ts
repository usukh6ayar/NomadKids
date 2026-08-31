import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { ReportsQueue } from "../reports/reports.queue";
import { ReportsRepository } from "../reports/reports.repository";
import { StorageService } from "../storage/storage.service";
import { FinanceReportsService } from "./finance-reports.service";
import type { FinanceReportKey } from "./finance-reports";

/** How long a presigned download stays valid. Matches the media service. */
const DOWNLOAD_TTL_SECONDS = 5 * 60;

/**
 * `нэмэлт.md` §16's reports as PDF.
 *
 * ★ **A different authorization path from every other report, on purpose.**
 *
 * `ReportsService` gates portfolios and term reports on `canAccessChild` —
 * correct for a child's document, and wrong for this one twice over: an
 * accountant is not on any of that predicate's three chains, and a guardian is.
 * A financial report is the kindergarten's ledger, so `assertCanReadFinance`
 * is the gate, and this service exists rather than a branch inside
 * `ReportsService` because a branch is a place to get it backwards.
 *
 * ★★ The safety property that makes this sound: a `FINANCE_REPORT` job has
 * **no `childId`**, and every method in `ReportsService` opens with
 * `if (!job || !job.childId) throw new NotFoundException()`. So the child
 * endpoints cannot serve a financial report even if somebody passes them its
 * id — it is not a filter they apply, it is a shape they cannot read.
 *
 * ★★★ PDF, not Excel, is why this goes through a queue at all. Chromium takes
 * ~2.5 s and needs a gigabyte of memory (CLAUDE.md §6); the spreadsheet is
 * built inline because ExcelJS is neither.
 */
@Injectable()
export class FinanceReportPdfService {
  private readonly logger = new Logger(FinanceReportPdfService.name);

  constructor(
    private readonly reports: ReportsRepository,
    private readonly queue: ReportsQueue,
    private readonly financeReports: FinanceReportsService,
    private readonly tenants: TenantAccessService,
    private readonly storage: StorageService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Queues a report for rendering.
   *
   * ★ The period is validated **here**, before the job exists. A malformed one
   * would otherwise fail inside the worker twenty seconds later, and the only
   * thing the requester would see is a job marked FAILED with a message they
   * cannot act on.
   */
  async enqueue(actor: Actor, kindergartenId: string, report: FinanceReportKey, period: string) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);
    this.financeReports.assertPeriodValid(report, period);

    const job = await this.reports.createJob({
      kindergartenId,
      // ★ No child. See the note at the head of this class — this is the fact
      // that keeps the child report endpoints from ever serving it.
      childId: null,
      type: "FINANCE_REPORT",
      params: { financeReport: report, financePeriod: period },
      requestedById: actor.userId,
    });

    /*
     * ★ Enqueued after the row is committed — CLAUDE.md §3.5. The worker is a
     * separate process and would otherwise race the transaction, then fail on
     * a row it cannot find.
     */
    try {
      await this.queue.enqueue(job.id);
    } catch (error) {
      this.logger.error(`Could not enqueue finance report ${job.id}`, error as Error);
      await this.reports
        .markFailed(job.id, "Тайлангийн дараалал ажиллахгүй байна. Дахин оролдоно уу.")
        .catch(() => undefined);
    }

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "FinanceReportPdf",
      objectId: job.id,
      metadata: { report, period },
    });

    return this.shape(job);
  }

  /** One kindergarten's recent PDF jobs, newest first. */
  async list(actor: Actor, kindergartenId: string) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    const jobs = await this.reports.listFinanceJobs(kindergartenId);
    return jobs.map((job) => this.shape(job));
  }

  /** One job's status — what the screen polls while Chromium works. */
  async get(actor: Actor, jobId: string) {
    const job = await this.load(actor, jobId);
    return this.shape(job);
  }

  /**
   * A short-lived download link.
   *
   * ★ Authorization runs strictly **before** the URL is minted. A presigned URL
   * is a bearer credential: generating one for an unauthorized caller has
   * already leaked the object, whatever the response then says. The same
   * ordering `MediaService.getDownloadUrl` documents.
   */
  async downloadUrl(actor: Actor, jobId: string) {
    const job = await this.load(actor, jobId);

    if (job.status !== "DONE" || !job.resultMedia) {
      throw new BadRequestException("Тайлан хараахан бэлэн болоогүй байна");
    }
    // Expired output: the row stays as history, the file is gone.
    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException();
    }

    // §14's "Тайлан татсан" — the same event the Excel export records, for the
    // same reason: this is the moment the data leaves the system.
    await this.audit.append({
      action: "DOWNLOAD",
      kindergartenId: job.kindergartenId,
      actorUserId: actor.userId,
      objectType: "FinanceReportPdf",
      objectId: jobId,
      metadata: (job.params as { financeReport?: string; financePeriod?: string }) ?? {},
    });

    const url = await this.storage.presignedGetUrl(
      job.resultMedia.storageKey,
      job.resultMedia.originalName,
    );

    return { url, expiresIn: DOWNLOAD_TTL_SECONDS };
  }

  /**
   * Loads a job and checks the caller may have it.
   *
   * ★ **The type check is not decoration.** Without it this method would serve
   * a `CHILD_PORTFOLIO` job to any accountant who guessed its id — the finance
   * gate would pass (they do have finance rights in that kindergarten) while
   * the child gate that should apply never runs. 404, not 403: an accountant
   * has no business learning that a portfolio job exists.
   */
  private async load(actor: Actor, jobId: string) {
    const job = await this.reports.findJob(jobId);
    if (!job || job.type !== "FINANCE_REPORT") throw new NotFoundException();

    this.tenants.assertCanReadFinance(actor, job.kindergartenId);
    return job;
  }

  private shape(job: {
    id: string;
    status: string;
    progressPercent: number;
    pageCount: number;
    fileSize: number;
    errorMessage: string | null;
    requestedAt: Date;
    completedAt: Date | null;
    expiresAt?: Date | null;
    params: unknown;
  }) {
    const expired = Boolean(job.expiresAt && job.expiresAt.getTime() < Date.now());
    const params = (job.params ?? {}) as { financeReport?: string; financePeriod?: string };

    return {
      id: job.id,
      report: params.financeReport ?? null,
      period: params.financePeriod ?? null,
      status: job.status,
      progressPercent: job.progressPercent,
      pageCount: job.pageCount,
      fileSize: job.fileSize,
      errorMessage: job.errorMessage,
      requestedAt: job.requestedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt ?? null,
      downloadable: job.status === "DONE" && !expired,
    };
  }
}
