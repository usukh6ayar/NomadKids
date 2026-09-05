import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createUser,
  linkGuardian,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { StorageService } from "../src/storage/storage.service";
import { ReportGeneratorService } from "../src/reports/report-generator.service";
import { ReportRetentionService } from "../src/reports/report-retention.service";

/**
 * Reports — RFP §10.3 (portfolio) and §6.4 (term report).
 *
 * Runs the real generator: real Postgres, real MinIO, real Chromium. The
 * worker is switched off in tests (`test/setup.ts`), so generation is driven by
 * calling `ReportGeneratorService.run()` — the same method the queue calls,
 * with none of the timing.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;
let generator: ReportGeneratorService;
let storageAvailable = true;

/** Text the parent's copy must never contain. */
const PRIVATE_NOTE = "Зөвхөн багшид зориулсан нууц тэмдэглэл";
/** Text both copies must contain — the Cyrillic canary for extraction. */
const SHARED_NOTE = "Хүүхэд өнөөдөр найзуудтайгаа сайхан тоглолоо";

beforeAll(async () => {
  app = await createTestApp();
  generator = app.get(ReportGeneratorService);
  storageAvailable = await app.get(StorageService).isReachable();
  if (!storageAvailable) {
    console.error(
      "\n⚠ MinIO unreachable — report tests will FAIL.\n  docker compose up -d storage\n",
    );
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

async function seedObservations(scenario: Scenario) {
  const type = await db.observationType.findFirstOrThrow({ where: { kindergartenId: null } });

  await db.observation.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      childId: scenario.child.id,
      enrollmentId: scenario.enrollment.id,
      typeId: type.id,
      source: "TEACHER",
      observedOn: new Date("2025-10-01"),
      situation: SHARED_NOTE,
      visibleToParents: true,
      reviewStatus: "APPROVED",
      includeInReport: true,
      authorId: scenario.teacherUser.id,
    },
  });

  await db.observation.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      childId: scenario.child.id,
      enrollmentId: scenario.enrollment.id,
      typeId: type.id,
      source: "TEACHER",
      observedOn: new Date("2025-10-02"),
      situation: PRIVATE_NOTE,
      // The default, spelled out: a teacher's working note is private.
      visibleToParents: false,
      reviewStatus: "APPROVED",
      includeInReport: true,
      authorId: scenario.teacherUser.id,
    },
  });
}

async function createJob(session: AuthSession, childId: string) {
  const response = await authed(request(app.getHttpServer()).post("/v1/reports"), session).send({
    childId,
    type: "CHILD_PORTFOLIO",
  });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

/**
 * A logo, as distinct from `photoBytes` elsewhere: PNG, and square-ish, because
 * that is what a kindergarten actually uploads and what `object-fit: contain`
 * exists to preserve.
 */
async function logoBytes(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: "navy" } })
    .png()
    .toBuffer();
}

/** Extracts the text layer with poppler. */
function extractText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "kinder-pdf-"));
  const path = join(dir, "report.pdf");
  writeFileSync(path, pdf);
  return execFileSync("pdftotext", ["-enc", "UTF-8", path, "-"], { encoding: "utf8" });
}

/**
 * Counts the raster images embedded in a PDF, with poppler.
 *
 * ★ The text layer cannot answer "is the logo on the page".
 *
 * A logo is a picture: `pdftotext` returns nothing for it whether it rendered,
 * failed to decode, or was never embedded at all. Counting the image XObjects
 * is what distinguishes those, and it is the same reasoning as `PDF_SPIKE.md`
 * §4 — assert on the artefact, not on the intent.
 */
function countImages(pdf: Buffer): number {
  const dir = mkdtempSync(join(tmpdir(), "kinder-pdf-"));
  const path = join(dir, "report.pdf");
  writeFileSync(path, pdf);
  const listing = execFileSync("pdfimages", ["-list", path], { encoding: "utf8" });
  // Two header lines, then one row per image.
  return listing.trim().split("\n").slice(2).filter(Boolean).length;
}

