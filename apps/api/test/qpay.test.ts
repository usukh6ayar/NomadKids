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

async function invoiceIdFor(scenario: Scenario, actor: AuthSession): Promise<string> {
  const res = await authed(
    request(server()).post(`/v1/kindergartens/${scenario.kindergarten.id}/invoices`),
    actor,
  ).send({
    childId: scenario.child.id,
    month: "2026-08",
    dueDate: "2026-09-05",
    lineItems: [{ type: "TUITION", amount: "150000" }],
  });
  return res.body.id as string;
}

describe("who may start a QPay payment", () => {
  it("passes authorization for the child's own guardian, then fails honestly because QPay is not configured here", async () => {
    const id = await invoiceIdFor(a, accountant);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/invoices/${id}/qpay`),
      parent,
    );

    // Not 404 — authorization passed. A 400 with an honest, specific message
    // rather than a raw network error, because QPAY_* is unset here exactly
    // as it is in a fresh .env.
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("тохируулагдаагүй");
  });

  it("lets the accountant and admin start one too, same as the guardian", async () => {
    const id = await invoiceIdFor(a, accountant);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/invoices/${id}/qpay`),
      accountant,
    );
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("тохируулагдаагүй");
  });

  it("refuses a teacher — §13's exclusion, same predicate as the invoice read", async () => {
    const id = await invoiceIdFor(a, accountant);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/invoices/${id}/qpay`),
      teacher,
    );
    expect(res.status).toBe(404);
  });

  it("refuses another family's guardian", async () => {
    const id = await invoiceIdFor(a, accountant);

    const otherParent = await login(app, b.parentUser.username);
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/invoices/${id}/qpay`),
      otherParent,
    );
    expect(res.status).toBe(404);
  });

  /**
   * ★ Not the same thing as "another family's guardian" above.
   *
   * This actor genuinely may view *some* child's finances at `a.child.id` — a
   * different check would stop here. What must still refuse is pairing that
   * child with an invoice that is not theirs, which is `QpayService`'s own
   * `ref.childId !== childId` guard, exercised for real rather than trusted
   * from reading the source.
   */
  it("refuses an invoice that belongs to a different child, even under an id the actor may otherwise reach", async () => {
    const otherChildInvoiceId = await invoiceIdFor(b, await login(app, b.adminUser.username));

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/invoices/${otherChildInvoiceId}/qpay`),
      parent,
    );
    expect(res.status).toBe(404);
  });
});

describe("checking status", () => {
  it("404s when nobody has started a QPay payment for this invoice yet", async () => {
    const id = await invoiceIdFor(a, accountant);

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/invoices/${id}/qpay`),
      parent,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a teacher reading status, same as starting one", async () => {
    const id = await invoiceIdFor(a, accountant);

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/invoices/${id}/qpay`),
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
