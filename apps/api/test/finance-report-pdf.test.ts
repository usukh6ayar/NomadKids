import type { INestApplication } from "@nestjs/common";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { ReportGeneratorService } from "../src/reports/report-generator.service";
import { StorageService } from "../src/storage/storage.service";

/**
 * `нэмэлт.md` §16's reports as PDF.
 *
 * ★★★ **The security property this file exists for: a financial report must be
 * unreachable through every child-report route.**
 *
 * A `FINANCE_REPORT` job carries no `childId`, and `ReportsService` opens each
 * of its methods with `if (!job || !job.childId) throw new NotFoundException()`.
 * That is what makes the two paths safe to have side by side — but "the guard is
 * there" and "the guard fires" are different claims, and only a test that asks
 * the real route with a real finance job id can tell them apart.
 *
 * ★ Text is extracted with poppler, not counted in bytes. CLAUDE.md §4.3: a
 * generator returning a megabyte of blank pages passes every "did it produce a
 * file" check, and that is exactly the failure an empty fontconfig produces
 * (`docs/PDF_SPIKE.md` §4).
 */

let app: INestApplication;
let generator: ReportGeneratorService;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let accountantA: AuthSession;
let adminB: AuthSession;

const MONTH = "2026-02";
const MONTH_START = new Date("2026-02-01T00:00:00.000Z");

function extractText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "kinder-fin-pdf-"));
  const path = join(dir, "report.pdf");
  writeFileSync(path, pdf);
  return execFileSync("pdftotext", ["-enc", "UTF-8", path, "-"], { encoding: "utf8" });
}

function pdftotextAvailable(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasPoppler = pdftotextAvailable();

beforeAll(async () => {
  app = await createTestApp();
  generator = app.get(ReportGeneratorService);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const accountant = await createUser({ username: `acct-${Date.now()}` });
  await createMembership(accountant.id, a.kindergarten.id, "ACCOUNTANT");

  [adminA, teacherA, parentA, accountantA, adminB] = await Promise.all([
    login(app, a.adminUser.username),
    login(app, a.teacherUser.username),
    login(app, a.parentUser.username),
    login(app, accountant.username),
    login(app, b.adminUser.username),
  ]);
});

async function calculation(over: Record<string, unknown> = {}) {
  return db.fundingCalculation.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      source: "STATE",
      month: MONTH_START,
      daysAttended: 20,
      daysFed: 20,
      dailyRate: "1000.00",
      calculatedAmount: "20000.00",
      approvedAmount: "20000.00",
      ...over,
    } as never,
  });
}

function queuePdf(session: AuthSession, report = "state-funding", period = MONTH) {
  return authed(
    request(app.getHttpServer()).post(
      `/v1/kindergartens/${a.kindergarten.id}/invoices/reports/pdf`,
    ),
    session,
  ).send({ report, period });
}

