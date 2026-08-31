import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createChild,
  createMembership,
  createScenario,
  createUser,
  enrollChild,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * The financial dashboard — `нэмэлт.md` §9.
 *
 * ★ Every figure is aggregated from rows that already exist, so each test here
 * writes the underlying records and asks the real HTTP route what it now says.
 * A test that seeded a stored total would only prove the seed.
 *
 * ★★ The two discriminating cases are the ones worth reading:
 * `overdue` is deliberately **not** month-scoped, and the meal average divides
 * by children who ate rather than by everyone enrolled. Both are easy to
 * "simplify" into something that looks right and reports the wrong number.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let accountantA: AuthSession;
let adminB: AuthSession;

const MONTH = "2026-02";
const MONTH_START = new Date("2026-02-01T00:00:00.000Z");

function date(day: number): Date {
  return new Date(`2026-02-${String(day).padStart(2, "0")}T00:00:00.000Z`);
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const accountant = await createUser({ username: `acct-${Date.now()}` });
  await createMembership(accountant.id, a.kindergarten.id, "ACCOUNTANT");

  [adminA, teacherA, accountantA, adminB] = await Promise.all([
    login(app, a.adminUser.username),
    login(app, a.teacherUser.username),
    login(app, accountant.username),
    login(app, b.adminUser.username),
  ]);
});

function dashboard(session: AuthSession, month = MONTH, kindergartenId = a.kindergarten.id) {
  return authed(
    request(app.getHttpServer()).get(
      `/v1/kindergartens/${kindergartenId}/invoices/dashboard?month=${month}`,
    ),
    session,
  );
}

async function mealRule(over: Record<string, unknown> = {}) {
  return db.fundingRule.create({
    data: {
      kindergartenId: a.kindergarten.id,
      name: "Хоолны мөнгө",
      source: "PARENT",
      invoiceItemKind: "MEAL",
      effectiveFrom: date(1),
      dailyRate: "2500.00",
      dependsOnAttendance: false,
      dependsOnMeals: true,
      ...over,
    } as never,
  });
}

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
      ...over,
    } as never,
  });
}

