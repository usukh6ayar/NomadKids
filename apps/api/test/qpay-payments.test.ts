import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { QpayPayment } from "../src/integrations/qpay/qpay.service";

/**
 * Online payment — `нэмэлт.md` §8.
 *
 * ★★★ **The file exists for one property: a forged callback cannot create
 * money.**
 *
 * `POST /v1/payments/qpay/callback` is `@Public()` — QPay's servers dial it and
 * hold no session — so anybody on the internet can post to it. If the body were
 * believed, every invoice in the system could be settled for free. The tests
 * below attack it the way an attacker would: a made-up payment id, a real id
 * QPay says is unpaid, an inflated amount, the same confirmation twice.
 *
 * ★ The QPay *client* is stubbed; nothing else is. The route, the guards, the
 * service and the database are all real, because a test that mocked the
 * authorization would prove only that the mock works (CLAUDE.md §4.1).
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;

const MONTH = "2026-02";

/** What the fake QPay will say when asked to verify. */
const qpayState = {
  invoiceCounter: 0,
  payments: new Map<string, QpayPayment>(),
};

const qpayStub = {
  isConfigured: true,
  status: () => ({
    configured: true,
    baseUrl: "https://merchant.qpay.test/v2",
    invoiceCode: "NOMADKIDS_INVOICE",
    hasPassword: true,
  }),
  createInvoice: vi.fn(async () => {
    qpayState.invoiceCounter += 1;
    const providerInvoiceId = `qpay-inv-${qpayState.invoiceCounter}`;
    return {
      providerInvoiceId,
      qrText: "0002010102...",
      qrImage: "iVBORw0KGgo=",
      links: [{ name: "khanbank", description: "Хаан банк", link: "khanbank://q" }],
    };
  }),
  /** The verification step — the security boundary itself. */
  checkPayment: vi.fn(async (id: string) => qpayState.payments.get(id) ?? null),
  paymentsForInvoice: vi.fn(async (providerInvoiceId: string) =>
    [...qpayState.payments.values()].filter((p) => p.providerInvoiceId === providerInvoiceId),
  ),
};

/** Registers a payment the fake QPay will confirm. */
function qpayWillConfirm(payment: Partial<QpayPayment> & { providerPaymentId: string }) {
  qpayState.payments.set(payment.providerPaymentId, {
    providerInvoiceId: "qpay-inv-1",
    isPaid: true,
    amount: "5000.00",
    wallet: "khanbank",
    paidAt: new Date("2026-02-20T10:00:00.000Z"),
    ...payment,
  });
}

beforeAll(async () => {
  app = await createTestApp({ qpay: qpayStub as never });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  qpayState.invoiceCounter = 0;
  qpayState.payments.clear();
  vi.clearAllMocks();

  a = await createScenario("a");
  b = await createScenario("b");

  const accountant = await createUser({ username: `acct-${Date.now()}` });
  await createMembership(accountant.id, a.kindergarten.id, "ACCOUNTANT");

  [adminA, teacherA, parentA] = await Promise.all([
    login(app, a.adminUser.username),
    login(app, a.teacherUser.username),
    login(app, a.parentUser.username),
  ]);
});

async function anInvoice() {
  await db.fundingRule.create({
    data: {
      kindergartenId: a.kindergarten.id,
      name: "Хоолны мөнгө",
      source: "PARENT",
      invoiceItemKind: "MEAL",
      effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
      dailyRate: "2500.00",
      dependsOnAttendance: false,
      dependsOnMeals: true,
    } as never,
  });

  for (const day of [3, 4]) {
    await db.mealRecord.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        enrollmentId: a.enrollment.id,
        date: new Date(`2026-02-0${day}T00:00:00.000Z`),
        kind: "LUNCH" as never,
        status: "TAKEN" as never,
      },
    });
  }

  const res = await authed(
    request(app.getHttpServer()).post(`/v1/kindergartens/${a.kindergarten.id}/invoices/generate`),
    adminA,
  ).send({ month: MONTH });

  expect(res.status).toBe(201);
  return res.body.created[0] as { id: string; number: string; totalAmount: string };
}

