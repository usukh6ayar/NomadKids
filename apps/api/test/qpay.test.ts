import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, uniq } from "./support/db";
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
 * QPay — нэмэлт.md §8, the online-payment half of the invoicing module.
 *
 * ★ No sandbox account exists (`docs/reference/QPAY_INTEGRATION.md`), so
 * `QPAY_*` is unset here exactly as it is in a fresh `.env` — this suite
 * never reaches `QpayClient`'s own network call. What it proves is
 * everything that does not need a live gateway: the authorization matrix
 * (`assertCanViewFinance`, the same predicate the child-scoped invoice read
 * uses — see `invoices.test.ts`), the child/invoice ownership check, and that
 * an unconfigured deployment fails with an honest message rather than a raw
 * network error.
 *
 * The reconciliation logic itself — `QpayService.reconcile`'s claim-then-
 * attach idempotency, which is the property that matters most once real
 * money is involved — is unit-tested against fakes in
 * `src/integrations/qpay/qpay.service.test.ts`, where a canned QPay response
 * can actually be supplied. That is deliberately not this file's job.
 */

let app: INestApplication;

let a: Scenario;
let b: Scenario;
let accountant: AuthSession;
let teacher: AuthSession;
let parent: AuthSession;

const server = () => app.getHttpServer();

// ★ The gate is off everywhere else in the suite (`test/setup.ts` pins
// ACCESS_FEE_AMOUNT), so this file turns it on before the app is built —
// `AccessService` reads the price once, at construction.
process.env.ACCESS_FEE_AMOUNT = "15000.00";

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const accUser = await createUser({ username: uniq("acct") });
  await createMembership(accUser.id, a.kindergarten.id, "ACCOUNTANT");
  accountant = await login(app, accUser.username);

  teacher = await login(app, a.teacherUser.username);
  parent = await login(app, a.parentUser.username);
});

/**
 * ★ These routes charge the **portal access fee**, not a kindergarten invoice.
 *
 * Client instruction, 2026-09-01: QPay exists to take money from parents for
 * the right to use the site, and for nothing else. Tuition and meal bills are
 * still raised and still settled — in cash or by transfer, recorded by the
 * accountant — but they never reach this gateway, so no invoice is set up here.
 */
function startPayment(childId: string, actor: AuthSession) {
  return authed(request(server()).post(`/v1/children/${childId}/access/qpay`), actor);
}

describe("who may start a QPay payment", () => {
  it("passes authorization for the child's own guardian, then fails honestly because QPay is not configured here", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/access/qpay`),
      parent,
    );

    // Not 404 — authorization passed. A 400 with an honest, specific message
    // rather than a raw network error, because QPAY_* is unset here exactly
    // as it is in a fresh .env.
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("тохируулагдаагүй");
  });

  it("lets the accountant and admin start one too, same as the guardian", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/access/qpay`),
      accountant,
    );
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("тохируулагдаагүй");
  });

  it("refuses a teacher — a family's subscription is not staff business", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/access/qpay`),
      teacher,
    );
    expect(res.status).toBe(404);
  });

  it("refuses another family's guardian", async () => {
    const otherParent = await login(app, b.parentUser.username);
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/access/qpay`),
      otherParent,
    );
    expect(res.status).toBe(404);
  });

  /**
   * ★★ The route a paying family must always be able to reach.
   *
   * `assertCanAccess` throws **402** for a guardian whose fee is unpaid, which
   * is the whole point of the feature — but if that gate also covered the
   * unlock route, a parent would meet a 402 with no way to clear it. This
   * exercises the exemption for real rather than trusting the source comment:
   * the guardian reaches the handler, and the refusal that comes back is
   * QPay's own missing configuration, not the gate.
   */
  it("is reachable by a guardian who has not paid — the gate must not close its own exit", async () => {
    const res = await startPayment(a.child.id, parent);

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("тохируулагдаагүй");
  });
});

describe("checking status", () => {
  it("404s when nobody has started a QPay payment for this child yet", async () => {
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/access/qpay`),
      parent,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a teacher reading status, same as starting one", async () => {
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/access/qpay`),
      teacher,
    );
    expect(res.status).toBe(404);
  });
});

describe("the callback", () => {
  it("is reachable with no session at all, and never errors on an id it does not recognise", async () => {
    const res = await request(server())
      .post("/v1/qpay/callback")
      .send({ qpay_invoice_id: "does-not-exist" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("accepts the id from a query string too", async () => {
    const res = await request(server()).post("/v1/qpay/callback?qpay_invoice_id=also-unknown");
    expect(res.status).toBe(200);
  });
});
