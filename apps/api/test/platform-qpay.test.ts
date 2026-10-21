import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * «Төлбөр шалгах» — the operator answering "I paid, check it" (2026-10-21).
 *
 * `QpayClient` alone is stubbed; the routes, `assertSuperAdmin`, reconcile
 * and the settlement are the real ones. The discriminating case: a family
 * whose QR expired, who paid anyway and whose callback never came, is let in
 * by the operator's re-check.
 */

// The fee gate on, and QPay configured — the client below is the stand-in.
process.env.ACCESS_FEE_AMOUNT = "22000.00";
process.env.QPAY_BASE_URL = "https://qpay.test";
process.env.QPAY_USERNAME = "test";
process.env.QPAY_PASSWORD = "test";
process.env.QPAY_INVOICE_CODE = "TEST_INVOICE";
process.env.QPAY_CALLBACK_URL = "https://nomadkids.test/v1/qpay/callback";

const checkPayment = vi.fn();

let app: INestApplication;
const db = testDb();

let a: Scenario;
let operator: AuthSession;
let operatorId: string;
let parent: AuthSession;
let admin: AuthSession;
let teacher: AuthSession;

const PHONE = "99112233";

const server = () => app.getHttpServer();
const list = (actor: AuthSession, query = "") =>
  authed(request(server()).get(`/v1/platform/qpay/invoices${query}`), actor);
const recheck = (actor: AuthSession, id: string) =>
  authed(request(server()).post(`/v1/platform/qpay/invoices/${id}/recheck`), actor);

beforeAll(async () => {
  app = await createTestApp({ qpayClient: { checkPayment } });
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  checkPayment.mockReset();

  a = await createScenario("a");
  await db.user.update({ where: { id: a.parentUser.id }, data: { phone: PHONE } });
  const op = await createUser({ username: uniq("operator"), isSuperAdmin: true });

  operatorId = op.id;
  operator = await login(app, op.username);
  parent = await login(app, a.parentUser.username);
  admin = await login(app, a.adminUser.username);
  teacher = await login(app, a.teacherUser.username);
});

/** The family's unpaid year and a QR for it that ran out 10 minutes ago. */
async function expiredAttempt() {
  const year = await db.schoolYear.findFirstOrThrow({
    where: { kindergartenId: a.kindergarten.id, isCurrent: true, deletedAt: null },
  });
  const subscription = await db.accessSubscription.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId: a.child.id,
      schoolYearId: year.id,
      amount: "22000.00",
      status: "UNPAID",
      expiresAt: new Date("2099-05-31"),
    } as never,
  });
  const invoice = await db.qpayInvoice.create({
    data: {
      kindergartenId: a.kindergarten.id,
      subscriptionId: subscription.id,
      amount: "22000.00",
      qpayInvoiceId: `qpay-${randomUUID()}`,
      senderInvoiceNo: randomUUID(),
      status: "EXPIRED",
      createdById: a.parentUser.id,
      expiresAt: new Date(Date.now() - 10 * 60_000),
    },
  });
  return { subscription, invoice };
}

const paid = (amount: string) => ({
  count: 1,
  rows: [{ payment_id: "p-1", payment_status: "PAID", payment_amount: amount }],
});

describe("who may look", () => {
  it("answers 404 to a kindergarten's admin, a teacher and a parent", async () => {
    const { invoice } = await expiredAttempt();

    for (const actor of [admin, teacher, parent]) {
      expect((await list(actor)).status).toBe(404);
      expect((await recheck(actor, invoice.id)).status).toBe(404);
    }
    expect(checkPayment).not.toHaveBeenCalled();
  });
});

describe("the list", () => {
  it("finds a payment by the receipt's «Дугаар» and by the payer's phone", async () => {
    const { subscription, invoice } = await expiredAttempt();
    const number = subscription.id.slice(0, 8).toUpperCase();

    const byNumber = await list(operator, `?q=${number}`);
    expect(byNumber.status).toBe(200);
    expect(byNumber.body.items.map((row: { id: string }) => row.id)).toEqual([invoice.id]);
    expect(byNumber.body.items[0]).toMatchObject({
      number,
      kind: "ACCESS_FEE",
      status: "EXPIRED",
      needsReview: false,
      amount: "22000.00",
      kindergarten: { id: a.kindergarten.id },
      validUntil: null,
    });

    const byPhone = await list(operator, `?q=${PHONE.slice(-4)}`);
    expect(byPhone.body.items.map((row: { id: string }) => row.id)).toEqual([invoice.id]);

    expect((await list(operator, "?q=ffffffff")).body.items).toEqual([]);
    expect((await list(operator, "?q=хүүхэд")).body.items).toEqual([]);
  });

  it("never carries the child or the whole phone number", async () => {
    await expiredAttempt();

    const res = await list(operator);
    const body = JSON.stringify(res.body);

    expect(res.body.items[0].payerPhone).toBe("99••••33");
    expect(body).not.toContain(PHONE);
    expect(body).not.toContain(a.child.id);
    expect(body).not.toContain(a.child.firstName);
  });
});

describe("the re-check", () => {
  it("settles an expired QR QPay says was paid, and the family is let in", async () => {
    const { invoice } = await expiredAttempt();
    expect((await authed(request(server()).get(`/v1/children/${a.child.id}`), parent)).status).toBe(
      402,
    );
    checkPayment.mockResolvedValue(paid("22000.00"));

    const res = await recheck(operator, invoice.id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PAID");
    expect(res.body.validUntil).toBe("2099-05-31");
    expect((await authed(request(server()).get(`/v1/children/${a.child.id}`), parent)).status).toBe(
      200,
    );
    const asked = await db.auditLog.findFirst({
      where: { objectType: "QpayInvoice", objectId: invoice.id, actorUserId: operatorId },
    });
    expect(asked?.metadata).toMatchObject({ recheck: true, after: { status: "PAID" } });
  });

  it("leaves a short payment for a person — «Шалгах шаардлагатай»", async () => {
    const { invoice } = await expiredAttempt();
    checkPayment.mockResolvedValue(paid("100"));

    const res = await recheck(operator, invoice.id);

    expect(res.body).toMatchObject({ status: "EXPIRED", needsReview: true });
    const review = await list(operator, "?status=NEEDS_REVIEW");
    expect(review.body.items.map((row: { id: string }) => row.id)).toEqual([invoice.id]);
  });

  it("answers 404 for an attempt that does not exist", async () => {
    expect((await recheck(operator, randomUUID())).status).toBe(404);
  });
});