function pdftotextAvailable(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function generatedPdf(jobId: string): Promise<Buffer> {
  const result = await generator.run(jobId);
  expect(result.status).toBe("DONE");

  const job = await db.reportJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { resultMedia: true },
  });
  expect(job.resultMedia).not.toBeNull();

  return app.get(StorageService).get(job.resultMedia!.storageKey);
}

// ── Authorization ───────────────────────────────────────────────────────────

describe("POST /v1/reports — authorization", () => {
  it("a teacher from another group gets 404", async () => {
    const other = await createScenario("c");
    const response = await authed(request(app.getHttpServer()).post("/v1/reports"), teacherA).send({
      childId: other.child.id,
      type: "CHILD_PORTFOLIO",
    });
    expect(response.status).toBe(404);
  });

  it("a guardian of another child gets 404", async () => {
    const response = await authed(request(app.getHttpServer()).post("/v1/reports"), parentA).send({
      childId: b.child.id,
      type: "CHILD_PORTFOLIO",
    });
    expect(response.status).toBe(404);
  });

  it("a user from another kindergarten gets 404", async () => {
    const response = await authed(request(app.getHttpServer()).post("/v1/reports"), parentB).send({
      childId: a.child.id,
      type: "CHILD_PORTFOLIO",
    });
    expect(response.status).toBe(404);
  });

  it("a parent may request their own child's portfolio", async () => {
    const response = await authed(request(app.getHttpServer()).post("/v1/reports"), parentA).send({
      childId: a.child.id,
      type: "CHILD_PORTFOLIO",
    });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe("QUEUED");
  });
});

describe("GET /v1/reports/:jobId", () => {
  it("returns 404 for someone else's job", async () => {
    const jobId = await createJob(teacherA, a.child.id);

    const response = await authed(
      request(app.getHttpServer()).get(`/v1/reports/${jobId}`),
      parentA,
    );
    expect(response.status).toBe(404);
  });

  it("returns the job to its requester", async () => {
    const jobId = await createJob(teacherA, a.child.id);

    const response = await authed(
      request(app.getHttpServer()).get(`/v1/reports/${jobId}`),
      teacherA,
    );
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(jobId);
    expect(response.body.downloadable).toBe(false);
  });
});

/**
 * ★ The cross-audience leak.
 *
 * A generated PDF freezes one viewer's visibility filter into a file. A
 * guardian passes `canAccessChild` for their own child, so an access-only
 * download rule would hand them the teacher's copy.
 */
describe("GET /v1/reports/:jobId/download — audience", () => {
  it("refuses a guardian the teacher's copy of their own child's report", async () => {
    await seedObservations(a);
    const jobId = await createJob(teacherA, a.child.id);
    await generatedPdf(jobId);

    const response = await authed(
      request(app.getHttpServer()).get(`/v1/reports/${jobId}/download`),
      parentA,
    );
    expect(response.status).toBe(404);
  });

  it("issues a URL to the requester once the job is done", async () => {
    await seedObservations(a);
    const jobId = await createJob(teacherA, a.child.id);
    await generatedPdf(jobId);

    const response = await authed(
      request(app.getHttpServer()).get(`/v1/reports/${jobId}/download`),
      teacherA,
    );
    expect(response.status).toBe(200);
    expect(response.body.url).toContain("http");
  });

  it("refuses to sign a URL before the job has finished", async () => {
    const jobId = await createJob(teacherA, a.child.id);

    const response = await authed(
      request(app.getHttpServer()).get(`/v1/reports/${jobId}/download`),
      teacherA,
    );
    expect(response.status).toBe(400);
  });

  it("refuses a teacher whose group assignment has since been revoked", async () => {
    await seedObservations(a);
    const jobId = await createJob(teacherA, a.child.id);
    await generatedPdf(jobId);

    await db.groupTeacher.update({
      where: { id: a.assignment.id },
      data: { endedOn: new Date("2025-11-01") },
    });

    const response = await authed(
      request(app.getHttpServer()).get(`/v1/reports/${jobId}/download`),
      teacherA,
    );
    expect(response.status).toBe(404);
  });
});

