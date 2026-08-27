import { Injectable, Logger } from "@nestjs/common";
import { StorageService } from "../storage/storage.service";
import { ReportsRepository } from "./reports.repository";
import { PdfRendererService } from "./pdf-renderer.service";
import { ImageBudget } from "./report-images";
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

/** How long a generated file stays downloadable before the sweep removes it. */
const RESULT_TTL_DAYS = 14;

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
    if (!job || !job.childId) {
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
      const { html, chrome, filename } =
        job.type === "TERM_REPORT"
          ? await this.buildTermReport(job.childId, params)
          : job.type === "ANNUAL_REPORT"
            ? await this.buildAnnualReport(job.childId, params)
            : await this.buildPortfolio(job.childId, params);

      const pdf = await this.renderer.render(html, chrome);

      const storageKey = this.storage.buildKindergartenKey(job.kindergartenId, "reports");
      await this.storage.put(storageKey, pdf, "application/pdf");

      // The object exists before anything points at it: a crash between the two
      // leaves a collectable orphan rather than a row that 404s for ever. The
      // same ordering as MediaService.upload.
      const { attached } = await this.repo.completeJob(jobId, {
        kindergartenId: job.kindergartenId,
        childId: job.childId,
        storageKey,
        originalName: filename,
        fileSize: pdf.byteLength,
        pageCount: countPages(pdf),
        expiresAt: new Date(Date.now() + RESULT_TTL_DAYS * 24 * 60 * 60 * 1000),
      });

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

    const budget = new ImageBudget();
    const childPhoto = await this.embed(budget, data.child.photo);
    // RFP §10.3. Embedded before the observation photographs so a portfolio with
    // a full album still has the identity mark: `ImageBudget` refuses images
    // once the total is spent, and the first caller wins.
    const logo = await this.embed(budget, data.child.kindergarten.logo);

    const observations: PortfolioData["observations"] = [];
    for (const obs of data.observations) {
      const photoDataUris: string[] = [];
      for (const media of obs.media) {
        const uri = await this.embed(budget, media);
        if (uri) photoDataUris.push(uri);
      }
      observations.push({
        observedOn: obs.observedOn,
        typeName: obs.type.name,
        situation: obs.situation,
        childDid: obs.childDid,
        childSaid: obs.childSaid,
        teacherComment: obs.teacherComment,
        nextSteps: obs.nextSteps,
        photoDataUris,
      });
    }

    const enrollment = data.child.enrollments[0];

    /*
     * RFP §5.3 — each comparison embeds two images, and both go through the
     * same `ImageBudget` as everything else. Embedded after the observations so
     * a portfolio that is already at its ceiling loses the comparison's
     * *pictures* rather than an observation's: the conclusion still prints, and
     * the template renders a pair with a missing image as a labelled gap.
     */
    const comparisons: PortfolioData["artworkComparisons"] = [];
    for (const comparison of data.artworkComparisons) {
      comparisons.push({
        conclusion: comparison.conclusion,
        earlierDataUri: await this.embed(budget, comparison.earlierMedia),
        laterDataUri: await this.embed(budget, comparison.laterMedia),
        earlierTakenAt: comparison.earlierMedia?.takenAt ?? null,
        laterTakenAt: comparison.laterMedia?.takenAt ?? null,
      });
    }

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
      schoolYear: enrollment?.schoolYear ?? null,
      aboutMe: data.aboutMe
        ? {
            introduction: data.aboutMe.introduction,
            nameMeaning: data.aboutMe.nameMeaning,
            memorableSayings: data.aboutMe.memorableSayings,
            dream: data.aboutMe.dream,
            distinguishingTraits: data.aboutMe.distinguishingTraits,
            heightCm: data.aboutMe.heightCm,
            weightKg: data.aboutMe.weightKg,
          }
        : null,
      ageProfiles: data.ageProfiles,
      birthdayNotes: data.birthdayNotes,
      milestones: data.milestones,
      artworkComparisons: comparisons,
      observations,
      assessments: data.assessments.map((a) => ({
        termName: a.term.name,
        domainName: a.domain.name,
        levelLabel: a.level.label,
        levelColor: a.level.color ?? "#6b7280",
        comment: a.comment,
      })),
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
    const enrollment = data.child.enrollments[0];

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
    const enrollment = data.child.enrollments[0];

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
