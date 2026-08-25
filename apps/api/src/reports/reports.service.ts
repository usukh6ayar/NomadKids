import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AssessmentRepository } from "../assessment/assessment.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { StorageService } from "../storage/storage.service";
import { ReportsRepository } from "./reports.repository";
import { ReportsQueue } from "./reports.queue";
import { mayDownloadReport, type ReportJobParams } from "./report-params";
import type { CreateReportDto } from "./reports.dto";

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly repo: ReportsRepository,
    private readonly assessments: AssessmentRepository,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly storage: StorageService,
    private readonly queue: ReportsQueue,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Requests a report.
   *
   * ★ The **audience** is decided here, from the requester's relationship to
   * the child, and written onto the job. Everything downstream — what the
   * generator queries, who may download the file — reads it back rather than
   * re-deriving it. `report-params.ts` sets out the leak this closes.
   *
   * Read access is sufficient to request one. A parent generating their own
   * child's portfolio is the headline feature of RFP §10.3, and their copy is
   * filtered to what they may already see on screen.
   */
  async create(actor: Actor, dto: CreateReportDto) {
    const facts = await this.childAccess.assertCanAccess(actor, dto.childId);
    const isGuardian = isGuardianOf(actor, facts);

    if (dto.type === "TERM_REPORT") {
      await this.requireReadableTerm(actor, dto, facts.childKindergartenId, isGuardian);
    }

    const params: ReportJobParams = {
      audience: isGuardian ? "GUARDIAN" : "STAFF",
      audienceUserId: actor.userId,
      ...(dto.termId ? { termId: dto.termId } : {}),
      ...(dto.schoolYearId ? { schoolYearId: dto.schoolYearId } : {}),
    };

    const job = await this.repo.createJob({
      kindergartenId: facts.childKindergartenId,
      childId: dto.childId,
      type: dto.type,
      params,
      requestedById: actor.userId,
    });

    // `CREATE`, not a dedicated EXPORT action: the request creates a job, and
    // the data actually leaves the system at download — which is logged as
    // DOWNLOAD below. Two rows describe the export accurately without adding an
    // enum value and a migration for it.
    await this.audit.append({
      action: "CREATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "ReportJob",
      objectId: job.id,
      childId: dto.childId,
      metadata: { type: dto.type, audience: params.audience },
    });

    // ★ Enqueued only once the row is committed. `ATOMIC_REQUESTS`-style
    // request transactions mean a bare enqueue can be picked up by the worker
    // before the row exists, and the job then fails on a row it cannot find.
    // Prisma has no `on_commit` hook, so this runs after the handler returns.
    await this.enqueueAfterResponse(job.id);

    return this.toPublicShape(job);
  }

  async get(actor: Actor, jobId: string) {
    const job = await this.repo.findJob(jobId);
    if (!job || !job.childId) throw new NotFoundException();

    // Both checks. Requester-only would let a teacher poll a job for a child
    // they have since stopped teaching; access-only is the cross-audience leak.
    await this.childAccess.assertCanAccess(actor, job.childId);
    if (!mayDownloadReport(job, actor.userId)) throw new NotFoundException();

    return this.toPublicShape(job);
  }

  /**
   * A child's report history.
   *
   * Filtered to the caller's own jobs. A parent has no business seeing that a
   * teacher exported a staff copy last Tuesday, and a teacher has no business
   * seeing what a family downloaded.
   */
  async listForChild(actor: Actor, childId: string, page: PageParams) {
    await this.childAccess.assertCanAccess(actor, childId);

    const { items, total } = await this.repo.listForChild(childId, actor.userId, page);

    return paginate(
      items.map((job) => this.toPublicShape(job)),
      total,
      page,
    );
  }

  /**
   * Issues a short-lived download URL for a finished report.
   *
   * ★ The authorization check runs strictly BEFORE the URL is created. A
   * presigned URL is a bearer credential; generating one for an unauthorized
   * caller has already leaked the object even if the response is discarded.
   * Same ordering, and the same reason, as `MediaService.getDownloadUrl`.
   */
  async downloadUrl(actor: Actor, jobId: string): Promise<{ url: string; expiresIn: number }> {
    const job = await this.repo.findJob(jobId);
    if (!job || !job.childId) throw new NotFoundException();

    await this.childAccess.assertCanAccess(actor, job.childId);
    if (!mayDownloadReport(job, actor.userId)) throw new NotFoundException();

    if (job.status !== "DONE" || !job.resultMedia) {
      throw new BadRequestException("Тайлан хараахан бэлэн болоогүй байна");
    }
    // Expired output: the row remains as history, the file is gone.
    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException();
    }

    await this.audit.append({
      action: "DOWNLOAD",
      kindergartenId: job.kindergartenId,
      actorUserId: actor.userId,
      objectType: "ReportJob",
      objectId: job.id,
      childId: job.childId,
      metadata: { type: job.type },
    });

    // Never logged: valid until it expires.
    const url = await this.storage.presignedGetUrl(
      job.resultMedia.storageKey,
      job.resultMedia.originalName,
    );

    return { url, expiresIn: 300 };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * A guardian may only request a term report that has been finalised.
   *
   * Checked at request time as well as at generation time. Without it a parent
   * would queue a job that fails minutes later with an opaque message, and the
   * FAILED row would itself confirm that an unfinished report exists.
   */
  private async requireReadableTerm(
    actor: Actor,
    dto: CreateReportDto,
    kindergartenId: string,
    isGuardian: boolean,
  ) {
    const term = await this.assessments.findTerm(
      dto.termId!,
      this.tenants.memberKindergartenIds(actor),
    );
    if (!term || term.kindergartenId !== kindergartenId) {
      throw new BadRequestException("Улирал олдсонгүй");
    }

    const report = await this.assessments.findTermReport(dto.childId, dto.termId!, isGuardian);
    if (!report) {
      throw new BadRequestException(
        isGuardian
          ? "Улирлын тайлан хараахан бэлэн болоогүй байна"
          : "Эхлээд улирлын тайланг бичнэ үү",
      );
    }
  }

  /**
   * Hands the job to the queue without failing the request if Redis is down.
   *
   * ★ On failure the row is marked FAILED, with a message the requester can
   * act on. Leaving it QUEUED would be worse than an error: nothing would ever
   * pick it up, the client would poll a job that never progresses, and no
   * failure would ever be shown. An honest error the user can retry beats a
   * spinner that turns for ever.
   *
   * The nightly `requeueStale` pass covers the narrower window where the row
   * committed and the process died before reaching this method at all.
   */
  private async enqueueAfterResponse(jobId: string): Promise<void> {
    try {
      await this.queue.enqueue(jobId);
    } catch (error) {
      this.logger.error(`Could not enqueue report job ${jobId}`, error as Error);
      await this.repo
        .markFailed(jobId, "Тайлангийн дараалал ажиллахгүй байна. Дахин оролдоно уу.")
        .catch(() => undefined);
    }
  }

  private toPublicShape(job: {
    id: string;
    type: string;
    status: string;
    progressPercent: number;
    pageCount: number;
    fileSize: number;
    errorMessage: string | null;
    requestedAt: Date;
    completedAt: Date | null;
    expiresAt?: Date | null;
  }) {
    const expired = Boolean(job.expiresAt && job.expiresAt.getTime() < Date.now());

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      progressPercent: job.progressPercent,
      pageCount: job.pageCount,
      fileSize: job.fileSize,
      errorMessage: job.errorMessage,
      requestedAt: job.requestedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt ?? null,
      // Saves the client from re-deriving the same date comparison and getting
      // it slightly different.
      downloadable: job.status === "DONE" && !expired,
    };
  }
}