describe("GET /v1/children/:id/reports", () => {
  it("lists only the caller's own jobs", async () => {
    await createJob(teacherA, a.child.id);
    await createJob(parentA, a.child.id);

    const asTeacher = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/reports`),
      teacherA,
    );
    expect(asTeacher.status).toBe(200);
    expect(asTeacher.body.items).toHaveLength(1);
    expect(asTeacher.body.total).toBe(1);

    const asParent = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/reports`),
      parentA,
    );
    expect(asParent.body.items).toHaveLength(1);
    expect(asParent.body.items[0].id).not.toBe(asTeacher.body.items[0].id);
  });
});

// ── Generation ──────────────────────────────────────────────────────────────

describe("portfolio generation", () => {
  /**
   * ★ The test the whole spike was for.
   *
   * `PDF_SPIKE.md` §4: with an empty fontconfig set, Chromium renders **no text
   * at all** — not tofu, nothing — while images, borders and page breaks all
   * work. The job reports success and a parent downloads a blank portfolio of
   * their child. Asserting the PDF is non-empty, or that it has pages, passes in
   * exactly that state. Only extracted text catches it.
   */
  it("produces a PDF containing extractable Mongolian Cyrillic text", async () => {
    if (!pdftotextAvailable()) {
      throw new Error(
        "pdftotext (poppler) is required for this test: brew install poppler / apt install poppler-utils",
      );
    }

    await seedObservations(a);
    const jobId = await createJob(teacherA, a.child.id);
    const pdf = await generatedPdf(jobId);

    const text = extractText(pdf);

    expect(text.trim().length).toBeGreaterThan(0);
    // Cyrillic is present at all…
    expect(text).toMatch(/[Ѐ-ӿ]/);
    // …including the two characters unique to Mongolian, which a Russian-only
    // fallback font would drop.
    expect(text).toMatch(/[өүӨҮ]/);
    // …and the actual content, not just chrome.
    expect(text).toContain(a.child.lastName);
    expect(text).toContain(SHARED_NOTE);
  }, 120_000);

  /**
   * RFP §4.2 in the artefact the family keeps.
   *
   * ★ Asserted on extracted text, not on the template string, and that is the
   * whole point of the test. The birthday section used to render only when a
   * note existed, so this content could be computed correctly and still never
   * reach a page — a unit test on `birthFacts` would have passed throughout.
   *
   * The scenario child is born 2021-04-12: Хонь, and an Үхэр year.
   */
  it("prints the zodiac sign and the year animal in the birthday section", async () => {
    if (!pdftotextAvailable()) throw new Error("pdftotext (poppler) is required");

    const jobId = await createJob(teacherA, a.child.id);
    const text = extractText(await generatedPdf(jobId));

    expect(text).toContain("Төрсөн өдрийн мэдээлэл");
    expect(text).toContain("Өрнийн орд");
    expect(text).toContain("Хонь");
    expect(text).toContain("Монгол жил");
    expect(text).toContain("Үхэр");
  }, 120_000);

  /**
   * RFP §10.3 — "Цэцэрлэгийн лого, нэртэй" on every generated report.
   *
   * ★ Measured by counting embedded images before and after, because the name
   * was already printed and the logo never was. A test that only looked for the
   * kindergarten's name in the text layer would have passed for months against
   * a PDF that had no logo in it — which is exactly the state this closes.
   */
  it("embeds the kindergarten's logo once it has one", async () => {
    if (!pdftotextAvailable()) throw new Error("pdftotext (poppler) is required");

    const before = countImages(await generatedPdf(await createJob(teacherA, a.child.id)));

    const logo = await authed(
      request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/logo`),
      adminA,
    ).attach("file", await logoBytes(), "лого.png");
    expect(logo.status).toBe(201);

    const after = countImages(await generatedPdf(await createJob(teacherA, a.child.id)));
    expect(after).toBe(before + 1);

    // The name is still there — the logo is an addition, not a replacement.
    const text = extractText(await generatedPdf(await createJob(teacherA, a.child.id)));
    expect(text).toContain(a.kindergarten.name);
  }, 180_000);

  /**
   * RFP §5.3's last bullet — "Харьцуулалтыг PDF тайланд оруулах" — and §4.5's
   * milestones, which belong in the portfolio they are part of.
   *
   * ★ The conclusion is asserted on extracted text and the pair on the image
   * count, because the two fail differently: a comparison whose images were
   * dropped by the budget still prints its sentence, and that is deliberate.
   */
  it("prints artwork comparisons and milestones", async () => {
    if (!pdftotextAvailable()) throw new Error("pdftotext (poppler) is required");

    const before = countImages(await generatedPdf(await createJob(teacherA, a.child.id)));

    // Two works, six months apart, and the teacher's reading of the change.
    const uploads: string[] = [];
    for (const takenAt of ["2025-01-10", "2025-06-10"]) {
      const res = await authed(
        request(app.getHttpServer()).post(`/v1/children/${a.child.id}/media`),
        teacherA,
      )
        .field("category", "ARTWORK")
        .field("takenAt", takenAt)
        .attach("file", await logoBytes(), "бүтээл.png");
      expect(res.status).toBe(201);
      uploads.push(res.body.items[0].id as string);
    }

    const CONCLUSION = "Хожим нь хүнийг зурахдаа гар, хөлийг тусад нь зурсан.";
    await authed(
      request(app.getHttpServer()).post(`/v1/children/${a.child.id}/artwork/comparisons`),
      teacherA,
    ).send({ mediaIdA: uploads[0], mediaIdB: uploads[1], conclusion: CONCLUSION });

    await authed(
      request(app.getHttpServer()).post(`/v1/children/${a.child.id}/milestones`),
      teacherA,
    ).send({ kind: "FIRST_STEP", occurredOn: "2024-03-15", description: "Гурван алхам." });

    const pdf = await generatedPdf(await createJob(teacherA, a.child.id));
    const text = extractText(pdf);

    expect(text).toContain("Бүтээлийн хөгжлийн харьцуулалт");
    expect(text).toContain(CONCLUSION);
    expect(text).toContain("Онцгой үйл явдал");
    expect(text).toContain("Анхны алхам");

    // Both works of the pair are embedded, not just referenced.
    expect(countImages(pdf)).toBe(before + 2);
  }, 180_000);

  /**
   * RFP §6.5 — the annual consolidated report, and §21.7's acceptance criterion
   * ("Улирлын болон нэгдсэн PDF тайлан зөв үүсдэг байх").
   *
   * Asserted on extracted text: the four-term comparison table and the year's
   * closing text are the document, and a blank render passes every other check.
   */
  it("generates the annual report with a term comparison", async () => {
    if (!pdftotextAvailable()) throw new Error("pdftotext (poppler) is required");

    const term = await db.term.create({
      data: {
        kindergartenId: a.kindergarten.id,
        schoolYearId: a.schoolYear.id,
        name: "I улирал",
        number: 1,
        startsOn: new Date("2025-09-01"),
        endsOn: new Date("2025-11-30"),
      },
    });

    const domain = await db.developmentDomain.findFirstOrThrow({ where: { kindergartenId: null } });
    const level = await db.assessmentLevel.findFirstOrThrow({
      where: { kindergartenId: null, value: 3 },
    });

    await db.assessment.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        enrollmentId: a.enrollment.id,
        termId: term.id,
        domainId: domain.id,
        levelId: level.id,
        visibleToParents: true,
        assessedById: a.teacherUser.id,
      },
    });

    await db.termReport.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        enrollmentId: a.enrollment.id,
        termId: term.id,
        status: "FINAL",
        strengths: "Найзуудтайгаа сайн харилцдаг",
        authorId: a.teacherUser.id,
      },
    });

    const created = await authed(request(app.getHttpServer()).post("/v1/reports"), teacherA).send({
      childId: a.child.id,
      type: "ANNUAL_REPORT",
      schoolYearId: a.schoolYear.id,
    });
    expect(created.status).toBe(201);

    const text = extractText(await generatedPdf(created.body.id as string));

    expect(text).toContain("жилийн нэгдсэн тайлан");
    expect(text).toContain("Улирлын харьцуулалт");
    expect(text).toContain("I улирал");
    expect(text).toContain(domain.name);
    expect(text).toContain("Найзуудтайгаа сайн харилцдаг");
  }, 180_000);

  it("refuses an annual report with no school year", async () => {
    const res = await authed(request(app.getHttpServer()).post("/v1/reports"), teacherA).send({
      childId: a.child.id,
      type: "ANNUAL_REPORT",
    });
    expect(res.status).toBe(400);
  });

  it("records page count and file size on the job", async () => {
    await seedObservations(a);
    const jobId = await createJob(teacherA, a.child.id);
    await generatedPdf(jobId);

    const job = await db.reportJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("DONE");
    expect(job.pageCount).toBeGreaterThan(0);
    expect(job.fileSize).toBeGreaterThan(1000);
    expect(job.expiresAt).not.toBeNull();
    expect(job.progressPercent).toBe(100);
  }, 120_000);

  /**
   * ★ The parent's copy is filtered at generation time.
   *
   * The same predicate the list endpoint uses (`readableWhere`) — asserted here
   * on the rendered text, because that is the artefact the family actually
   * receives and forwards.
   */
  it("omits private teaching notes from a guardian's copy", async () => {
    if (!pdftotextAvailable()) throw new Error("pdftotext (poppler) is required");

    await seedObservations(a);

    const parentJobId = await createJob(parentA, a.child.id);
    const parentText = extractText(await generatedPdf(parentJobId));

    expect(parentText).toContain(SHARED_NOTE);
    expect(parentText).not.toContain(PRIVATE_NOTE);

    const teacherJobId = await createJob(teacherA, a.child.id);
    const teacherText = extractText(await generatedPdf(teacherJobId));

    expect(teacherText).toContain(SHARED_NOTE);
    expect(teacherText).toContain(PRIVATE_NOTE);
  }, 180_000);

  it("is idempotent — a repeated run does not produce a second file", async () => {
    await seedObservations(a);
    const jobId = await createJob(teacherA, a.child.id);

    await generatedPdf(jobId);
    const first = await db.reportJob.findUniqueOrThrow({ where: { id: jobId } });

    // BullMQ delivers at least once; a retry after a network blip must not
    // orphan the first PDF in storage.
    await generator.run(jobId);
    const second = await db.reportJob.findUniqueOrThrow({ where: { id: jobId } });

    expect(second.resultMediaFileId).toBe(first.resultMediaFileId);
    expect(
      await db.mediaFile.count({ where: { childId: a.child.id, purpose: "REPORT_OUTPUT" } }),
    ).toBe(1);
  }, 120_000);

  /**
   * ★ The orphan a redelivered job used to create.
   *
   * BullMQ delivers at least once. A worker killed mid-render leaves the row at
   * RUNNING; the job comes back and a second PDF is generated. Attaching the
   * media and updating the job separately let the second overwrite
   * `resultMediaFileId` — and the first object then sits in the bucket with
   * nothing referencing it, invisible to `listExpired` and uncollectable by the
   * retention sweep, containing a child's record.
   */
  it("does not orphan the first PDF when a RUNNING job is redelivered", async () => {
    await seedObservations(a);
    const jobId = await createJob(teacherA, a.child.id);
    await generatedPdf(jobId);

    const first = await db.reportJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { resultMedia: true },
    });

    // Exactly the state a killed worker leaves behind.
    await db.reportJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });

    await generator.run(jobId);

    const second = await db.reportJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(second.resultMediaFileId).toBe(first.resultMediaFileId);
    expect(second.status).toBe("DONE");

    // One media row, and the original object is still the one it points at.
    expect(
      await db.mediaFile.count({ where: { childId: a.child.id, purpose: "REPORT_OUTPUT" } }),
    ).toBe(1);
    await expect(
      app.get(StorageService).get(first.resultMedia!.storageKey),
    ).resolves.toBeInstanceOf(Buffer);
  }, 180_000);

  /**
   * ★ A swallowed error resolves the queue job successfully, which makes
   * `attempts: 3` dead configuration — a renderer killed under memory pressure
   * would never get the quieter second attempt it usually needs.
   */
  it("re-throws for the worker so BullMQ retries engage", async () => {
    const job = await db.reportJob.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        type: "TERM_REPORT",
        params: { audience: "STAFF", audienceUserId: a.teacherUser.id },
        requestedById: a.teacherUser.id,
      },
    });

    await expect(generator.run(job.id, true)).rejects.toThrow();

    // Still recorded before the throw, so the requester sees why.
    const failed = await db.reportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
  }, 60_000);

  it("records a safe failure message, never the underlying error", async () => {
    const job = await db.reportJob.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        type: "TERM_REPORT",
        // No termId: the generator will throw.
        params: { audience: "STAFF", audienceUserId: a.teacherUser.id },
        requestedById: a.teacherUser.id,
      },
    });

    const result = await generator.run(job.id);
    expect(result.status).toBe("FAILED");

    const failed = await db.reportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toBe("Тайлан үүсгэхэд алдаа гарлаа. Дахин оролдоно уу.");
    // No storage key, no table name, no stack.
    expect(failed.errorMessage).not.toMatch(/reports\/|children\/|at .*\.ts:/);
  }, 60_000);
});

// ── Retention ───────────────────────────────────────────────────────────────

/**
 * ★ A generated PDF is a copy of a child's record living in object storage,
 * outside the permission system that produced it. Everything else is authorized
 * on every read; this is authorized once. So it expires.
 */
describe("report retention", () => {
  it("removes an expired file, keeps the job row, and stops the download", async () => {
    await seedObservations(a);
    const jobId = await createJob(teacherA, a.child.id);
    await generatedPdf(jobId);

    const before = await db.reportJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { resultMedia: true },
    });
    const storageKey = before.resultMedia!.storageKey;

    await db.reportJob.update({
      where: { id: jobId },
      data: { expiresAt: new Date("2020-01-01") },
    });

    const { removed } = await app.get(ReportRetentionService).sweep();
    expect(removed).toBe(1);

    // The row survives: what was generated for whom stays auditable.
    const after = await db.reportJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(after.status).toBe("DONE");
    expect(after.resultMediaFileId).toBeNull();

    // The object is gone from storage.
    await expect(app.get(StorageService).get(storageKey)).rejects.toThrow();

    const download = await authed(
      request(app.getHttpServer()).get(`/v1/reports/${jobId}/download`),
      teacherA,
    );
    expect(download.status).toBe(400);
  }, 120_000);

  /**
   * ★ A job nobody is working on must not poll for ever.
   *
   * The row commits and the enqueue happens after it, so a process death in
   * between leaves QUEUED work with no consumer. Re-enqueueing is a no-op when
   * the job is genuinely still queued, because the BullMQ job id is the row id.
   */
  it("re-enqueues a job that was accepted but never picked up", async () => {
    const jobId = await createJob(teacherA, a.child.id);

    // Fresh jobs are left alone — a busy worker must not be second-guessed.
    expect((await app.get(ReportRetentionService).requeueStale()).requeued).toBe(0);

    await db.reportJob.update({
      where: { id: jobId },
      data: { requestedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    expect((await app.get(ReportRetentionService).requeueStale()).requeued).toBe(1);
  });

  it("leaves an unexpired file alone", async () => {
    await seedObservations(a);
    const jobId = await createJob(teacherA, a.child.id);
    await generatedPdf(jobId);

    const { removed } = await app.get(ReportRetentionService).sweep();
    expect(removed).toBe(0);

    const job = await db.reportJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.resultMediaFileId).not.toBeNull();
  }, 120_000);
});

// ── Term reports ────────────────────────────────────────────────────────────

describe("term reports", () => {
  async function createTerm(scenario: Scenario) {
    return db.term.create({
      data: {
        kindergartenId: scenario.kindergarten.id,
        schoolYearId: scenario.schoolYear.id,
        number: 1,
        name: `I улирал ${uniq()}`,
        startsOn: new Date("2025-09-01"),
        endsOn: new Date("2025-12-31"),
      },
    });
  }

  it("refuses a guardian a term report that is still a draft", async () => {
    const term = await createTerm(a);
    await db.termReport.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        enrollmentId: a.enrollment.id,
        termId: term.id,
        strengths: "Сайн хөгжиж байна",
        status: "DRAFT",
        authorId: a.teacherUser.id,
      },
    });

    const response = await authed(request(app.getHttpServer()).post("/v1/reports"), parentA).send({
      childId: a.child.id,
      type: "TERM_REPORT",
      termId: term.id,
    });
    expect(response.status).toBe(400);
  });

  it("generates a finalised term report with Cyrillic text", async () => {
    if (!pdftotextAvailable()) throw new Error("pdftotext (poppler) is required");

    const term = await createTerm(a);
    const strengths = "Багаараа ажиллах чадвар өндөр хөгжсөн";

    await db.termReport.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        enrollmentId: a.enrollment.id,
        termId: term.id,
        strengths,
        nextGoals: "Үсэг таних дадлыг үргэлжлүүлэх",
        status: "FINAL",
        finalizedAt: new Date("2026-01-05"),
        authorId: a.teacherUser.id,
      },
    });

    const created = await authed(request(app.getHttpServer()).post("/v1/reports"), parentA).send({
      childId: a.child.id,
      type: "TERM_REPORT",
      termId: term.id,
    });
    expect(created.status).toBe(201);

    const text = extractText(await generatedPdf(created.body.id));
    expect(text).toContain(strengths);
    expect(text).toMatch(/[өүӨҮ]/);
  }, 120_000);

  /**
   * ★ A teacher may preview their own draft — but the page must say so.
   *
   * Without the banner the rendered draft carries a signature block and a
   * "Баталгаажсан:" line with an empty date. It looks official, prints as
   * official, and can be handed to a parent at a meeting with nothing to
   * indicate it is provisional.
   */
  it("stamps ТӨСӨЛ on a teacher's preview of an unfinalised report", async () => {
    if (!pdftotextAvailable()) throw new Error("pdftotext (poppler) is required");

    const term = await createTerm(a);
    await db.termReport.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        enrollmentId: a.enrollment.id,
        termId: term.id,
        strengths: "Тэмдэглэлийн ноорог",
        status: "DRAFT",
        authorId: a.teacherUser.id,
      },
    });

    const created = await authed(request(app.getHttpServer()).post("/v1/reports"), teacherA).send({
      childId: a.child.id,
      type: "TERM_REPORT",
      termId: term.id,
    });
    expect(created.status).toBe(201);

    const text = extractText(await generatedPdf(created.body.id));
    expect(text).toContain("ТӨСӨЛ");
    // No signature block on a draft — that is what makes it look official.
    expect(text).not.toContain("Эцэг эх / асран хамгаалагч");
  }, 120_000);

  it("rejects a term report request with no termId", async () => {
    const response = await authed(request(app.getHttpServer()).post("/v1/reports"), teacherA).send({
      childId: a.child.id,
      type: "TERM_REPORT",
    });
    expect(response.status).toBe(400);
  });
});

// ── Input handling ──────────────────────────────────────────────────────────

describe("request validation", () => {
  it("does not accept a client-supplied audience", async () => {
    const response = await authed(request(app.getHttpServer()).post("/v1/reports"), parentA).send({
      childId: a.child.id,
      type: "CHILD_PORTFOLIO",
      audience: "STAFF",
    });
    // `.strict()` — an unknown key is a rejected request, not a silently
    // ignored one. Silently ignoring it is how a client comes to believe the
    // field works.
    expect(response.status).toBe(400);
  });

  it("stores the audience derived from the requester", async () => {
    const jobId = await createJob(parentA, a.child.id);
    const job = await db.reportJob.findUniqueOrThrow({ where: { id: jobId } });

    expect(job.params).toMatchObject({ audience: "GUARDIAN", audienceUserId: parentA.userId });
  });

  it("marks a second guardian's request as GUARDIAN too", async () => {
    const father = await createUser({ username: uniq("father") });
    await createMembership(father.id, a.kindergarten.id, "PARENT");
    await linkGuardian(a.kindergarten.id, a.child.id, father.id);

    const session = await login(app, father.username);
    const jobId = await createJob(session, a.child.id);
    const job = await db.reportJob.findUniqueOrThrow({ where: { id: jobId } });

    expect(job.params).toMatchObject({ audience: "GUARDIAN" });
  });
});
