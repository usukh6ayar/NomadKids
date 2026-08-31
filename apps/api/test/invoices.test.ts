import type { INestApplication } from "@nestjs/common";
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

/**
 * Parent invoices and payments — `нэмэлт.md` §7, §8, §14.
 *
 * ★ The authorization block is the mandatory one (CLAUDE.md §4.1), with a
 * fourth case this module adds: **the teacher**. §13 says a teacher may not see
 * financial information, and a teacher assigned to the child's own group passes
 * `canAccessChild` — so nothing but an explicit test distinguishes "the code
 * refuses them" from "the code never asked".
 *
 * ★★ Every money assertion compares decimal **strings**. Asserting on a number
 * would coerce through a float and pass while the wire format silently changed
 * to something a bank reconciliation would reject.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let accountantA: AuthSession;
let adminB: AuthSession;
let accountantAUser: { id: string; username: string };

const MONTH = "2026-02";

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

  accountantAUser = await createUser({ username: `acct-a-${Date.now()}` });
  await createMembership(accountantAUser.id, a.kindergarten.id, "ACCOUNTANT");

  [adminA, teacherA, parentA, accountantA, adminB] = await Promise.all([
    login(app, a.adminUser.username),
    login(app, a.teacherUser.username),
    login(app, a.parentUser.username),
    login(app, accountantAUser.username),
    login(app, b.adminUser.username),
  ]);
});

/** A PARENT-source tariff that bills per fed day. */
async function createTariff(over: Record<string, unknown> = {}) {
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

async function feed(day: number, scenario: Scenario = a) {
  return db.mealRecord.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      childId: scenario.child.id,
      enrollmentId: scenario.enrollment.id,
      date: date(day),
      kind: "LUNCH" as never,
      status: "TAKEN" as never,
    },
  });
}

async function attend(day: number, scenario: Scenario = a) {
  return db.attendance.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      childId: scenario.child.id,
      enrollmentId: scenario.enrollment.id,
      date: date(day),
      status: "PRESENT" as never,
    },
  });
}

function generate(session: AuthSession, body: Record<string, unknown> = {}) {
  return authed(
    request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/invoices/generate`),
    session,
  ).send({ month: MONTH, ...body });
}

/** Generates one invoice and returns it. */
async function anInvoice(): Promise<{ id: string; number: string; totalAmount: string }> {
  await createTariff();
  await feed(3);
  await feed(4);

  const res = await generate(adminA);
  expect(res.status).toBe(201);
  return res.body.created[0];
}

describe("invoices — authorization", () => {
  it("refuses an admin from another kindergarten", async () => {
    const res = await authed(
      request(app.getHttpServer()).get(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      adminB,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a teacher of this kindergarten — нэмэлт.md §13", async () => {
    // The teacher is assigned to this child's group and passes canAccessChild.
    // Finance is the one surface that must still refuse them.
    const res = await authed(
      request(app.getHttpServer()).get(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a parent the kindergarten-wide list", async () => {
    const res = await authed(
      request(app.getHttpServer()).get(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      parentA,
    );
    expect(res.status).toBe(404);
  });

  it("admits the accountant — the role the module exists for", async () => {
    const res = await authed(
      request(app.getHttpServer()).get(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      accountantA,
    );
    expect(res.status).toBe(200);
  });

  it("lets a guardian read their own child's invoice", async () => {
    const invoice = await anInvoice();

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      parentA,
    );
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(invoice.number);
  });

  it("refuses a guardian of another child — 404, never 403", async () => {
    const invoice = await anInvoice();
    const parentB = await login(app, b.parentUser.username);

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      parentB,
    );
    expect(res.status).toBe(404);
  });

  it("refuses the child's own teacher a single invoice", async () => {
    const invoice = await anInvoice();

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a teacher the child's invoice list", async () => {
    const res = await authed(
      request(app.getHttpServer()).get(`/v1/children/${a.child.id}/invoices`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a guardian the write routes", async () => {
    const invoice = await anInvoice();

    const patched = await authed(
      request(app.getHttpServer()).patch(`/v1/invoices/${invoice.id}`),
      parentA,
    ).send({ note: "өөрчилье" });
    expect(patched.status).toBe(404);

    const paid = await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/payments`),
      parentA,
    ).send({ amount: "1000.00", method: "CASH" });
    expect(paid.status).toBe(404);
  });
});