describe("queueing a financial report PDF", () => {
  it("refuses a teacher — нэмэлт.md §13", async () => {
    expect((await queuePdf(teacherA)).status).toBe(404);
  });

  it("refuses an admin from another kindergarten", async () => {
    expect((await queuePdf(adminB)).status).toBe(404);
  });

  it("queues a job for the accountant", async () => {
    const res = await queuePdf(accountantA);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("QUEUED");
    expect(res.body.report).toBe("state-funding");
    expect(res.body.period).toBe(MONTH);
  });

  it("creates the job with no child at all", async () => {
    // The fact that keeps every child-report route from serving it.
    const res = await queuePdf(adminA);

    const job = await db.reportJob.findUnique({ where: { id: res.body.id } });
    expect(job?.childId).toBeNull();
    expect(job?.type).toBe("FINANCE_REPORT");
  });

  it("rejects a malformed period at the button, not in the worker", async () => {
    // Otherwise the only symptom is a job marked FAILED twenty seconds later,
    // with a message the requester cannot act on.
    expect((await queuePdf(adminA, "state-funding", "not-a-month")).status).toBe(400);
    expect((await queuePdf(adminA, "annual", "2026-02")).status).toBe(400);
  });

  it("records the request — §14", async () => {
    await queuePdf(accountantA).expect(201);

    const entries = await db.auditLog.findMany({ where: { objectType: "FinanceReportPdf" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.metadata).toMatchObject({ report: "state-funding", period: MONTH });
  });
});

describe("a financial report is invisible to the child report routes", () => {
  async function financeJobId(): Promise<string> {
    const res = await queuePdf(adminA);
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("returns 404 from the child report status route", async () => {
    const jobId = await financeJobId();

    // `/reports/:id` gates on `canAccessChild`, which a job with no child
    // cannot satisfy — so the guard fires rather than the check being skipped.
    const res = await authed(request(app.getHttpServer()).get(`/v1/reports/${jobId}`), adminA);
    expect(res.status).toBe(404);
  });

  it("returns 404 from the child report download route", async () => {
    const jobId = await financeJobId();

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/reports/${jobId}/download`),
      adminA,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a guardian who somehow has the id", async () => {
    const jobId = await financeJobId();

    for (const path of [`/v1/finance-reports/${jobId}`, `/v1/reports/${jobId}`]) {
      const res = await authed(request(app.getHttpServer()).get(path), parentA);
      expect(res.status).toBe(404);
    }
  });

  it("refuses a teacher on the finance route", async () => {
    const jobId = await financeJobId();

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/finance-reports/${jobId}`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });
});

describe("the finance PDF route refuses a child report", () => {
  it("404s for a portfolio job id, even from an accountant", async () => {
    /*
     * ★ The mirror of the block above, and the reason `load()` checks the type.
     * Without it, an accountant with a portfolio job's id would pass the
     * finance gate — they do have finance rights here — while the child gate
     * that should apply never ran.
     */
    const portfolio = await db.reportJob.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        type: "CHILD_PORTFOLIO",
        params: { audience: "STAFF", audienceUserId: a.adminUser.id },
        requestedById: a.adminUser.id,
      } as never,
    });

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/finance-reports/${portfolio.id}`),
      accountantA,
    );
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!hasPoppler)("the rendered document", () => {
  it("contains the report's title, its figures and its total — as text", async () => {
    await calculation({ calculatedAmount: "20000.00" });

    const queued = await queuePdf(adminA);
    const result = await generator.run(queued.body.id as string);
    expect(result.status).toBe("DONE");

    const job = await db.reportJob.findUnique({
      where: { id: queued.body.id as string },
      include: { resultMedia: true },
    });
    expect(job?.status).toBe("DONE");

    const storage = app.get(StorageService);
    const pdf = await storage.get(job!.resultMedia!.storageKey);
    const text = extractText(pdf);

    /*
     * ★★★ Cyrillic in the text layer is the canary. With fonts missing,
     * Chromium renders a page of blank boxes and reports success — the file has
     * pages, has bytes, and says nothing. Only extraction catches it.
     */
    expect(text).toContain("Сарын улсын санхүүжилтийн тайлан");
    // The child by name, from the fixture — a report that lost its rows would
    // still have the title.
    expect(text).toContain(a.child.lastName);
    expect(text).toContain(a.child.firstName);
    // Formatted money, not the raw "20000.00" the database holds.
    expect(text).toMatch(/20 000₮/);
    expect(text).toContain("хүүхэд");
  });

  it("says an empty report is empty rather than printing a bare table", async () => {
    // A blank grid and a broken export look identical on paper.
    const queued = await queuePdf(adminA, "variance");
    await generator.run(queued.body.id as string);

    const job = await db.reportJob.findUnique({
      where: { id: queued.body.id as string },
      include: { resultMedia: true },
    });

    const pdf = await app.get(StorageService).get(job!.resultMedia!.storageKey);
    expect(extractText(pdf)).toContain("бичлэг алга");
  });

  it("attaches the file with no child, so /media/:id cannot serve it", async () => {
    await calculation();
    const queued = await queuePdf(adminA);
    await generator.run(queued.body.id as string);

    const job = await db.reportJob.findUnique({
      where: { id: queued.body.id as string },
      include: { resultMedia: true },
    });

    expect(job!.resultMedia!.childId).toBeNull();

    // `MediaService.getDownloadUrl` ends with
    // `if (!media.childId) throw new NotFoundException()`, so the ledger cannot
    // leak through the child-media route.
    const res = await authed(
      request(app.getHttpServer()).get(`/v1/media/${job!.resultMediaFileId}`),
      adminA,
    );
    expect(res.status).toBe(404);
  });

  it("issues a download link to finance staff and records it — §14", async () => {
    await calculation();
    const queued = await queuePdf(accountantA);
    await generator.run(queued.body.id as string);

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/finance-reports/${queued.body.id}/download`),
      accountantA,
    );

    expect(res.status).toBe(200);
    expect(res.body.url).toContain("http");

    const downloads = await db.auditLog.findMany({
      where: { objectType: "FinanceReportPdf", action: "DOWNLOAD" },
    });
    expect(downloads).toHaveLength(1);
  });

  it("refuses a download before the job is finished", async () => {
    const queued = await queuePdf(adminA);

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/finance-reports/${queued.body.id}/download`),
      adminA,
    );
    expect(res.status).toBe(400);
  });
});
