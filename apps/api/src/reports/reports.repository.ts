import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ObservationsRepository } from "../observations/observations.repository";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { ReportType } from "../domain/enums";

/**
 * Observations carried into one report.
 *
 * Bounds the query, and with it the image budget's worst case. A child with
 * four years of daily notes would otherwise produce a document nobody opens and
 * a worker that runs out of memory building it. The most recent are kept: a
 * portfolio is read for what happened lately.
 */
const MAX_OBSERVATIONS_PER_REPORT = 60;

@Injectable()
export class ReportsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly observations: ObservationsRepository,
  ) {}

  async createJob(data: {
    kindergartenId: string;
    childId: string;
    type: ReportType;
    params: object;
    requestedById: string;
  }) {
    return this.prisma.reportJob.create({ data });
  }

  async findJob(id: string) {
    return this.prisma.reportJob.findFirst({
      where: { id, deletedAt: null },
      include: { resultMedia: { select: { id: true, storageKey: true, originalName: true } } },
    });
  }

  /**
   * One person's report history for one child.
   *
   * `requestedById` is part of the query, not a filter applied to the page. A
   * post-filter would leave `total` counting other people's jobs and the last
   * page arriving half empty — and it would still have read their rows.
   */
  async listForChild(childId: string, requestedById: string, page: PageParams) {
    const { skip, take } = toSkipTake(page);
    const where = { childId, requestedById, deletedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.reportJob.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          type: true,
          status: true,
          progressPercent: true,
          pageCount: true,
          fileSize: true,
          errorMessage: true,
          requestedAt: true,
          completedAt: true,
          expiresAt: true,
          requestedById: true,
        },
      }),
      this.prisma.reportJob.count({ where }),
    ]);

    return { items, total };
  }

  async markRunning(id: string) {
    return this.prisma.reportJob.update({
      where: { id },
      data: { status: "RUNNING", startedAt: new Date(), progressPercent: 10 },
    });
  }

  /**
   * Attaches the finished PDF to the job — media row and job update in **one
   * transaction**.
   *
   * ★ Not two calls, because of what a redelivered job does otherwise. BullMQ
   * delivers at least once: a worker killed mid-render leaves the row at
   * `RUNNING`, the job is redelivered, and a second PDF is generated. With
   * separate calls the second `MediaFile` overwrites `resultMediaFileId` and
   * the first object is orphaned — no row references it, so `listExpired`
   * cannot find it and the retention sweep can never collect it. It stays in
   * the bucket, containing a child's record, indefinitely.
   *
   * `attached: false` means the job already had a result and this render lost
   * the race. The caller deletes the object it just uploaded.
   */
  async completeJob(
    id: string,
    result: {
      kindergartenId: string;
      childId: string;
      storageKey: string;
      originalName: string;
      fileSize: number;
      pageCount: number;
      expiresAt: Date;
    },
  ): Promise<{ attached: boolean; mediaFileId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.reportJob.findUniqueOrThrow({
        where: { id },
        select: { resultMediaFileId: true },
      });

      if (existing.resultMediaFileId) {
        return { attached: false, mediaFileId: existing.resultMediaFileId };
      }

      const media = await tx.mediaFile.create({
        data: {
          kindergartenId: result.kindergartenId,
          childId: result.childId,
          observationId: null,
          purpose: "REPORT_OUTPUT",
          mimeType: "application/pdf",
          storageKey: result.storageKey,
          originalName: result.originalName,
          sizeBytes: result.fileSize,
          order: 0,
        },
      });

      await tx.reportJob.update({
        where: { id },
        data: {
          status: "DONE",
          progressPercent: 100,
          completedAt: new Date(),
          resultMediaFileId: media.id,
          fileSize: result.fileSize,
          pageCount: result.pageCount,
          expiresAt: result.expiresAt,
          // A retry that succeeds clears the previous attempt's message.
          errorMessage: null,
        },
      });

      return { attached: true, mediaFileId: media.id };
    });
  }

  /**
   * Records a failure.
   *
   * ★ The message is shown to the requester, so the service passes a fixed
   * Mongolian sentence and never `error.message`. A Prisma error carries table
   * and column names; an S3 error carries the bucket and the storage key — and
   * a storage key in a user-visible field is the one string this system works
   * hardest to keep out of responses.
   */
  async markFailed(id: string, message: string) {
    return this.prisma.reportJob.update({
      where: { id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: message.slice(0, 500),
      },
    });
  }

  /**
   * Repairs a row that has a result but is not marked DONE.
   *
   * The state is reachable: a worker killed between `completeJob` committing
   * and the queue acknowledging leaves the job at RUNNING with a perfectly good
   * PDF attached. Redelivery then short-circuits on the existing result — and
   * without this the row sits at RUNNING for ever, `downloadable` stays false,
   * and the requester polls a report that is actually finished and sitting in
   * the bucket.
   */
  async reconcileCompleted(id: string) {
    return this.prisma.reportJob.update({
      where: { id },
      data: {
        status: "DONE",
        progressPercent: 100,
        completedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  /**
   * Jobs that were accepted but never picked up.
   *
   * The window is real: the row is committed and the enqueue happens after, so
   * a Redis blip or a process death in between leaves a `QUEUED` row nobody is
   * working on. Without this sweep the client polls it forever — `downloadable`
   * never becomes true and no error is ever shown.
   */
  async listStaleQueued(olderThan: Date, take = 50) {
    return this.prisma.reportJob.findMany({
      where: { status: "QUEUED", requestedAt: { lt: olderThan }, deletedAt: null },
      select: { id: true },
      take,
    });
  }

  /**
   * Everything the portfolio PDF needs.
   *
   * ★ The observation filter is `ObservationsRepository.readableWhere` — the
   * same predicate the list and detail endpoints use, not a fourth copy. A
   * report is simply a third reader of the same records, and a report that
   * builds its own visibility rule is how a private teaching note reaches a
   * family in a PDF they can forward. `test/authz-consistency.test.ts` asserts
   * the three agree.
   *
   * `viewer` is the person the report is *for*, which the service derives from
   * the requester's relationship to the child and stores on the job. It is not
   * re-derived at download time.
   */
  async loadPortfolioData(childId: string, viewer: { isGuardian: boolean; userId: string }) {
    const [child, aboutMe, ageProfiles, birthdayNotes, observations, assessments] =
      await Promise.all([
        this.loadChild(childId),
        this.prisma.childProfile.findFirst({ where: { childId, deletedAt: null } }),
        this.prisma.childAgeProfile.findMany({
          where: { childId, deletedAt: null },
          orderBy: { age: "asc" },
        }),
        this.prisma.birthdayNote.findMany({
          where: { childId, deletedAt: null },
          orderBy: { age: "asc" },
        }),
        this.prisma.observation.findMany({
          where: {
            AND: [this.observations.readableWhere(childId, viewer), { includeInReport: true }],
          },
          orderBy: { observedOn: "desc" },
          take: MAX_OBSERVATIONS_PER_REPORT,
          include: {
            type: { select: { name: true } },
            media: {
              where: { deletedAt: null, status: "READY" },
              select: { id: true, storageKey: true },
              orderBy: { order: "asc" },
              // Per observation. The report-wide ceiling is `ImageBudget`.
              take: 3,
            },
          },
        }),
        this.prisma.assessment.findMany({
          where: {
            childId,
            deletedAt: null,
            ...(viewer.isGuardian ? { visibleToParents: true } : {}),
          },
          orderBy: [{ term: { number: "asc" } }, { domain: { order: "asc" } }],
          include: {
            term: { select: { name: true } },
            domain: { select: { name: true } },
            level: { select: { label: true, color: true } },
          },
        }),
      ]);

    // Read newest-first so the ceiling keeps the most recent, then present
    // oldest-first, which is how a portfolio reads.
    observations.reverse();

    return { child, aboutMe, ageProfiles, birthdayNotes, observations, assessments };
  }

  /**
   * Everything the term report PDF needs — RFP §6.4.
   *
   * ★ A guardian sees a term report only when it is `FINAL`. A draft is a
   * teacher's working text, and §21.7 is an acceptance criterion about what the
   * family receives, not about what exists.
   */
  async loadTermReportData(
    childId: string,
    termId: string,
    viewer: { isGuardian: boolean; userId: string },
  ) {
    const [child, termReport, assessments] = await Promise.all([
      this.loadChild(childId),
      this.prisma.termReport.findFirst({
        where: {
          childId,
          termId,
          deletedAt: null,
          ...(viewer.isGuardian ? { status: "FINAL" as const } : {}),
        },
        include: {
          term: { select: { id: true, name: true, number: true, startsOn: true, endsOn: true } },
          author: { select: { lastName: true, firstName: true } },
        },
      }),
      this.prisma.assessment.findMany({
        where: {
          childId,
          termId,
          deletedAt: null,
          ...(viewer.isGuardian ? { visibleToParents: true } : {}),
        },
        orderBy: { domain: { order: "asc" } },
        include: {
          domain: { select: { name: true } },
          level: { select: { label: true, color: true } },
        },
      }),
    ]);

    return { child, termReport, assessments };
  }

  private async loadChild(childId: string) {
    return this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: {
        id: true,
        lastName: true,
        firstName: true,
        dateOfBirth: true,
        sex: true,
        kindergarten: { select: { id: true, name: true } },
        photo: { select: { storageKey: true, deletedAt: true } },
        enrollments: {
          where: { status: "ACTIVE", deletedAt: null },
          select: {
            group: { select: { name: true } },
            schoolYear: { select: { name: true } },
          },
          take: 1,
        },
      },
    });
  }

  /** Report outputs whose retention window has passed — the cleanup sweep. */
  async listExpired(now: Date, take = 100) {
    return this.prisma.reportJob.findMany({
      where: { status: "DONE", expiresAt: { lt: now }, deletedAt: null },
      select: {
        id: true,
        resultMediaFileId: true,
        resultMedia: { select: { storageKey: true } },
      },
      take,
    });
  }

  /**
   * Detaches an expired output so the storage object can be collected.
   *
   * The job stays `DONE` and keeps its `expiresAt`: it did complete, and the
   * history of what was generated for whom is audit-relevant. Only the file is
   * gone, which the download route already reports as 404 once `expiresAt` has
   * passed — the row is not the artefact.
   */
  async clearExpiredResult(jobId: string, mediaFileId: string | null) {
    await this.prisma.$transaction(async (tx) => {
      await tx.reportJob.update({ where: { id: jobId }, data: { resultMediaFileId: null } });
      if (mediaFileId) {
        await tx.mediaFile.update({ where: { id: mediaFileId }, data: { deletedAt: new Date() } });
      }
    });
  }
}
