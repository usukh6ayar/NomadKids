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

/**
 * Artwork comparisons in one report — RFP §5.3.
 *
 * Each one embeds **two** images, so this number doubles against `ImageBudget`.
 * Twelve is a page or two of side-by-side pairs, which is what a family reads;
 * beyond that the budget would start silently dropping observation photographs
 * to make room.
 */
const MAX_COMPARISONS_PER_REPORT = 12;

/** Milestones in one report — RFP §4.5. Text only, so the bound is generous. */
const MAX_MILESTONES_PER_REPORT = 40;

@Injectable()
export class ReportsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly observations: ObservationsRepository,
  ) {}

  /**
   * ★ `childId` is nullable, for `нэмэлт.md` §16's financial reports.
   *
   * Every other type must carry one — a portfolio with no child is not a
   * document. The generator enforces that (`!job.childId && !isFinance`), and
   * every child-scoped report endpoint opens with the same guard, so a finance
   * job is invisible to them by construction rather than by a filter somebody
   * has to remember.
   */
  async createJob(data: {
    kindergartenId: string;
    childId: string | null;
    type: ReportType;
    params: object;
    requestedById: string;
  }) {
    return this.prisma.reportJob.create({ data });
  }

  /**
   * A kindergarten's financial report jobs — `нэмэлт.md` §16.
   *
   * ★ Scoped to the kindergarten and the **type**, not to the requester. A
   * financial report is the kindergarten's document, and an accountant who
   * queued one on Friday must be able to collect it on Monday from a colleague's
   * screen; child reports are filtered to their requester for the opposite
   * reason (a parent has no business seeing a teacher's export).
   */
  async listFinanceJobs(kindergartenId: string, take = 20) {
    return this.prisma.reportJob.findMany({
      where: { kindergartenId, type: "FINANCE_REPORT", deletedAt: null },
      orderBy: { requestedAt: "desc" },
      take,
      include: { resultMedia: { select: { id: true, storageKey: true, originalName: true } } },
    });
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
  /**
   * A contract and the application behind it, for the PDF template.
   *
   * ★ It lives here rather than in `OnboardingRepository` to avoid a module
   * cycle: `OnboardingModule` imports `ReportsModule` to enqueue the job, so
   * `ReportsModule` cannot import back the other way. The alternative — a
   * shared "contracts-read" module for one query — is more structure than the
   * problem deserves.
   */
  async contractForPdf(contractId: string) {
    return this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: {
        id: true,
        number: true,
        version: true,
        childCount: true,
        annualFee: true,
        perChildMonthlyFee: true,
        startsOn: true,
        endsOn: true,
        application: {
          select: {
            kindergartenName: true,
            registrationNumber: true,
            address: true,
            directorName: true,
            phone: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * Points the contract at its rendered PDF.
   *
   * ★ Ignores a second call rather than throwing. `pdfMediaFileId` is `@unique`,
   * so a redelivered BullMQ job re-attaching a different file would fail the
   * constraint and mark a job errored that in fact succeeded.
   */
  async attachContractPdf(contractId: string, mediaFileId: string) {
    await this.prisma.contract.updateMany({
      where: { id: contractId, pdfMediaFileId: null },
      data: { pdfMediaFileId: mediaFileId },
    });
  }

  async completeJob(
    id: string,
    result: {
      kindergartenId: string;
      /**
       * ★ Nullable, for `нэмэлт.md` §16's financial reports — the only report
       * type that belongs to a kindergarten rather than a child.
       *
       * A `MediaFile` with no `childId` is already refused by `/media/:id`
       * (`if (!media.childId) throw new NotFoundException()`), so the resulting
       * PDF is unreachable through the child-media route by construction. Its
       * own endpoint checks `assertCanReadFinance` instead.
       */
      childId: string | null;
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
    const [
      child,
      aboutMe,
      ageProfiles,
      birthdayNotes,
      observations,
      assessments,
      artworkComparisons,
      milestones,
    ] = await Promise.all([
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
      /*
       * RFP §5.3's last bullet — "Харьцуулалтыг PDF тайланд оруулах".
       *
       * Readable by a guardian without a visibility filter: unlike an
       * observation, a comparison has no private half. It is written about
       * work the family can already see, and §5.3 exists so they can see the
       * change in it.
       */
      this.prisma.artworkComparison.findMany({
        where: { childId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: MAX_COMPARISONS_PER_REPORT,
        include: {
          earlierMedia: { select: { id: true, storageKey: true, takenAt: true, deletedAt: true } },
          laterMedia: { select: { id: true, storageKey: true, takenAt: true, deletedAt: true } },
        },
      }),
      // RFP §4.5 — the firsts, in the portfolio they belong to.
      this.prisma.milestone.findMany({
        where: { childId, deletedAt: null },
        orderBy: { occurredOn: "asc" },
        take: MAX_MILESTONES_PER_REPORT,
      }),
    ]);

    // Read newest-first so the ceiling keeps the most recent, then present
    // oldest-first, which is how a portfolio reads.
    observations.reverse();

    return {
      child,
      aboutMe,
      ageProfiles,
      birthdayNotes,
      observations,
      assessments,
      artworkComparisons,
      milestones,
    };
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

  /**
   * The year's four terms, compared — RFP §6.5.
   *
   * ★ Every term of the school year, not only the ones with assessments.
   *
   * A year with a blank third term is a fact the report must show: the point of
   * an annual comparison is the shape of the progress, and silently omitting an
   * empty column turns "we did not assess in the winter" into "there was no
   * winter". The service fills the gaps.
   *
   * The guardian filter is the same `visibleToParents` predicate the term
   * report uses. A family's annual copy shows what they were already told, term
   * by term — an unpublished assessment does not become visible because a year
   * ended.
   */
  async loadAnnualReportData(
    childId: string,
    schoolYearId: string,
    viewer: { isGuardian: boolean; userId: string },
  ) {
    const [child, schoolYear, terms, assessments, termReports] = await Promise.all([
      this.loadChild(childId),
      this.prisma.schoolYear.findFirst({
        where: { id: schoolYearId, deletedAt: null },
        select: { id: true, name: true, startsOn: true, endsOn: true },
      }),
      this.prisma.term.findMany({
        where: { schoolYearId, deletedAt: null },
        orderBy: { number: "asc" },
        select: { id: true, name: true, number: true },
      }),
      this.prisma.assessment.findMany({
        where: {
          childId,
          deletedAt: null,
          term: { schoolYearId, deletedAt: null },
          ...(viewer.isGuardian ? { visibleToParents: true } : {}),
        },
        orderBy: [{ term: { number: "asc" } }, { domain: { order: "asc" } }],
        include: {
          term: { select: { id: true, number: true } },
          domain: { select: { id: true, name: true, order: true } },
          level: { select: { value: true, label: true, color: true } },
        },
      }),
      // The teacher's written closing text, per term. A guardian sees only
      // FINAL ones, exactly as on the term report itself.
      this.prisma.termReport.findMany({
        where: {
          childId,
          deletedAt: null,
          term: { schoolYearId, deletedAt: null },
          ...(viewer.isGuardian ? { status: "FINAL" as const } : {}),
        },
        orderBy: { term: { number: "asc" } },
        include: {
          term: { select: { id: true, number: true, name: true } },
          author: { select: { lastName: true, firstName: true } },
        },
      }),
    ]);

    return { child, schoolYear, terms, assessments, termReports };
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
        kindergarten: {
          select: {
            id: true,
            name: true,
            // RFP §10.3 — "Цэцэрлэгийн лого, нэртэй". The name was always
            // here; the logo is the half the requirement asked for and the
            // report never carried.
            logo: { select: { storageKey: true, deletedAt: true } },
          },
        },
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