async function invoice(over: Record<string, unknown> = {}) {
  return db.invoice.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      month: MONTH_START,
      number: `2026-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      subtotalAmount: "50000.00",
      totalAmount: "50000.00",
      issuedAt: new Date("2026-02-01T00:00:00.000Z"),
      ...over,
    } as never,
  });
}

async function payment(invoiceId: string, amount: string, over: Record<string, unknown> = {}) {
  return db.payment.create({
    data: {
      kindergartenId: a.kindergarten.id,
      invoiceId,
      amount,
      method: "CASH",
      status: "PAID",
      paidAt: date(10),
      ...over,
    } as never,
  });
}

describe("authorization", () => {
  it("refuses a teacher — нэмэлт.md §13", async () => {
    expect((await dashboard(teacherA)).status).toBe(404);
  });

  it("refuses an admin from another kindergarten", async () => {
    expect((await dashboard(adminB)).status).toBe(404);
  });

  it("admits the accountant", async () => {
    expect((await dashboard(accountantA)).status).toBe(200);
  });
});

describe("state funding — §9's first three figures", () => {
  it("derives what is pending from approved minus received", async () => {
    await calculation({ approvedAmount: "20000.00", receivedAmount: "12000.00" });

    const res = await dashboard(adminA);

    expect(res.body.state.approved).toBe("20000.00");
    expect(res.body.state.received).toBe("12000.00");
    expect(res.body.state.pending).toBe("8000.00");
  });

  it("never reports a negative pending amount", async () => {
    // An overpayment is a reconciliation question, not "−5 000₮ pending".
    await calculation({ approvedAmount: "20000.00", receivedAmount: "25000.00" });

    expect((await dashboard(adminA)).body.state.pending).toBe("0.00");
  });

  it("ignores another kindergarten's funding", async () => {
    await calculation({ approvedAmount: "20000.00" });
    await db.fundingCalculation.create({
      data: {
        kindergartenId: b.kindergarten.id,
        childId: b.child.id,
        source: "STATE",
        month: MONTH_START,
        daysAttended: 20,
        daysFed: 20,
        calculatedAmount: "99999.00",
        approvedAmount: "99999.00",
      } as never,
    });

    expect((await dashboard(adminA)).body.state.approved).toBe("20000.00");
  });
});

describe("parent billing", () => {
  it("counts issued invoices and what has been collected against them", async () => {
    const one = await invoice();
    await payment(one.id, "20000.00");

    const res = await dashboard(adminA);

    expect(res.body.parents.invoices).toBe(1);
    expect(res.body.parents.billed).toBe("50000.00");
    expect(res.body.parents.paid).toBe("20000.00");
    expect(res.body.parents.unpaid).toBe("30000.00");
  });

  it("excludes a draft invoice — it is not a claim on anybody", async () => {
    await invoice({ issuedAt: null });

    const res = await dashboard(adminA);
    expect(res.body.parents.invoices).toBe(0);
    expect(res.body.parents.billed).toBe("0.00");
  });

  it("excludes a refunded invoice from what is owed", async () => {
    await invoice({ status: "REFUNDED" });

    expect((await dashboard(adminA)).body.parents.billed).toBe("0.00");
  });

  it("subtracts a reversal, because it carries a negative amount", async () => {
    const one = await invoice();
    const paid = await payment(one.id, "50000.00");
    await payment(one.id, "-50000.00", { reversalOfId: paid.id });

    const res = await dashboard(adminA);
    expect(res.body.parents.paid).toBe("0.00");
    expect(res.body.parents.unpaid).toBe("50000.00");
  });

  it("counts a payment by the invoice's month, not the payment's date", async () => {
    // A parent paying February's bill in March is February's income; moving it
    // would leave February permanently short.
    const one = await invoice();
    await payment(one.id, "50000.00", { paidAt: new Date("2026-03-15T00:00:00.000Z") });

    expect((await dashboard(adminA)).body.parents.paid).toBe("50000.00");
  });
});

describe("overdue — the figure that is deliberately not month-scoped", () => {
  it("includes an older month's unpaid invoice", async () => {
    // Scoping this to the month would make arrears vanish on the first of
    // every month, which is the opposite of what an accountant needs.
    await invoice({
      month: new Date("2026-01-01T00:00:00.000Z"),
      dueDate: new Date("2026-01-10T00:00:00.000Z"),
      totalAmount: "30000.00",
    });

    const res = await dashboard(adminA);
    expect(res.body.parents.overdueCount).toBe(1);
    expect(res.body.parents.overdueAmount).toBe("30000");
  });

  it("counts only what is still outstanding on a part-paid invoice", async () => {
    const one = await invoice({
      dueDate: new Date("2026-02-05T00:00:00.000Z"),
      totalAmount: "50000.00",
    });
    await payment(one.id, "30000.00");

    const res = await dashboard(adminA);
    expect(res.body.parents.overdueCount).toBe(1);
    expect(res.body.parents.overdueAmount).toBe("20000");
  });

  it("drops an invoice that has been paid in full", async () => {
    const one = await invoice({
      dueDate: new Date("2026-02-05T00:00:00.000Z"),
      totalAmount: "50000.00",
    });
    await payment(one.id, "50000.00");

    expect((await dashboard(adminA)).body.parents.overdueCount).toBe(0);
  });

  it("reads the due date rather than trusting a stale status", async () => {
    // Nothing has touched this invoice since its date passed, so its status is
    // still UNPAID. The date is the fact; the status is a cache of it.
    await invoice({
      dueDate: new Date("2026-02-05T00:00:00.000Z"),
      status: "UNPAID",
      totalAmount: "15000.00",
    });

    expect((await dashboard(adminA)).body.parents.overdueCount).toBe(1);
  });

  it("ignores an invoice whose due date has not arrived", async () => {
    await invoice({ dueDate: new Date("2099-01-01T00:00:00.000Z") });

    expect((await dashboard(adminA)).body.parents.overdueCount).toBe(0);
  });
});

describe("meal cost — §3's calculation, §9's last two figures", () => {
  it("divides by the children who ate, not by everyone enrolled", async () => {
    /*
     * The discriminating case. A second child is enrolled and never eats; the
     * average must be the fed child's own cost, not half of it.
     */
    const rule = await mealRule();
    const other = await createChild(a.kindergarten.id);
    await enrollChild(a.kindergarten.id, other.id, a.group.id, a.schoolYear.id);

    await calculation({
      source: "PARENT",
      fundingRuleId: rule.id,
      daysFed: 20,
      calculatedAmount: "50000.00",
    });

    const res = await dashboard(adminA);
    expect(res.body.meals.children).toBe(1);
    expect(res.body.meals.total).toBe("50000.00");
    expect(res.body.meals.perChild).toBe("50000.00");
  });

  it("averages across the children who did eat", async () => {
    const rule = await mealRule();
    const other = await createChild(a.kindergarten.id);
    await enrollChild(a.kindergarten.id, other.id, a.group.id, a.schoolYear.id);

    await calculation({
      source: "PARENT",
      fundingRuleId: rule.id,
      calculatedAmount: "50000.00",
    });
    await calculation({
      childId: other.id,
      source: "PARENT",
      fundingRuleId: rule.id,
      calculatedAmount: "30000.00",
    });

    const res = await dashboard(adminA);
    expect(res.body.meals.children).toBe(2);
    expect(res.body.meals.total).toBe("80000.00");
    expect(res.body.meals.perChild).toBe("40000.00");
  });

  it("excludes a rule that bills attendance rather than meals", async () => {
    // Tuition is not a meal cost, and folding it in would inflate the average.
    const tuition = await mealRule({
      name: "Сургалтын төлбөр",
      invoiceItemKind: "TUITION",
      dependsOnAttendance: true,
      dependsOnMeals: false,
    });

    await calculation({
      source: "PARENT",
      fundingRuleId: tuition.id,
      calculatedAmount: "180000.00",
    });

    const res = await dashboard(adminA);
    expect(res.body.meals.total).toBe("0.00");
    expect(res.body.meals.perChild).toBe("0.00");
  });

  it("splits the cost by source — §3's own requirement", async () => {
    const rule = await mealRule();
    const stateRule = await mealRule({ name: "Улсын хоол", source: "STATE" });
    const other = await createChild(a.kindergarten.id);
    await enrollChild(a.kindergarten.id, other.id, a.group.id, a.schoolYear.id);

    await calculation({
      source: "PARENT",
      fundingRuleId: rule.id,
      calculatedAmount: "50000.00",
    });
    await calculation({
      childId: other.id,
      source: "STATE",
      fundingRuleId: stateRule.id,
      calculatedAmount: "30000.00",
    });

    const res = await dashboard(adminA);
    const bySource = Object.fromEntries(
      (res.body.meals.bySource as { source: string; amount: string }[]).map((row) => [
        row.source,
        row.amount,
      ]),
    );

    expect(bySource.PARENT).toBe("50000");
    expect(bySource.STATE).toBe("30000");
  });

  it("reports zero rather than dividing by zero on an empty month", async () => {
    const res = await dashboard(adminA);

    expect(res.body.meals.total).toBe("0.00");
    expect(res.body.meals.perChild).toBe("0.00");
    expect(res.body.meals.children).toBe(0);
  });
});

/**
 * One child's finance tab — `нэмэлт.md` §10.
 *
 * ★★★ The discriminating test is `omits the state funding history from a
 * guardian's payload`. §10 lists seven things under "Санхүү", and they are not
 * all the same kind of fact: the invoices are the family's debt, the state
 * funding is the kindergarten's revenue. Sending the second and hiding it in
 * the UI would put it one devtools tab away from any parent who looked.
 */
describe("a child's finance summary — §10", () => {
  async function billed(over: Record<string, unknown> = {}) {
    return invoice({ totalAmount: "50000.00", discountAmount: "5000.00", ...over });
  }

  it("gives a guardian their own balance", async () => {
    const parentA = await login(app, a.parentUser.username);
    const one = await billed();
    await payment(one.id, "20000.00");

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/finance`),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body.billed).toBe("50000.00");
    expect(res.body.paid).toBe("20000.00");
    expect(res.body.balance).toBe("30000.00");
    expect(res.body.discounts).toBe("5000.00");
  });

  it("omits the state funding history from a guardian's payload", async () => {
    const parentA = await login(app, a.parentUser.username);
    await calculation({ approvedAmount: "20000.00" });
    await billed();

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/finance`),
      parentA,
    );

    expect(res.status).toBe(200);
    // Absent from the response, not merely hidden by a screen.
    expect(res.body.funding).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("20000.00");
  });

  it("includes the funding history for finance staff, with the inputs", async () => {
    const rule = await mealRule();
    await calculation({
      source: "PARENT",
      fundingRuleId: rule.id,
      daysAttended: 18,
      daysFed: 20,
      approvedAmount: "50000.00",
    });

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/finance`),
      accountantA,
    );

    expect(res.status).toBe(200);
    expect(res.body.funding).toHaveLength(1);
    // §10 asks for the attendance-based calculation, not just its result.
    expect(res.body.funding[0]).toMatchObject({
      month: MONTH,
      daysAttended: 18,
      daysFed: 20,
      basis: "MEALS",
      rule: "Хоолны мөнгө",
    });
  });

  it("reports the basis a rule billed on", async () => {
    const tuition = await mealRule({
      name: "Сургалтын төлбөр",
      dependsOnAttendance: true,
      dependsOnMeals: false,
    });
    await calculation({ source: "PARENT", fundingRuleId: tuition.id });

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/finance`),
      accountantA,
    );

    expect(res.body.funding[0].basis).toBe("ATTENDANCE");
  });

  it("refuses the child's own teacher — §13", async () => {
    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/finance`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a guardian of another child — 404, never 403", async () => {
    const parentB = await login(app, b.parentUser.username);

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/finance`),
      parentB,
    );
    expect(res.status).toBe(404);
  });

  it("keeps a running balance rather than resetting it each month", async () => {
    // A balance that reset would tell a family they owe nothing on the first.
    await billed({ month: new Date("2026-01-01T00:00:00.000Z"), totalAmount: "30000.00" });
    await billed({ totalAmount: "50000.00" });

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/finance`),
      accountantA,
    );

    expect(res.body.invoices).toBe(2);
    expect(res.body.balance).toBe("80000.00");
  });

  it("shows a credit as a negative balance rather than hiding it", async () => {
    const one = await billed({ totalAmount: "50000.00" });
    await payment(one.id, "60000.00");

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/finance`),
      accountantA,
    );

    expect(res.body.balance).toBe("-10000.00");
  });
});

