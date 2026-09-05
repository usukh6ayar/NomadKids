import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
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
 * Onboarding — `docs/CONTRACT_ONBOARDING.md` steps 1–4.
 *
 * ★★★ **This file exists mostly for one endpoint.** `POST /v1/applications` is
 * the product's only unauthenticated write, and three of its properties are
 * load-bearing rather than nice to have:
 *
 *   1. it creates a `KindergartenApplication` and **never** a `Kindergarten`;
 *   2. its response is the same whether or not the registration number is
 *      already on file, so it cannot be used to ask who works with us;
 *   3. the review queue behind it is 404 to everybody but a superadmin.
 *
 * The rest of the file covers the money: a contract's figures are frozen at
 * approval, and the numbering does not repeat.
 */

let app: INestApplication;
const db = testDb();

let scenario: Scenario;
let operator: AuthSession;
let adminA: AuthSession;

const server = () => app.getHttpServer();

/**
 * ★ Derived, not hard-coded. `nextContractNumber` takes the current year, so a
 * literal `NK-2026-…` here is a test that starts failing on 1 January for a
 * reason that has nothing to do with the code.
 */
const YEAR = new Date().getUTCFullYear();
const NUM = (n: number) => `NK-${YEAR}-${String(n).padStart(6, "0")}`;

const FORM = {
  kindergartenName: "Аз жаргал цэцэрлэг",
  registrationNumber: "9012345",
  address: "Улаанбаатар, Сүхбаатар дүүрэг, 1-р хороо",
  directorName: "Дорж Сараа",
  phone: "99112233",
  email: "azjargal@example.mn",
  childCount: 120,
};

const TERMS = {
  adminUsername: "azjargal-admin",
  annualFee: "300000",
  perChildMonthlyFee: "1500",
  startsOn: "2026-09-01",
  endsOn: "2027-05-31",
};

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData(db);
  /*
   * ★ Both limiters. The public form is five an hour by IP — every test in
   * this file posts it, and supertest reuses one address — and the login
   * endpoint counts by identifier. Without this the file passes alone and
   * fails in a full run, which CLAUDE.md §4.4 records happening before.
   */
  await app.get(RateLimitService).resetAll();

  scenario = await createScenario("onboarding");
  const superUser = await createUser({ username: "platform-onboarding", isSuperAdmin: true });
  operator = await login(app, superUser.username);
  adminA = await login(app, scenario.adminUser.username);
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 2 — the public form
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /applications", () => {
  it("accepts a form with no session at all", async () => {
    const res = await request(server()).post("/v1/applications").send(FORM);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.id).toBeTruthy();
  });

  /**
   * ★★★ The assertion this endpoint exists to be safe for.
   *
   * `Kindergarten.id` is the key every tenant boundary in the system is built
   * on. An anonymous request that could create one would be able to conjure a
   * tenant out of nothing — so the public form writes to its own table and a
   * person decides afterwards.
   */
  it("creates an application and no kindergarten", async () => {
    const before = await db.kindergarten.count();

    await request(server()).post("/v1/applications").send(FORM).expect(201);

    expect(await db.kindergarten.count()).toBe(before);
    expect(await db.kindergartenApplication.count()).toBe(1);
  });

  /**
   * ★★ A duplicate must not be distinguishable.
   *
   * The obvious 409 turns the form into an oracle: type registration numbers,
   * learn which kindergartens have a relationship with this platform. So the
   * second submission is a recorded no-op with the *same* response shape.
   */
  it("answers a repeat registration number exactly as it answers a first", async () => {
    const first = await request(server()).post("/v1/applications").send(FORM).expect(201);
    const second = await request(server())
      .post("/v1/applications")
      .send({ ...FORM, kindergartenName: "Өөр нэр", directorName: "Өөр хүн" })
      .expect(201);

    expect(Object.keys(second.body).sort()).toEqual(Object.keys(first.body).sort());
    expect(second.body.status).toBe("PENDING");
    // One row, not two — the repeat was not stored.
    expect(await db.kindergartenApplication.count()).toBe(1);
  });

  it("refuses a malformed registration number, phone or email", async () => {
    for (const patch of [
      { registrationNumber: "12" },
      { phone: "9911" },
      { email: "not-an-email" },
      { childCount: 0 },
    ]) {
      const res = await request(server())
        .post("/v1/applications")
        .send({ ...FORM, ...patch });
      expect(res.status, JSON.stringify(patch)).toBe(400);
    }
  });

  /**
   * ★ Rate limited, because a form anyone can post is a form a script can post
   * ten thousand times. Five an hour from one address.
   */
  it("stops after five in an hour from one address", async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(server())
        .post("/v1/applications")
        .send({ ...FORM, registrationNumber: `901234${i}` })
        .expect(201);
    }

    const res = await request(server())
      .post("/v1/applications")
      .send({ ...FORM, registrationNumber: "9999999" });

    expect(res.status).toBe(429);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 3 — who may review
