import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  AGE_ALBUM_CATEGORY_LABEL,
  MILESTONE_KIND_LABEL,
  isAgeAlbumCategory,
} from "@kinder/contracts";
import { StorageService } from "../storage/storage.service";
import { ReportsRepository } from "./reports.repository";
import { PdfRendererService } from "./pdf-renderer.service";
import {
  ImageBudget,
  MAX_IMAGE_BYTES_PER_REPORT,
  MAX_PORTFOLIO_ALBUM_PHOTOS,
  MAX_PORTFOLIO_ARTWORKS,
} from "./report-images";
import { portfolioChrome, renderPortfolioHtml, type PortfolioData } from "./portfolio-template";
import {
  renderTermReportHtml,
  termReportChrome,
  type TermReportData,
} from "./term-report-template";
import {
  annualReportChrome,
  renderAnnualReportHtml,
  type AnnualReportData,
} from "./annual-report-template";
import { reportAudience, type ReportJobParams } from "./report-params";
import { financeReportChrome, renderFinanceReportHtml } from "./finance-report-template";
import { renderServiceInvoiceHtml, serviceInvoiceChrome } from "./service-invoice-template";
import { contractChrome, renderContractHtml, type ContractTerms } from "./contract-template";
import { FinanceReportsService } from "../invoices/finance-reports.service";

/** How long a generated file stays downloadable before the sweep removes it. */
const RESULT_TTL_DAYS = 14;

/**
 * The child's own documents — copied from an identical finished render
 * instead of rendered again (the user, 2026-10-28: a portfolio opened by the
 * family, then the teacher, then the family again). A contract, an invoice
 * and a ledger keep their own one-render rules.
 */
const REUSABLE_TYPES = new Set(["CHILD_PORTFOLIO", "TERM_REPORT", "ANNUAL_REPORT"]);

/**
 * A safe, fixed failure message.
 *
 * ★ Never `error.message`. `errorMessage` is shown to the requester, and a
 * Prisma error carries table and column names while an S3 error carries the
 * bucket and the **storage key** — the one string the media design works
 * hardest to keep out of responses. The real error goes to the log, where it
 * belongs.
 */
const FAILURE_MESSAGE = "Тайлан үүсгэхэд алдаа гарлаа. Дахин оролдоно уу.";

/**
 * Turns a queued `ReportJob` into a PDF.
 *
 * Deliberately a plain method rather than something only the queue can reach:
 * `run(jobId)` is the whole unit of work, so the tests exercise generation for
 * real — real Postgres, real MinIO, real Chromium — without a Redis round trip
 * and without the timing nondeterminism a worker would add.
 */
@Injectable()
export class ReportGeneratorService {
  private readonly logger = new Logger(ReportGeneratorService.name);

  constructor(
    private readonly repo: ReportsRepository,
    private readonly storage: StorageService,
    private readonly renderer: PdfRendererService,
    private readonly financeReports: FinanceReportsService,
  ) {}

