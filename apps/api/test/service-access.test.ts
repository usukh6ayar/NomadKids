import type { INestApplication } from "@nestjs/common";
import { quote } from "../src/service-access/service-access.service";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localDate } from "@kinder/contracts";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { ReportGeneratorService } from "../src/reports/report-generator.service";
import { StorageService } from "../src/storage/storage.service";

/**
 * A kindergarten's own NomadKids access and its renewal invoice (#211 items
 * 6–7). The invoice is a queued PDF; it is asserted on its extracted text
 * (CLAUDE.md §4.3).
 */
process.env.SERVICE_INVOICE_BANK_NAME = "Хаан банк";
process.env.SERVICE_INVOICE_BANK_ACCOUNT = "5000123456";
process.env.SERVICE_INVOICE_ACCOUNT_HOLDER = "НомадКидс ХХК";

let app: INestApplication;
let generator: ReportGeneratorService;
const db = testDb();
const server = () => app.getHttpServer();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let adminB: AuthSession;
let teacherA: AuthSession;

const DAY = 86_400_000;
const TODAY = new Date(`${localDate()}T00:00:00.000Z`);

function extractText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "kinder-invoice-"));
  const path = join(dir, "invoice.pdf");
  writeFileSync(path, pdf);
  return execFileSync("pdftotext", ["-enc", "UTF-8", path, "-"], { encoding: "utf8" });
}

function hasPoppler(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  app = await createTestApp();
  generator = app.get(ReportGeneratorService);
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
  adminB = await login(app, b.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
});

/** A per-group contract in force for kindergarten A, ending `days` from today. */
async function contract(days: number, perGroupMonthlyFee: string | null = "4000.00") {
  const application = await db.kindergartenApplication.create({
    data: {
      kindergartenName: a.kindergarten.name,
      registrationNumber: "1234567",
      directorName: "Бат Сүх",
      phone: "99001122",
      email: `${uniq("kg")}@example.mn`,
      groupCount: 1,
      status: "APPROVED",
      kindergartenId: a.kindergarten.id,
    },
  });
  return db.contract.create({
    data: {
      applicationId: application.id,
      kindergartenId: a.kindergarten.id,
      number: `NK-2026-${uniq("n").slice(-6)}`,
      status: "ACTIVE",
      groupCount: 1,
      billingPeriod: "TERM",
      perGroupMonthlyFee,
      periodFee: perGroupMonthlyFee ? "12000.00" : null,
      startsOn: new Date(TODAY.getTime() - 60 * DAY),
      endsOn: new Date(TODAY.getTime() + days * DAY),
    },
  });
}

const status = (who: AuthSession) =>
  request(server()).get("/v1/service-access").set("Cookie", who.cookies);
const requestInvoice = (who: AuthSession, period: string) =>
  authed(request(server()).post("/v1/service-access/invoices"), who).send({ period });

describe("GET /service-access", () => {
  it("reads the contract in force, priced on the groups running now", async () => {
    const signed = await contract(10);
    // The period after the contract's end, at the sheet's price (2026-10-18).
    const next = (period: "TERM" | "YEAR") => quote(signed, 1, period);

    const res = await status(adminA);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      period: "term",
      groupCount: 1,
      daysLeft: 10,
      remind: true,
      perGroupMonthlyFee: "4000",
      // The user's prices (2026-10-22): «I-р улирал» 4,000₮ through
      // 2026-11-30, then 12,000₮; a year is its months left × 4,000₮.
      termAmount: next("TERM").amount,
      yearAmount: next("YEAR").amount,
      termCoversTo: next("TERM").coversTo,
    });
    expect(res.body.expiresAt).toBe(
      new Date(TODAY.getTime() + 10 * DAY).toISOString().slice(0, 10),
    );
  });

  it("keeps a negotiated monthly fee as agreed — fee × 3 and fee × the months", async () => {
    const signed = await contract(10, "3500.00");

    const res = await status(adminA);

    expect(res.body).toMatchObject({
      termAmount: "10500.00",
      yearAmount: quote(signed, 1, "YEAR").amount,
    });
  });

  it("does not remind more than 14 days out", async () => {
    await contract(40);

    expect((await status(adminA)).body.remind).toBe(false);
  });

  it("answers a kindergarten with no contract row with nulls, not a 404", async () => {
    const res = await status(adminA);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ expiresAt: null, period: null, groupCount: 1, remind: false });
  });

  it("is each director's own kindergarten, and closed to a teacher and to a solo workspace", async () => {
    await contract(10);

    const other = await status(adminB);
    const named = await request(server())
      .get("/v1/service-access")
      .query({ kindergartenId: a.kindergarten.id })
      .set("Cookie", adminB.cookies);
    const byTeacher = await status(teacherA);
    await db.kindergarten.update({
      where: { id: a.kindergarten.id },
      data: { kind: "SOLO_TEACHER" },
    });
    const solo = await status(adminA);

    expect(other.body.expiresAt).toBeNull();
    expect([named.status, byTeacher.status, solo.status]).toEqual([404, 404, 404]);
  });
});