// ═══════════════════════════════════════════════════════════════════════════

describe("the review queue", () => {
  async function apply() {
    const res = await request(server()).post("/v1/applications").send(FORM).expect(201);
    return res.body.id as string;
  }

  it("is 404 for a kindergarten admin, not 403", async () => {
    const id = await apply();

    for (const path of ["/v1/platform/applications", `/v1/platform/applications/${id}`]) {
      const res = await authed(request(server()).get(path), adminA);
      expect(res.status, path).toBe(404);
    }
  });

  it("is 401 with no session", async () => {
    const res = await request(server()).get("/v1/platform/applications");
    expect(res.status).toBe(401);
  });

  it("lists pending applications for the operator", async () => {
    await apply();

    const res = await authed(
      request(server()).get("/v1/platform/applications?status=PENDING"),
      operator,
    );

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].kindergartenName).toBe(FORM.kindergartenName);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Steps 3–4 — approval, the contract, the PDF job
// ═══════════════════════════════════════════════════════════════════════════

describe("approval", () => {
  /**
   * ★ The email varies with the registration number, and it has to.
   *
   * Approving creates the kindergarten's first administrator from the
   * application's own email, and `User.email` is globally unique — so three
   * different kindergartens sharing one contact address is a 409, correctly.
   * Three real kindergartens do not share an inbox.
   */
  async function apply(registrationNumber = FORM.registrationNumber) {
    const res = await request(server())
      .post("/v1/applications")
      .send({
        ...FORM,
        registrationNumber,
        email: `kg-${registrationNumber}@example.mn`,
      })
      .expect(201);
    return res.body.id as string;
  }

  it("creates the kindergarten and the contract together", async () => {
    const id = await apply();

    const res = await authed(
      request(server()).post(`/v1/platform/applications/${id}/approve`),
      operator,
    ).send(TERMS);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.kindergartenId).toBeTruthy();
    expect(res.body.contract.number).toBe(NUM(1));

    const kindergarten = await db.kindergarten.findUnique({
      where: { id: res.body.kindergartenId },
    });
    expect(kindergarten?.name).toBe(FORM.kindergartenName);
  });

  /**
   * ★★★ The figures are frozen onto the row.
   *
   * A contract is a document two parties sign. If its amounts were resolved
   * from a live settings table, changing a price would silently rewrite the
   * content of every contract already printed and sealed — and the paper is
   * the one that binds. Same rule as `FundingRule`'s uneditable rate.
   */
  it("freezes the terms onto the contract row", async () => {
    const id = await apply();

    await authed(request(server()).post(`/v1/platform/applications/${id}/approve`), operator)
      .send(TERMS)
      .expect(200);

    const contract = await db.contract.findFirst({ where: { applicationId: id } });
    expect(contract?.annualFee.toString()).toBe("300000");
    expect(contract?.perChildMonthlyFee.toString()).toBe("1500");
    expect(contract?.childCount).toBe(FORM.childCount);
    expect(contract?.status).toBe("PENDING_SIGNATURE");
  });

  /**
   * ★★ A `CONTRACT` job carries **no `childId`**, exactly as `FINANCE_REPORT`
   * does not. That absence is what keeps every `canAccessChild`-gated download
   * path from ever serving one.
   */
  it("queues a CONTRACT report job with no child on it", async () => {
    const id = await apply();

    await authed(request(server()).post(`/v1/platform/applications/${id}/approve`), operator)
      .send(TERMS)
      .expect(200);

    const job = await db.reportJob.findFirst({ where: { type: "CONTRACT" } });
    expect(job).not.toBeNull();
    expect(job?.childId).toBeNull();
    const contract = await db.contract.findFirst({ where: { applicationId: id } });
    expect((job?.params as { contractId?: string }).contractId).toBe(contract?.id);
  });

  it("refuses to approve the same application twice", async () => {
    const id = await apply();

    await authed(request(server()).post(`/v1/platform/applications/${id}/approve`), operator)
      .send(TERMS)
      .expect(200);

    const again = await authed(
      request(server()).post(`/v1/platform/applications/${id}/approve`),
      operator,
    ).send(TERMS);

    expect(again.status).toBe(400);
    expect(await db.kindergarten.count({ where: { name: FORM.kindergartenName } })).toBe(1);
  });

  /**
   * ★ Numbers are padded so they sort in the order they were issued. Without
   * the padding `NK-2026-9` sorts after `NK-2026-10` and the tenth contract
   * reuses the ninth's number.
   */
  it("issues contract numbers in sequence", async () => {
    for (const [index, registration] of ["9012341", "9012342", "9012343"].entries()) {
      const id = await apply(registration);
      await authed(request(server()).post(`/v1/platform/applications/${id}/approve`), operator)
        // ★ A distinct login name per kindergarten. `User.username` is globally
        // unique, so reusing one would fail the second approval — which is
        // correct behaviour and not what this test is about.
        .send({ ...TERMS, adminUsername: `azjargal-admin-${index}` })
        .expect(200);
    }

    const numbers = (
      await db.contract.findMany({ orderBy: { createdAt: "asc" }, select: { number: true } })
    ).map((c) => c.number);

    expect(numbers).toEqual([NUM(1), NUM(2), NUM(3)]);
  });

  it("rejects with a reason, and creates nothing", async () => {
    const id = await apply();
    const before = await db.kindergarten.count();

    const res = await authed(
      request(server()).post(`/v1/platform/applications/${id}/reject`),
      operator,
    ).send({ reviewNote: "Регистрийн дугаар таарахгүй байна" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REJECTED");
    expect(await db.kindergarten.count()).toBe(before);
    expect(await db.contract.count()).toBe(0);
  });

  it("refuses a rejection with no reason", async () => {
    const id = await apply();

    const res = await authed(
      request(server()).post(`/v1/platform/applications/${id}/reject`),
      operator,
    ).send({ reviewNote: "" });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 4's output — the contract PDF link
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /platform/contracts/:id/download", () => {
  async function approvedContract() {
    const application = await request(server()).post("/v1/applications").send(FORM).expect(201);

    await authed(
      request(server()).post(`/v1/platform/applications/${application.body.id}/approve`),
      operator,
    )
      .send(TERMS)
      .expect(200);

    const contract = await db.contract.findFirstOrThrow({
      where: { applicationId: application.body.id },
    });
    return contract.id;
  }

  it("is 404 for a kindergarten admin, not 403", async () => {
    const id = await approvedContract();

    const res = await authed(
      request(server()).get(`/v1/platform/contracts/${id}/download`),
      adminA,
    );

    expect(res.status).toBe(404);
  });

  /**
   * ★ The worker is off in tests (`REPORTS_WORKER_ENABLED=false`), so the PDF
   * never renders and `pdfMediaFileId` stays null. That is the state a real
   * operator sees for the couple of seconds after approving, and it must be a
   * clear 400 rather than a presigned URL for an object that does not exist.
   */
  it("refuses a download before the PDF has been rendered", async () => {
    const id = await approvedContract();

    const res = await authed(
      request(server()).get(`/v1/platform/contracts/${id}/download`),
      operator,
    );

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The first administrator
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ★★★ Approving used to create a `Kindergarten` and nothing else, which left a
 * tenant **nobody could sign in to** — the flow dead-ended at step 3 and the
 * defect was invisible from the API, because every endpoint answered correctly
 * about a kindergarten that simply had no members.
 *
 * `POST /platform/kindergartens`, the older direct path, has always created the
 * admin and an invitation alongside the tenant. These assert the two paths now
 * agree about what "a kindergarten exists" means.
 */
describe("the first administrator", () => {
  async function applyAndApprove(overrides: Record<string, unknown> = {}) {
    const application = await request(server()).post("/v1/applications").send(FORM).expect(201);

    return authed(
      request(server()).post(`/v1/platform/applications/${application.body.id}/approve`),
      operator,
    ).send({ ...TERMS, ...overrides });
  }

  it("creates an ADMIN membership so somebody can sign in", async () => {
    const res = await applyAndApprove();
    expect(res.status).toBe(200);

    const membership = await db.membership.findFirst({
      where: { kindergartenId: res.body.kindergartenId, role: "ADMIN" },
      include: { user: { select: { username: true, email: true } } },
    });

    expect(membership).not.toBeNull();
    expect(membership?.user.username).toBe(TERMS.adminUsername);
    expect(membership?.user.email).toBe(FORM.email);
  });

  it("issues a one-time invitation, and returns it once", async () => {
    const res = await applyAndApprove();

    expect(res.body.invitationToken).toBeTruthy();
    expect(res.body.adminUsername).toBe(TERMS.adminUsername);

    const membership = await db.membership.findFirstOrThrow({
      where: { kindergartenId: res.body.kindergartenId, role: "ADMIN" },
    });
    const token = await db.authToken.findFirst({
      where: { userId: membership.userId, purpose: "INVITATION" },
    });

    expect(token).not.toBeNull();
    // ★ Stored hashed. The plaintext exists only in the response above.
    expect(token?.tokenHash).not.toBe(res.body.invitationToken);
  });

  /**
   * ★ Refused before anything is written, not as a constraint violation
   * halfway through the transaction — which would leave the operator with a
   * 500 and no idea which field was the problem.
   */
  it("refuses a username that is already taken, and creates nothing", async () => {
    const before = await db.kindergarten.count();

    const res = await applyAndApprove({ adminUsername: scenario.adminUser.username });

    expect(res.status).toBe(409);
    expect(await db.kindergarten.count()).toBe(before);
    expect(await db.contract.count()).toBe(0);
  });
});