  /**
   * @param rethrow when true (the worker), a failure is re-thrown after being
   *   recorded, so BullMQ's `attempts: 3` and its backoff actually engage.
   *   Swallowing the error resolves the queue job successfully and makes the
   *   retry configuration dead code — a Chromium renderer killed under memory
   *   pressure would never get the quieter second attempt it usually needs.
   *   Tests pass `false` so they can assert on the recorded row.
   */
  async run(jobId: string, rethrow = false): Promise<{ status: "DONE" | "FAILED" }> {
    const job = await this.repo.findJob(jobId);

    /*
     * ★ `FINANCE_REPORT` is the one type with no child — `нэмэлт.md` §16's
     * reports are a kindergarten's ledger, not a child's document. Every other
     * type must still have one, and a portfolio job that has lost its child is
     * unrenderable.
     */
    const isFinance = job?.type === "FINANCE_REPORT";
    /*
     * ★ `CONTRACT` joins `FINANCE_REPORT` as a type with **no child**, and the
     * guard below has to know: it refuses a job with neither a `childId` nor a
     * recognised childless type, which is what keeps a malformed child report
     * from rendering as an empty document.
     */
    const isContract = job?.type === "CONTRACT";
    // ★ `SERVICE_INVOICE` (#211) is the third childless type.
    const isServiceInvoice = job?.type === "SERVICE_INVOICE";

    if (!job || (!job.childId && !isFinance && !isContract && !isServiceInvoice)) {
      // Not re-thrown: a job whose row is gone will never succeed, and retrying
      // it three times with backoff only delays the inevitable.
      this.logger.warn(`Report job ${jobId} not found; nothing to generate`);
      return { status: "FAILED" };
    }

    // Already handled. BullMQ delivers at least once, so a redelivery must not
    // produce a second file and orphan the first.
    if (job.status === "DONE") return { status: "DONE" };
    if (job.resultMediaFileId) {
      // A result exists but the row never reached DONE — the worker died
      // between the commit and the acknowledgement. Finish the bookkeeping
      // rather than rendering again.
      await this.repo.reconcileCompleted(jobId);
      return { status: "DONE" };
    }

    await this.repo.markRunning(jobId);

    try {
      const params = job.params as unknown as ReportJobParams;
      const { html, chrome, filename } = isServiceInvoice
        ? this.buildServiceInvoice(params)
        : isContract
          ? await this.buildContract(params)
          : isFinance
            ? await this.buildFinanceReport(job.kindergartenId, params)
            : job.type === "TERM_REPORT"
              ? await this.buildTermReport(job.childId!, params)
              : job.type === "ANNUAL_REPORT"
                ? await this.buildAnnualReport(job.childId!, params)
                : await this.buildPortfolio(job.childId!, params);

      const storageKey = this.storage.buildKindergartenKey(job.kindergartenId, "reports");

      /*
       * ★ The same input renders the same file — the HTML carries every
       * figure, word and embedded photo, and its dates are days, not times.
       * So a child's report whose input matches a finished one is copied in
       * the store, and Chromium (the worker's ~600 MB) is not started at all.
       * A copy that fails falls back to rendering: reuse is an economy,
       * never a reason for a report to fail.
       */
      const contentHash =
        job.childId && REUSABLE_TYPES.has(job.type)
          ? createHash("sha256")
              .update(html)
              .update("\0")
              .update(JSON.stringify(chrome ?? null))
              .update("\0")
              .update(filename)
              .digest("hex")
          : null;
      let output: { fileSize: number; pageCount: number } | null = null;
      if (contentHash) {
        const prior = await this.repo.findReusableResult({
          childId: job.childId!,
          type: job.type,
          contentHash,
        });
        if (prior?.resultMedia) {
          try {
            await this.storage.copy(prior.resultMedia.storageKey, storageKey);
            output = { fileSize: prior.fileSize, pageCount: prior.pageCount };
          } catch (error) {
            this.logger.warn(
              `Report job ${jobId}: copying an identical render failed, rendering — ${(error as Error).name}`,
            );
          }
        }
      }
      if (!output) {
        const pdf = await this.renderer.render(html, chrome);
        await this.storage.put(storageKey, pdf, "application/pdf");
        output = { fileSize: pdf.byteLength, pageCount: countPages(pdf) };
      }

      // The object exists before anything points at it: a crash between the two
      // leaves a collectable orphan rather than a row that 404s for ever. The
      // same ordering as MediaService.upload.
      const { attached, mediaFileId } = await this.repo.completeJob(jobId, {
        kindergartenId: job.kindergartenId,
        childId: job.childId,
        storageKey,
        originalName: filename,
        fileSize: output.fileSize,
        pageCount: output.pageCount,
        expiresAt: new Date(Date.now() + RESULT_TTL_DAYS * 24 * 60 * 60 * 1000),
        contentHash,
      });

      /*
       * ★ The contract row is pointed at its PDF only once the media file
       * exists and this run is the one that attached it. On a redelivery
       * `attached` is false and the row already points at the first render —
       * re-pointing it would orphan a document somebody may already hold.
       */
      if (attached && isContract && params.contractId) {
        await this.repo.attachContractPdf(params.contractId, mediaFileId);
      }

      if (!attached) {
        // A concurrent delivery got there first. Remove what this run wrote,
        // rather than leaving a second copy of a child's record in the bucket
        // that nothing references and the retention sweep cannot see.
        this.logger.warn(`Report job ${jobId} already had a result; discarding this render`);
        await this.storage.delete(storageKey).catch(() => undefined);
      }

      return { status: "DONE" };
    } catch (error) {
      // Logged in full here; never returned to the caller.
      this.logger.error(`Report job ${jobId} failed`, error as Error);
      await this.repo.markFailed(jobId, FAILURE_MESSAGE);
      if (rethrow) throw error;
      return { status: "FAILED" };
    }
  }