describe("generating a month — §7", () => {
  it("bills fed days at the tariff's daily rate", async () => {
    await createTariff();
    await feed(3);
    await feed(4);
    await feed(5);

    const res = await generate(adminA);

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].totalAmount).toBe("7500.00");
    expect(res.body.created[0].month).toBe(MONTH);
  });

  it("bills attendance days when the tariff says so", async () => {
    await createTariff({
      name: "Сургалтын төлбөр",
      invoiceItemKind: "TUITION",
      dependsOnAttendance: true,
      dependsOnMeals: false,
      dailyRate: "1000.00",
    });
    await attend(3);
    await attend(4);
    // A meal on a day the child was not marked present must not be billed by an
    // attendance tariff.
    await feed(10);

    const res = await generate(adminA);
    expect(res.body.created[0].totalAmount).toBe("2000.00");
  });

  it("refuses when no parent tariff is configured", async () => {
    // The rule table ships empty by §4's instruction, so this is the first-run
    // state and must say something an administrator can act on.
    await feed(3);

    const res = await generate(adminA);
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("тариф");
  });

  it("skips a child who already has an invoice for the month", async () => {
    await createTariff();
    await feed(3);

    const first = await generate(adminA);
    expect(first.body.created).toHaveLength(1);

    const second = await generate(adminA);
    expect(second.body.created).toHaveLength(0);
    expect(second.body.skipped).toEqual([{ childId: a.child.id, reason: "already_invoiced" }]);
  });

  it("skips a child with nothing to bill rather than issuing a zero invoice", async () => {
    await createTariff();

    const res = await generate(adminA);
    expect(res.body.created).toHaveLength(0);
    expect(res.body.skipped[0].reason).toBe("nothing_to_bill");
  });

  it("counts a day the child ate twice as one fed day", async () => {
    // MealRecord is unique on (enrollment, date, kind) — three sittings is one
    // day. Billing per sitting would overcharge the family threefold.
    await createTariff();
    await feed(3);
    await db.mealRecord.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        enrollmentId: a.enrollment.id,
        date: date(3),
        kind: "BREAKFAST" as never,
        status: "TAKEN" as never,
      },
    });

    const res = await generate(adminA);
    expect(res.body.created[0].totalAmount).toBe("2500.00");
  });

  it("ignores another kindergarten's children", async () => {
    await createTariff();
    await feed(3);
    await feed(3, b);

    const res = await generate(adminA);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].childId).toBe(a.child.id);
  });

  it("carries an unpaid balance forward into the next month", async () => {
    await createTariff();
    await feed(3);
    await generate(adminA);

    // March: the February invoice is still unpaid.
    await db.mealRecord.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        enrollmentId: a.enrollment.id,
        date: new Date("2026-03-03T00:00:00.000Z"),
        kind: "LUNCH" as never,
        status: "TAKEN" as never,
      },
    });

    const march = await generate(adminA, { month: "2026-03" });
    expect(march.body.created[0].previousBalance).toBe("2500.00");
    expect(march.body.created[0].totalAmount).toBe("5000.00");
  });
});