/** Starts a QPay payment and returns the pending row's ids. */
async function startPayment(session: AuthSession = parentA) {
  const invoice = await anInvoice();
  const res = await authed(
    request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/qpay`),
    session,
  );
  expect(res.status).toBe(201);
  return { invoice, qr: res.body as { paymentId: string; amount: string; qrText: string } };
}

function callback(body: Record<string, unknown>, query = "") {
  return request(app.getHttpServer()).post(`/v1/payments/qpay/callback${query}`).send(body);
}

describe("the callback cannot be trusted — the core security property", () => {
  it("credits nothing for a payment id QPay has never heard of", async () => {
    const { invoice } = await startPayment();

    // The attack: post a plausible confirmation for an id that does not exist.
    const res = await callback({ qpay_payment_id: "totally-made-up" });

    // Always 200 — QPay retries anything else, and an error would reveal
    // whether the id was real.
    expect(res.status).toBe(200);

    const read = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      adminA,
    );
    expect(read.body.paidAmount).toBe("0.00");
    expect(read.body.status).toBe("UNPAID");
  });

  it("credits nothing when QPay says the payment was not paid", async () => {
    const { invoice } = await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-1", isPaid: false });

    await callback({ qpay_payment_id: "pay-1" }).expect(200);

    const read = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      adminA,
    );
    expect(read.body.paidAmount).toBe("0.00");
  });

  it("ignores an amount supplied in the callback and uses QPay's", async () => {
    // The attack: claim a large payment for a real id worth less.
    const { invoice } = await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-2", amount: "1000.00" });

    await callback({
      qpay_payment_id: "pay-2",
      payment_amount: "999999.00",
      payment_status: "PAID",
    }).expect(200);

    const read = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      adminA,
    );
    // QPay said 1000, so 1000 — and the invoice stays part-paid rather than
    // being settled by an attacker's arithmetic.
    expect(read.body.paidAmount).toBe("1000.00");
    expect(read.body.status).toBe("PARTIALLY_PAID");
  });

  it("verifies with QPay on every callback, never short-circuiting on the body", async () => {
    await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-3" });

    await callback({ qpay_payment_id: "pay-3", payment_status: "PAID" }).expect(200);

    expect(qpayStub.checkPayment).toHaveBeenCalledWith("pay-3");
  });

  it("requires a payment id — an empty body changes nothing", async () => {
    await startPayment();

    const res = await callback({});
    // Rejected by validation before any lookup.
    expect(res.status).toBe(400);
    expect(qpayStub.checkPayment).not.toHaveBeenCalled();
  });
});

describe("idempotency — a retried confirmation settles once", () => {
  it("credits one payment for two identical callbacks", async () => {
    const { invoice } = await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-dup", amount: "5000.00" });

    await callback({ qpay_payment_id: "pay-dup" }).expect(200);
    await callback({ qpay_payment_id: "pay-dup" }).expect(200);
    await callback({ qpay_payment_id: "pay-dup" }).expect(200);

    const read = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      adminA,
    );
    expect(read.body.paidAmount).toBe("5000.00");
    expect(read.body.status).toBe("PAID");

    const paidRows = await db.payment.findMany({
      where: { invoiceId: invoice.id, status: "PAID" },
    });
    expect(paidRows).toHaveLength(1);
  });

  it("stores the idempotency key namespaced to the provider", async () => {
    await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-key" });

    await callback({ qpay_payment_id: "pay-key" }).expect(200);

    const row = await db.payment.findFirst({ where: { providerPaymentId: "pay-key" } });
    expect(row?.idempotencyKey).toBe("qpay:pay-key");
  });
});

describe("a confirmed payment settles the invoice", () => {
  it("moves a PENDING row to PAID and records what QPay reported", async () => {
    const { invoice, qr } = await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-ok", amount: "5000.00" });

    await callback({ qpay_payment_id: "pay-ok" }).expect(200);

    const row = await db.payment.findUnique({ where: { id: qr.paymentId } });
    expect(row?.status).toBe("PAID");
    expect(row?.providerPaymentId).toBe("pay-ok");
    expect(row?.rawPayload).toMatchObject({ wallet: "khanbank" });

    const read = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      adminA,
    );
    expect(read.body.status).toBe("PAID");
  });

  it("attributes the confirmation to QPay, not to a user, in the audit log", async () => {
    await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-audit" });

    await callback({ qpay_payment_id: "pay-audit" }).expect(200);

    const entry = await db.auditLog.findFirst({
      where: { objectType: "Payment", action: "UPDATE" },
    });
    // A user id here would attribute the money to whoever happened to be nearby.
    expect(entry?.actorUserId).toBeNull();
    expect(entry?.actorLabel).toBe("QPay");
  });

  it("accepts the callback as a GET, which QPay sometimes uses", async () => {
    const { invoice } = await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-get" });

    await request(app.getHttpServer())
      .get("/v1/payments/qpay/callback?qpay_payment_id=pay-get")
      .expect(200);

    const read = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      adminA,
    );
    expect(read.body.status).toBe("PAID");
  });
});

describe("starting a payment — authorization", () => {
  it("lets a guardian generate a QR for their own child", async () => {
    const { qr } = await startPayment(parentA);
    expect(qr.qrText).toBeTruthy();
    // Only what is still owed.
    expect(qr.amount).toBe("5000.00");
  });

  it("refuses the child's own teacher — нэмэлт.md §13", async () => {
    const invoice = await anInvoice();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/qpay`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a guardian of another child — 404, never 403", async () => {
    const invoice = await anInvoice();
    const parentB = await login(app, b.parentUser.username);

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/qpay`),
      parentB,
    );
    expect(res.status).toBe(404);
  });

  it("refuses to bill an invoice that is already settled", async () => {
    const { invoice } = await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-settled", amount: "5000.00" });
    await callback({ qpay_payment_id: "pay-settled" }).expect(200);

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/qpay`),
      parentA,
    );
    expect(res.status).toBe(400);
  });

  it("quotes only the outstanding balance on a part-paid invoice", async () => {
    const invoice = await anInvoice();
    await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/payments`),
      adminA,
    ).send({ amount: "2000.00", method: "CASH" });

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/qpay`),
      parentA,
    );
    expect(res.body.amount).toBe("3000.00");
  });
});

describe("sync — the lost-callback remedy", () => {
  it("applies a payment QPay confirms even though no callback arrived", async () => {
    const { invoice } = await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-lost", providerInvoiceId: "qpay-inv-1" });

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/qpay/sync`),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PAID");
    expect(res.body.paidAmount).toBe("5000.00");
  });

  it("does not double-credit when the callback then arrives late", async () => {
    const { invoice } = await startPayment();
    qpayWillConfirm({ providerPaymentId: "pay-both", providerInvoiceId: "qpay-inv-1" });

    await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/qpay/sync`),
      parentA,
    ).expect(200);
    await callback({ qpay_payment_id: "pay-both" }).expect(200);

    const read = await authed(
      request(app.getHttpServer()).get(`/v1/invoices/${invoice.id}`),
      adminA,
    );
    expect(read.body.paidAmount).toBe("5000.00");
  });

  it("refuses a teacher", async () => {
    const invoice = await anInvoice();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/invoices/${invoice.id}/qpay/sync`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });
});