  // ── builders ──────────────────────────────────────────────────────────────

  private async buildPortfolio(childId: string, params: ReportJobParams) {
    const viewer = reportAudience(params);
    const data = await this.repo.loadPortfolioData(childId, viewer);
    if (!data.child) throw new Error("Child not found");

    /*
      ★ A fixed ceiling, never one sized to the child — 2026-10-19 review.
      `report-images.ts`: "only a count bounds the total". The exact design
      prints artworks and albums rather than three photos an age, so it gets
      the room the repository's two `take`s allow — and no more.
    */
    const budget = new ImageBudget(
      MAX_PORTFOLIO_ARTWORKS + MAX_PORTFOLIO_ALBUM_PHOTOS + 2,
      2 * MAX_IMAGE_BYTES_PER_REPORT,
    );
    const childPhoto = await this.embed(budget, data.child.photo);
    // The identity marks always win the image budget.
    const logo = await this.embed(budget, data.child.kindergarten.logo);

    const enrollment =
      data.child.enrollments.find((item) => item.status === "ACTIVE") ??
      data.child.enrollments[data.child.enrollments.length - 1];

    /*
     * RFP §5.3 — each comparison embeds two images, and both go through the
     * same `ImageBudget` as everything else. The conclusion still prints when
     * a historical image is unavailable.
     */
    const comparisons: PortfolioData["artworkComparisons"] = [];
    for (const comparison of data.artworkComparisons) {
      comparisons.push({
        conclusion: comparison.conclusion,
        earlierDataUri: null,
        laterDataUri: null,
        earlierTakenAt: comparison.earlierMedia?.takenAt ?? null,
        laterTakenAt: comparison.laterMedia?.takenAt ?? null,
      });
    }

    const observations: PortfolioData["observations"] = [];
    for (const observation of data.observations) {
      observations.push({
        source: observation.source,
        typeName: observation.type.name,
        observedOn: observation.observedOn,
        activityName: observation.activityName,
        situation: observation.situation,
        childDid: observation.childDid,
        childSaid: observation.childSaid,
        teacherComment: observation.teacherComment,
        photoDataUris: [],
      });
    }

    const artworks: PortfolioData["artworks"] = [];
    for (const artwork of data.artworks) {
      const dataUri = await this.embed(budget, artwork);
      if (!dataUri) continue;
      artworks.push({
        type: artwork.observation?.activityName?.trim() || "Бусад",
        age: artwork.age,
        dataUri,
        caption: artwork.caption,
        madeOn: artwork.takenAt ?? artwork.observation?.observedOn ?? artwork.uploadedAt,
      });
    }

    const milestones: PortfolioData["milestones"] = [];
    for (const milestone of data.milestones) {
      milestones.push({
        // A suggested kind needs no title of its own; never print its code.
        title: milestone.title?.trim() || MILESTONE_KIND_LABEL[milestone.kind] || "Онцгой мөч",
        occurredOn: milestone.occurredOn,
        description: milestone.description,
        photoDataUris: [],
      });
    }

    const photoAlbums: PortfolioData["photoAlbums"] = [];
    const albumSummary = new Map<string, number>();
    for (const photo of data.albumPhotos) {
      const label =
        photo.albumCategory?.name ??
        (isAgeAlbumCategory(photo.category)
          ? AGE_ALBUM_CATEGORY_LABEL[photo.category]
          : (photo.category ?? "Бусад"));
      albumSummary.set(label, (albumSummary.get(label) ?? 0) + 1);
    }
    const albumGroups = new Map<string, PortfolioData["photoAlbums"][number]>();
    for (const photo of data.albumPhotos) {
      const isTeacherSent =
        photo.attribution === "TEACHER" && !photo.category && !photo.albumCategory;
      const label = isTeacherSent
        ? "Багшийн илгээсэн зураг"
        : (photo.albumCategory?.name ??
          (isAgeAlbumCategory(photo.category)
            ? AGE_ALBUM_CATEGORY_LABEL[photo.category]
            : photo.category === "FIRST_DAY"
              ? "Цэцэрлэгийн анхны өдөр"
              : photo.category === "GRADUATION"
                ? "Цэцэрлэгээ төгслөө"
                : (photo.category ?? "Бусад")));
      const key = `${photo.age ?? "all"}:${label}`;
      let group = albumGroups.get(key);
      if (!group) {
        group = { key, label, age: photo.age, attribution: photo.attribution, photos: [] };
        albumGroups.set(key, group);
      }
      {
        const dataUri = await this.embed(budget, photo);
        if (!dataUri) continue;
        group.photos.push({
          dataUri,
          caption: photo.caption,
          takenAt: photo.takenAt,
          categoryLabel:
            photo.albumCategory?.name ??
            (isAgeAlbumCategory(photo.category)
              ? AGE_ALBUM_CATEGORY_LABEL[photo.category]
              : photo.category),
        });
      }
    }
    photoAlbums.push(...albumGroups.values());

    const payload: PortfolioData = {
      child: {
        lastName: data.child.lastName,
        firstName: data.child.firstName,
        dateOfBirth: data.child.dateOfBirth,
        sex: data.child.sex,
        photoDataUri: childPhoto,
      },
      kindergarten: { name: data.child.kindergarten.name, logoDataUri: logo },
      group: enrollment?.group ?? null,
      teachers: enrollment?.group.teachers.map((teacher) => teacher.membership.user) ?? [],
      schoolYear: enrollment?.schoolYear ?? null,
      enrollments: data.child.enrollments.map((item) => ({
        kindergartenName: item.kindergarten.name,
        groupName: item.group.name,
        schoolYearName: item.schoolYear.name,
        startedOn: item.startedOn,
        endedOn: item.endedOn,
        status: item.status,
      })),
      aboutMe: data.aboutMe
        ? {
            introduction: data.aboutMe.introduction,
            nameMeaning: data.aboutMe.nameMeaning,
            memorableSayings: data.aboutMe.memorableSayings,
            dream: data.aboutMe.dream,
            distinguishingTraits: data.aboutMe.distinguishingTraits,
            clanName: data.aboutMe.clanName,
            nickname: data.aboutMe.nickname,
            birthplace: data.aboutMe.birthplace,
            bloodType: data.aboutMe.bloodType,
            eyeColor: data.aboutMe.eyeColor,
            yearAnimalCode: data.aboutMe.yearAnimalCode,
            zodiacCode: data.aboutMe.zodiacCode,
            heightCm: data.aboutMe.heightCm,
            weightKg: data.aboutMe.weightKg,
            recordedOn: data.aboutMe.recordedOn,
          }
        : null,
      ageProfiles: data.ageProfiles,
      birthdayNotes: data.birthdayNotes,
      observations,
      growthMeasurements: data.growthMeasurements,
      milestones,
      artworkComparisons: comparisons,
      artworks,
      photoAlbums,
      albumSummary: [...albumSummary].map(([label, count]) => ({ label, count })),
      /*
        The graduation letter, or — until a teacher writes one — the latest
        age's `teacherNote`, which is where the letter lived before #260. No
        backfill: the fallback keeps every letter already written in print.
      */
      teacherLetter:
        data.aboutMe?.graduationLetter?.trim() ||
        ([...data.ageProfiles]
          .sort((a, b) => b.age - a.age)
          .find((profile) => profile.teacherNote?.trim())?.teacherNote ??
          null),
      generatedAt: new Date(),
      omittedPhotoCount: budget.dropped,
    };

    const fullName = `${data.child.lastName} ${data.child.firstName}`;

    return {
      html: renderPortfolioHtml(payload),
      chrome: portfolioChrome(fullName, data.child.kindergarten.name),
      filename: `${fullName} — хөгжлийн хавтас.pdf`,
    };
  }