describe("payments — §8", () => {
  it("moves an invoice to PARTIALLY_PAID then PAID", async () => {
    const invoice = await anInvoice();

    await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/payments`),
      accountantA,
    )
      .send({ amount: "2000.00", method: "CASH" })
      .expect(201);

    let read = await authed(request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`), adminA);
    expect(read.body.status).toBe("PARTIALLY_PAID");
    expect(read.body.paidAmount).toBe("2000.00");
    expect(read.body.balanceAmount).toBe("3000.00");

    await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/payments`),
      accountantA,
    )
      .send({ amount: "3000.00", method: "QPAY" })
      .expect(201);

    read = await authed(request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`), adminA);
    expect(read.body.status).toBe("PAID");
    expect(read.body.balanceAmount).toBe("0.00");
  });

  it("refuses a zero payment", async () => {
    const invoice = await anInvoice();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/payments`),
      adminA,
    ).send({ amount: "0", method: "CASH" });

    expect(res.status).toBe(400);
  });
});

describe("reversal — §14", () => {
  async function paidInvoice() {
    const invoice = await anInvoice();
    const payment = await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/payments`),
      adminA,
    ).send({ amount: "5000.00", method: "QPAY" });

    return { invoice, paymentId: payment.body.id as string };
  }

  it("writes a reversing row rather than deleting the payment", async () => {
    const { invoice, paymentId } = await paidInvoice();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/payments/${paymentId}/reverse`),
      adminA,
    ).send({ reason: "Алдаатай бүртгэсэн" });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe("-5000.00");
    expect(res.body.isReversal).toBe(true);

    // §14: the original survives. Both rows are on the invoice.
    const read = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      adminA,
    );
    expect(read.body.payments).toHaveLength(2);
    expect(read.body.paidAmount).toBe("0.00");
    expect(read.body.status).toBe("UNPAID");

    const rows = await db.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(rows).toHaveLength(2);
  });

  it("requires a reason", async () => {
    const { paymentId } = await paidInvoice();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/payments/${paymentId}/reverse`),
      adminA,
    ).send({ reason: "" });

    expect(res.status).toBe(400);
  });

  it("refuses to reverse the same payment twice", async () => {
    const { paymentId } = await paidInvoice();

    await authed(request(app.getHttpServer()).post(`/v1/payments/${paymentId}/reverse`), adminA)
      .send({ reason: "нэг дэх" })
      .expect(201);

    const second = await authed(
      request(app.getHttpServer()).post(`/v1/payments/${paymentId}/reverse`),
      adminA,
    ).send({ reason: "хоёр дахь" });

    expect(second.status).toBe(409);
  });

  it("refuses to reverse a reversal", async () => {
    const { paymentId } = await paidInvoice();

    const reversal = await authed(
      request(app.getHttpServer()).post(`/v1/payments/${paymentId}/reverse`),
      adminA,
    ).send({ reason: "залруулга" });

    const again = await authed(
      request(app.getHttpServer()).post(`/v1/payments/${reversal.body.id}/reverse`),
      adminA,
    ).send({ reason: "дахин" });

    expect(again.status).toBe(409);
  });

  it("refuses an accountant from another kindergarten", async () => {
    const { paymentId } = await paidInvoice();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/payments/${paymentId}/reverse`),
      adminB,
    ).send({ reason: "өөр цэцэрлэг" });

    expect(res.status).toBe(404);
  });

  it("records who reversed it, with the reason, in the audit log", async () => {
    const { paymentId } = await paidInvoice();

    await authed(request(app.getHttpServer()).post(`/v1/payments/${paymentId}/reverse`), adminA)
      .send({ reason: "Банкны алдаа" })
      .expect(201);

    const entries = await db.auditLog.findMany({
      where: { objectType: "Payment", action: "UPDATE" },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorUserId).toBe(a.adminUser.id);
    expect(entries[0]!.metadata).toMatchObject({ reason: "Банкны алдаа", reversalOf: paymentId });
  });
});

describe("voiding an invoice", () => {
  it("soft-deletes an unpaid one and hides it from the list", async () => {
    const invoice = await anInvoice();

    await authed(request(app.getHttpServer()).delete(`/v1/invoices/${invoice.id}`), adminA).expect(
      200,
    );

    const list = await authed(
      request(app.getHttpServer()).get(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      adminA,
    );
    expect(list.body.items).toHaveLength(0);

    // Soft, not hard — CLAUDE.md §3.2.
    const row = await db.invoice.findUnique({ where: { id: invoice.id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("refuses to void an invoice money has been received against", async () => {
    const invoice = await anInvoice();
    await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/payments`),
      adminA,
    ).send({ amount: "1000.00", method: "CASH" });

    const res = await authed(
      request(app.getHttpServer()).delete(`/v1/invoices/${invoice.id}`),
      adminA,
    );
    expect(res.status).toBe(409);
  });

  it("does not reuse the number of a voided invoice", async () => {
    const first = await anInvoice();
    await authed(request(app.getHttpServer()).delete(`/v1/invoices/${first.id}`), adminA).expect(
      200,
    );

    const second = await authed(
      request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      adminA,
    ).send({
      childId: a.child.id,
      month: MONTH,
      lines: [{ kind: "OTHER", label: "Гараар", quantity: "1", unitAmount: "1000.00" }],
    });

    expect(second.status).toBe(201);
    expect(second.body.number).not.toBe(first.number);
  });
});

describe("a hand-written invoice", () => {
  it("totals the lines and applies the discount", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      accountantA,
    ).send({
      childId: a.child.id,
      month: MONTH,
      discountAmount: "5000.00",
      lines: [
        { kind: "TUITION", label: "Сургалтын төлбөр", quantity: "1", unitAmount: "180000.00" },
        { kind: "BUS", label: "Автобус", quantity: "20", unitAmount: "1000.00" },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.subtotalAmount).toBe("200000.00");
    expect(res.body.totalAmount).toBe("195000.00");
  });

  it("refuses a second live invoice for the same child and month", async () => {
    await anInvoice();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      adminA,
    ).send({
      childId: a.child.id,
      month: MONTH,
      lines: [{ kind: "OTHER", label: "Давхардсан", quantity: "1", unitAmount: "1000.00" }],
    });

    expect(res.status).toBe(409);
  });

  it("refuses a child in another kindergarten", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      adminA,
    ).send({
      childId: b.child.id,
      month: MONTH,
      lines: [{ kind: "OTHER", label: "Хөндлөнгийн", quantity: "1", unitAmount: "1000.00" }],
    });

    expect(res.status).toBe(404);
  });
});