/**
 * The financial reports — `нэмэлт.md` §16.
 *
 * ★ The definitions are tested exhaustively in
 * `src/invoices/finance-reports.test.ts`, without a database. What these add is
 * everything that only the real route can prove: the authorization, the audit
 * row §14 asks for, and that the spreadsheet is a spreadsheet a reader can
 * actually sum — which is the one property a "did it return bytes" check
 * cannot see.
 */
describe("financial reports — §16", () => {
  function report(session: AuthSession, key: string, period = MONTH) {
    return authed(
      request(app.getHttpServer()).get(
        `/v1/kindergartens/${a.kindergarten.id}/invoices/reports?report=${key}&period=${period}`,
      ),
      session,
    );
  }

  it("refuses a teacher — §13", async () => {
    expect((await report(teacherA, "state-funding")).status).toBe(404);
  });

  it("refuses an admin from another kindergarten", async () => {
    expect((await report(adminB, "state-funding")).status).toBe(404);
  });

  it("rejects a report name it does not have", async () => {
    expect((await report(adminA, "made-up-report")).status).toBe(400);
  });

  it("serves the state funding report with its totals", async () => {
    await calculation({ approvedAmount: "20000.00", receivedAmount: "15000.00" });

    const res = await report(accountantA, "state-funding");

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Сарын улсын санхүүжилтийн тайлан");
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.totals.received).toBe("15000.00");
  });

  it("serves the unpaid report across every month, not just the one asked for", async () => {
    // Arrears are not a property of the month being viewed.
    await invoice({
      month: new Date("2026-01-01T00:00:00.000Z"),
      dueDate: new Date("2026-01-10T00:00:00.000Z"),
      totalAmount: "30000.00",
    });

    const res = await report(accountantA, "unpaid");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.totals.outstanding).toBe("30000.00");
  });

  it("serves the annual summary over a school year, September to August", async () => {
    // September 2025 is inside 2025-2026; August 2025 is not.
    await calculation({
      month: new Date("2025-09-01T00:00:00.000Z"),
      calculatedAmount: "10000.00",
    });
    await calculation({
      month: new Date("2025-08-01T00:00:00.000Z"),
      calculatedAmount: "99999.00",
    });

    const res = await report(accountantA, "annual", "2025-2026");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].month).toBe("2025-09");
  });

  it("rejects a month where a school year is required", async () => {
    expect((await report(adminA, "annual", "2026-02")).status).toBe(400);
  });

  it("rejects a school year where a month is required", async () => {
    expect((await report(adminA, "state-funding", "2025-2026")).status).toBe(400);
  });

  it("ignores another kindergarten's rows", async () => {
    await calculation();
    await db.fundingCalculation.create({
      data: {
        kindergartenId: b.kindergarten.id,
        childId: b.child.id,
        source: "STATE",
        month: MONTH_START,
        daysAttended: 20,
        daysFed: 20,
        calculatedAmount: "99999.00",
      } as never,
    });

    const res = await report(accountantA, "state-funding");
    expect(res.body.rows).toHaveLength(1);
  });

  describe("the Excel export", () => {
    function exportReport(session: AuthSession, key: string, period = MONTH) {
      return authed(
        request(app.getHttpServer())
          .get(
            `/v1/kindergartens/${a.kindergarten.id}/invoices/reports/export?report=${key}&period=${period}`,
          )
          .buffer()
          .parse((res, callback) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => callback(null, Buffer.concat(chunks)));
          }),
        session,
      );
    }

    it("writes money as a number Excel can sum, not as text", async () => {
      /*
       * ★★★ The assertion this file exists for.
       *
       * `"20 000₮"` in a cell is a string: it will not sum, will not sort, and
       * turns the first thing an accountant does with a report — select the
       * column, read the total — into manual re-entry. A "did it return bytes"
       * check passes either way.
       */
      await calculation({ calculatedAmount: "20000.00" });

      const res = await exportReport(accountantA, "state-funding");
      expect(res.status).toBe(200);

      const ExcelJS = (await import("exceljs")).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(res.body as Buffer);

      const sheet = book.worksheets[0]!;
      expect(sheet.name).toContain("Сарын улсын санхүүжилт");

      // Find the cell holding the calculated amount and check its *type*.
      let found: ExcelJS.CellValue = null;
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value === 20000) found = cell.value;
        });
      });

      expect(found).toBe(20000);
    });

    it("records the download — §14's «Тайлан татсан»", async () => {
      await calculation();

      await exportReport(accountantA, "state-funding").expect(200);

      const entries = await db.auditLog.findMany({
        where: { action: "DOWNLOAD", objectType: "FinanceReport" },
      });

      // An export copies the kindergarten's financial position onto somebody's
      // laptop and leaves no other trace.
      expect(entries).toHaveLength(1);
      expect(entries[0]!.metadata).toMatchObject({ report: "state-funding", period: MONTH });
    });

    it("refuses a teacher, and writes no audit row for the attempt", async () => {
      expect((await exportReport(teacherA, "state-funding")).status).toBe(404);

      const entries = await db.auditLog.findMany({ where: { objectType: "FinanceReport" } });
      expect(entries).toHaveLength(0);
    });

    it("produces a readable file even when the month is empty", async () => {
      // "There is nothing to report" and "the export is broken" must not look
      // the same to the person filing it.
      const res = await exportReport(adminA, "variance");
      expect(res.status).toBe(200);

      const ExcelJS = (await import("exceljs")).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(res.body as Buffer);

      const sheet = book.worksheets[0]!;
      let sawSentence = false;
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === "string" && cell.value.includes("бичлэг алга")) {
            sawSentence = true;
          }
        });
      });

      expect(sawSentence).toBe(true);
    });
  });
});