  private async buildTermReport(childId: string, params: ReportJobParams) {
    if (!params.termId) throw new Error("Term report job has no termId");

    const viewer = reportAudience(params);
    const data = await this.repo.loadTermReportData(childId, params.termId, viewer);
    if (!data.child) throw new Error("Child not found");

    // ★ A guardian's query already filtered to FINAL, so a missing row here
    // means either "not written" or "still a draft" — and the job must fail
    // rather than emit an empty PDF that looks like an official document.
    if (!data.termReport) throw new Error("Term report not available for this audience");

    const budget = new ImageBudget();
    const childPhoto = await this.embed(budget, data.child.photo);
    const logo = await this.embed(budget, data.child.kindergarten.logo);
    const enrollment =
      data.child.enrollments.find((item) => item.status === "ACTIVE") ??
      data.child.enrollments[data.child.enrollments.length - 1];

    const payload: TermReportData = {
      child: {
        lastName: data.child.lastName,
        firstName: data.child.firstName,
        dateOfBirth: data.child.dateOfBirth,
        photoDataUri: childPhoto,
      },
      kindergarten: { name: data.child.kindergarten.name, logoDataUri: logo },
      group: enrollment?.group ?? null,
      schoolYear: enrollment?.schoolYear ?? null,
      term: {
        name: data.termReport.term.name,
        number: data.termReport.term.number,
        startsOn: data.termReport.term.startsOn,
        endsOn: data.termReport.term.endsOn,
      },
      report: {
        strengths: data.termReport.strengths,
        needsSupport: data.termReport.needsSupport,
        nextGoals: data.termReport.nextGoals,
        adviceForParents: data.termReport.adviceForParents,
        finalizedAt: data.termReport.finalizedAt,
        authorName: data.termReport.author
          ? `${data.termReport.author.lastName} ${data.termReport.author.firstName}`
          : null,
        // ★ A guardian can never reach a draft — their query filters to FINAL.
        // A teacher legitimately can, previewing their own text, and the page
        // must say so: without the banner it carries a signature block and
        // prints as a document a parent could be handed at a meeting.
        isDraft: data.termReport.status !== "FINAL",
      },
      assessments: data.assessments.map((a) => ({
        domainName: a.domain.name,
        levelLabel: a.level.label,
        levelColor: a.level.color ?? "#6b7280",
        comment: a.comment,
      })),
      generatedAt: new Date(),
    };

    const fullName = `${data.child.lastName} ${data.child.firstName}`;
    const termName = data.termReport.term.name;

    return {
      html: renderTermReportHtml(payload),
      chrome: termReportChrome(fullName, data.child.kindergarten.name, termName),
      filename: `${fullName} — ${termName}.pdf`,
    };
  }