describe("the renewal invoice", () => {
  // From 2 May a year has no month left to charge — refused, never a 0₮
  // invoice or QR (review of #270, the user 2026-10-23).
  it("refuses a year from 2 May, and the status offers none", async () => {
    const signed = await contract(10);
    await db.contract.update({
      where: { id: signed.id },
      data: { endsOn: new Date("2027-04-30T00:00:00.000Z") },
    });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-05-10T04:00:00.000Z") });
    try {
      // Signed in on the faked day, so the session is not already past.
      const admin = await login(app, a.adminUser.username);

      const year = await requestInvoice(admin, "year");
      const pay = await authed(request(server()).post("/v1/service-access/qpay"), admin).send({
        period: "year",
      });
      const shown = await status(admin);

      expect(year.status).toBe(400);
      expect(pay.status).toBe(400);
      expect(shown.body.yearAmount).toBeNull();
      expect(await db.contractPayment.count({ where: { contractId: signed.id } })).toBe(0);
      expect(await db.reportJob.count()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // A row drawn before June became a bonus ended 31 May; paid as it stood,
  // the settlement would have ended the contract there (review of #270).
  it("moves a pending row's end to the rule's when it is reused", async () => {
    const signed = await contract(10);
    const priced = quote(signed, 1, "YEAR");
    const mayEnd = `${priced.coversTo.slice(0, 4)}-05-31`;
    const row = await db.contractPayment.create({
      data: {
        kindergartenId: a.kindergarten.id,
        contractId: signed.id,
        period: "YEAR",
        coversFrom: new Date(`${priced.coversFrom}T00:00:00.000Z`),
        coversTo: new Date(`${mayEnd}T00:00:00.000Z`),
        groupCount: 1,
        perGroupAmount: priced.perGroup,
        amount: priced.amount,
      },
    });

    const res = await requestInvoice(adminA, "year");

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const after = await db.contractPayment.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.coversTo.toISOString().slice(0, 10)).toBe(priced.coversTo);
    expect(await db.contractPayment.count({ where: { contractId: signed.id } })).toBe(1);
    const audit = await db.auditLog.findFirst({
      where: { objectType: "ContractPayment", objectId: row.id, action: "UPDATE" },
    });
    expect(audit?.metadata).toMatchObject({
      before: { coversTo: mayEnd },
      after: { coversTo: priced.coversTo },
    });
  });

  it("refuses a contract with no per-group fee — the operator quotes that one", async () => {
    await contract(10, null);

    const res = await requestInvoice(adminA, "year");

    expect(res.status).toBe(400);
    expect(await db.reportJob.count()).toBe(0);
  });

  it("is another kindergarten's director's 404", async () => {
    await contract(10);
    const queued = await requestInvoice(adminA, "term");

    const read = await request(server())
      .get(`/v1/service-access/invoices/${queued.body.id}`)
      .set("Cookie", adminB.cookies);
    const download = await request(server())
      .get(`/v1/service-access/invoices/${queued.body.id}/download`)
      .set("Cookie", adminB.cookies);

    expect(queued.status).toBe(201);
    expect([read.status, download.status]).toEqual([404, 404]);
  });

  it.skipIf(!hasPoppler())(
    "prints the kindergarten, the amount and the bank account — as text",
    { timeout: 30_000 },
    async () => {
      const signed = await contract(10);

      const queued = await requestInvoice(adminA, "year");
      expect(queued.status, JSON.stringify(queued.body)).toBe(201);
      // The year's months left × 4,000₮ (2026-10-22), as the status quotes it.
      expect(queued.body).toMatchObject({
        period: "year",
        amount: quote(signed, 1, "YEAR").amount,
      });

      expect((await generator.run(queued.body.id as string)).status).toBe("DONE");
      const job = await db.reportJob.findUniqueOrThrow({
        where: { id: queued.body.id as string },
        include: { resultMedia: true },
      });
      expect(job.childId).toBeNull();
      const pdf = await app.get(StorageService).get(job.resultMedia!.storageKey);
      const text = extractText(pdf);

      expect(text).toContain("Нэхэмжлэх");
      expect(text).toContain(a.kindergarten.name);
      // The PDF prints the quoted amount — «24 000₮» style, thin-spaced.
      const quoted = Number(quote(signed, 1, "YEAR").amount)
        .toLocaleString("en-US")
        .replace(",", " ");
      expect(text).toContain(`${quoted}₮`);
      // A long period label wraps the table's header — compare the text flattened.
      expect(text.replace(/\s+/g, " ")).toContain("Нэг бүлгийн төлбөр");
      expect(text).toContain("5000123456");
      expect(text).toContain(signed.number);

      const link = await request(server())
        .get(`/v1/service-access/invoices/${queued.body.id}/download`)
        .set("Cookie", adminA.cookies);
      expect(link.status).toBe(200);
      expect(link.body.url).toEqual(expect.any(String));
    },
  );
});