  /**
   * The annual consolidated report — RFP §6.5.
   *
   * ★ Every term of the year gets a column, including the ones with no
   * assessment.
   *
   * The point of an annual comparison is the *shape* of the progress, and
   * dropping an empty column turns "we did not assess in the winter" into
   * "there was no winter". `terms` comes from the school year, not from the
   * assessments, and the grid is filled against it.
   */
  /**
   * A financial report — `нэмэлт.md` §16.
   *
   * ★ **The rows are read now, not when the job was queued.**
   *
   * `params` carries only the report key and the period. A job that carried its
   * own copy of the data would print the figures as they stood the moment the
   * button was pressed, and an attendance correction landing in the seconds
   * before the worker ran would leave the PDF and the screen disagreeing with
   * nothing to say which was right. Reading here means the file states the
   * ledger at the moment it was rendered — the timestamp it prints.
   *
   * ★★ The same `ReportTable` the screen and the spreadsheet use, so a column
   * added to a report reaches all three without being written three times.
   */
  /**
   * The onboarding contract — `docs/CONTRACT_ONBOARDING.md` step 4.
   *
   * ★★ Every figure is read from the `Contract` row, which froze them at
   * approval time. Nothing here consults a live price. Re-rendering a contract
   * signed in March must produce March's prices or the PDF disagrees with the
   * sealed paper in the kindergarten's file.
   */
  private async buildContract(params: ReportJobParams) {
    if (!params.contractId) throw new Error("Contract job has no contractId");

    const contract = await this.repo.contractForPdf(params.contractId);
    if (!contract) throw new Error(`Contract ${params.contractId} not found`);

    return {
      html: renderContractHtml({
        number: contract.number,
        version: contract.version,
        kindergartenName: contract.application.kindergartenName,
        registrationNumber: contract.application.registrationNumber,
        address: contract.application.address,
        directorName: contract.application.directorName,
        phone: contract.application.phone,
        email: contract.application.email,
        terms: contractTerms(contract),
        startsOn: contract.startsOn,
        endsOn: contract.endsOn,
        generatedAt: new Date(),
      }),
      chrome: contractChrome(contract.number, contract.application.kindergartenName),
      filename: `${contract.number}.pdf`,
    };
  }

  private buildServiceInvoice(params: ReportJobParams) {
    const invoice = params.serviceInvoice;
    if (!invoice) throw new Error("Service invoice job has no figures");
    return {
      html: renderServiceInvoiceHtml(invoice),
      chrome: serviceInvoiceChrome(invoice.kindergartenName),
      filename: `nehemjleh-${invoice.contractNumber}-${invoice.issuedOn}.pdf`,
    };
  }

  private async buildFinanceReport(kindergartenId: string, params: ReportJobParams) {
    if (!params.financeReport || !params.financePeriod) {
      throw new Error("Finance report requires a report key and a period");
    }

    const [table, kindergartenName] = await Promise.all([
      this.financeReports.tableFor(
        kindergartenId,
        params.financeReport as never,
        params.financePeriod,
      ),
      this.financeReports.kindergartenName(kindergartenId),
    ]);

    const generatedAt = new Date();

    return {
      html: renderFinanceReportHtml({
        title: table.title,
        kindergartenName,
        period: params.financePeriod,
        note: table.note,
        columns: table.columns,
        rows: table.rows,
        totals: table.totals,
        generatedAt,
      }),
      chrome: financeReportChrome(table.title, kindergartenName, params.financePeriod),
      filename: `${params.financeReport}-${params.financePeriod}.pdf`,
    };
  }

  private async buildAnnualReport(childId: string, params: ReportJobParams) {
    if (!params.schoolYearId) throw new Error("Annual report requires a schoolYearId");

    const viewer = reportAudience(params);
    const data = await this.repo.loadAnnualReportData(childId, params.schoolYearId, viewer);
    if (!data.child) throw new Error("Child not found");
    if (!data.schoolYear) throw new Error("School year not found");

    const budget = new ImageBudget();
    const childPhoto = await this.embed(budget, data.child.photo);
    const logo = await this.embed(budget, data.child.kindergarten.logo);

    const termIndex = new Map(data.terms.map((term, index) => [term.id, index]));

    /*
     * One row per domain, one cell per term.
     *
     * Keyed by domain id rather than name: two domains may share a display name
     * across a system default and a kindergarten's own override, and merging
     * them would silently average two different criteria into one row.
     */
    const byDomain = new Map<
      string,
      { name: string; order: number; levels: (AnnualLevel | null)[] }
    >();

    for (const assessment of data.assessments) {
      const row = byDomain.get(assessment.domain.id) ?? {
        name: assessment.domain.name,
        order: assessment.domain.order,
        levels: Array.from({ length: data.terms.length }, () => null),
      };

      const index = termIndex.get(assessment.term.id);
      if (index !== undefined) {
        row.levels[index] = {
          value: assessment.level.value,
          label: assessment.level.label,
          color: assessment.level.color ?? "#6b7280",
        };
      }

      byDomain.set(assessment.domain.id, row);
    }

    const domains = [...byDomain.values()]
      .sort((x, y) => x.order - y.order)
      .map((row) => ({
        name: row.name,
        levels: row.levels,
        // First assessed term to last. Null when fewer than two terms carry a
        // level: "±0" for a child assessed once states a result nobody measured.
        change: levelChange(row.levels),
      }));

    const fullName = `${data.child.lastName} ${data.child.firstName}`;
    const enrollment =
      data.child.enrollments.find((item) => item.status === "ACTIVE") ??
      data.child.enrollments[data.child.enrollments.length - 1];

    const payload: AnnualReportData = {
      child: {
        lastName: data.child.lastName,
        firstName: data.child.firstName,
        dateOfBirth: data.child.dateOfBirth,
        photoDataUri: childPhoto,
      },
      kindergarten: { name: data.child.kindergarten.name, logoDataUri: logo },
      group: enrollment?.group ?? null,
      schoolYear: {
        name: data.schoolYear.name,
        startsOn: data.schoolYear.startsOn,
        endsOn: data.schoolYear.endsOn,
      },
      terms: data.terms,
      domains,
      termReports: data.termReports.map((report) => ({
        termName: report.term.name,
        strengths: report.strengths,
        needsSupport: report.needsSupport,
        nextGoals: report.nextGoals,
        adviceForParents: report.adviceForParents,
        authorName: report.author ? `${report.author.lastName} ${report.author.firstName}` : null,
      })),
      generatedAt: new Date(),
      filteredForGuardian: viewer.isGuardian,
    };

    return {
      html: renderAnnualReportHtml(payload),
      chrome: annualReportChrome(fullName, data.child.kindergarten.name, data.schoolYear.name),
      filename: `${fullName} — ${data.schoolYear.name}.pdf`,
    };
  }

  /**
   * Fetches one object and hands it to the budget.
   *
   * A missing or unreadable object yields `null` rather than throwing. Storage
   * has its own availability, and one photo that 404s must not fail a whole
   * portfolio — the report is still worth having without it.
   */
  private async embed(
    budget: ImageBudget,
    media: { storageKey: string; deletedAt?: Date | null } | null | undefined,
  ): Promise<string | null> {
    if (!media || media.deletedAt) return null;

    try {
      const buffer = await this.storage.get(media.storageKey);
      return await budget.add(buffer);
    } catch (error) {
      this.logger.warn(`Skipping unreadable report image: ${(error as Error).name}`);
      return null;
    }
  }
}

/**
 * Counts pages without a PDF library.
 *
 * `/Type /Page` (not `/Pages`) appears once per page in the object table, and
 * Puppeteer's output is not object-stream compressed, so this is reliable for
 * documents *we* produce. It is a display figure, not a correctness-critical
 * one — a wrong count shows the wrong number in a list, nothing more.
 */
function countPages(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

/** One term's level for one domain, as the annual grid holds it. */
interface AnnualLevel {
  value: number;
  label: string;
  color: string;
}

/**
 * The movement from the first assessed term to the last.
 *
 * Null when fewer than two terms carry a level. A child assessed once has no
 * change to report, and printing "±0" would state a comparison that was never
 * made — the same distinction the template draws between "—" and a number.
 */
function levelChange(levels: (AnnualLevel | null)[]): number | null {
  const assessed = levels.filter((level): level is AnnualLevel => level !== null);
  if (assessed.length < 2) return null;
  return assessed[assessed.length - 1]!.value - assessed[0]!.value;
}

/**
 * Which generation of pricing a contract row holds (see `ContractTerms`).
 *
 * ★ `.toString()`, never `Number()` — the decimal crosses as a string, which is
 * the whole reason the columns are `Decimal` (§2.2). A row with neither set
 * of figures is a defect, and a contract printed without its price is worse
 * than a failed job.
 */
function contractTerms(c: {
  childCount: number | null;
  annualFee: { toString(): string } | null;
  perChildMonthlyFee: { toString(): string } | null;
  groupCount: number | null;
  billingPeriod: "TERM" | "YEAR" | null;
  perGroupMonthlyFee: { toString(): string } | null;
  periodFee: { toString(): string } | null;
}): ContractTerms {
  if (c.groupCount !== null && c.billingPeriod && c.perGroupMonthlyFee && c.periodFee) {
    return {
      kind: "perGroup",
      groupCount: c.groupCount,
      billingPeriod: c.billingPeriod,
      perGroupMonthlyFee: c.perGroupMonthlyFee.toString(),
      periodFee: c.periodFee.toString(),
    };
  }
  if (c.childCount !== null && c.annualFee && c.perChildMonthlyFee) {
    return {
      kind: "perChild",
      childCount: c.childCount,
      annualFee: c.annualFee.toString(),
      perChildMonthlyFee: c.perChildMonthlyFee.toString(),
    };
  }
  throw new Error("Contract has no pricing terms");
}
