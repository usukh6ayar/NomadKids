import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { REFUSAL, STALE_AFTER_MS } from "../src/staff-registration/staff-registration.service";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createKindergarten,
  createMembership,
  createUser,
  login,
  type AuthSession,
} from "./support/fixtures";

const db = testDb();

/**
 * Staff self-registration reaches no ESIS mock and needs none: `issueCode`
 * drives Task 4's real route, and `seedRoster` writes `EsisStaffRoster` rows
 * directly, exactly as `EsisAdminService.refreshStaffRoster` would have left
 * them. `createTestApp()` therefore takes no `esis` override — this whole
 * file is the proof that the public route never has to.
 */
let app: INestApplication;
const server = () => app.getHttpServer();

/**
 * A bare tenant: a kindergarten and one admin. Not `createScenario` — that
 * helper's teacher and parent fixtures default to `lastName: "Овог"`
 * (`test/support/fixtures.ts`), the same placeholder name `seedRoster` below
 * uses for the person being registered, and several assertions in this file
 * count `db.user` rows by that exact `lastName`. A shared default would make
 * those assertions true from `beforeEach` alone, before any registration
 * attempt — passing for the wrong reason, which is worse than failing.
 */
async function createTenant(label: string) {
  const kindergarten = await createKindergarten(`Цэцэрлэг ${label}-${uniq()}`);
  const adminUser = await createUser({
    username: uniq(`admin-${label}`),
    lastName: "Захирал",
    firstName: label,
  });
  await createMembership(adminUser.id, kindergarten.id, "ADMIN");
  const adminSession = await login(app, adminUser.username);
  return { kindergarten, adminUser, adminSession };
}

let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;

/**
 * Calls Task 4's route to issue a code for the given kindergarten, signed in
 * as that kindergarten's own admin — `a`'s for `a.kindergarten.id`, `b`'s for
 * `b.kindergarten.id`. An admin of the wrong tenant would get a 404 from that
 * route (CLAUDE.md §1.7) and this helper would return `undefined`, which is
 * exactly the bug the cross-tenant test below exists to catch if this ever
 * gets that wrong.
 */
async function issueCode(kindergartenId: string): Promise<string> {
  const session: AuthSession =
    kindergartenId === a.kindergarten.id ? a.adminSession : b.adminSession;
  const res = await authed(
    request(server()).post(`/v1/kindergartens/${kindergartenId}/staff-registration-code`),
    session,
  ).send({});
  return res.body.code as string;
}

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createTenant("a");
  b = await createTenant("b");
});

/*
 * ★ The route is **public** — the teacher has no account yet. So it must not
 * reach ESIS: public traffic in the ministry's logs is what the roster table
 * exists to prevent. Every case below matches against stored rows only.
 */
describe("staff self-registration", () => {
  const url = "/v1/staff-registration";
  const REG = "УЛ24270406";

  const seedRoster = (kindergartenId: string, overrides = {}) =>
    db.esisStaffRoster.create({
      data: {
        kindergartenId,
        esisPersonId: "90000000000001",
        registerNumber: REG,
        lastName: "Овог",
        firstName: "Нэр",
        jobCode: "2342-13",
        positionName: "Багш, цэцэрлэгийн /мэргэжлийн/ /СӨБ/",
        isInstructor: true,
        ...overrides,
      },
    });

  it("registers a teacher who is on the roster and knows the code", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id);

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(201);
    expect(typeof res.body.invitationToken).toBe("string");

    const membership = await db.membership.findFirst({
      where: { kindergartenId: a.kindergarten.id, role: "TEACHER" },
      orderBy: { createdAt: "desc" },
      include: { user: true },
    });
    expect(membership?.user.lastName).toBe("Овог");
  });

  /*
   * ★★ The account is unusable until the teacher redeems the token. Nobody —
   * not the director, not the developer — ever knows their password.
   */
  it("creates an account that cannot be logged into yet", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id);
    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    const user = await db.user.findFirstOrThrow({ where: { lastName: "Овог" } });
    const login_ = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: "Password123!" });

    expect(login_.status).toBe(401);
    expect(res.body.invitationToken).toBeTruthy();
  });

  /*
   * ★★★ Every refusal returns the same status and the same message.
   *
   * If "wrong code" and "not on this roster" differed, the route would answer
   * "does this person work at this kindergarten?" for anybody holding a list of
   * register numbers — which is a list that exists on paper in several offices.
   */
  it.each([
    ["a wrong code", async () => ({ code: "wrongcode", registerNumber: REG })],
    [
      "a register number not on the roster",
      async () => ({ code: await issueCode(a.kindergarten.id), registerNumber: "УБ99998888" }),
    ],
    [
      "a malformed register number",
      async () => ({ code: await issueCode(a.kindergarten.id), registerNumber: "nonsense" }),
    ],
  ])("refuses %s with the same answer as every other refusal", async (_label, build) => {
    await seedRoster(a.kindergarten.id);

    const res = await request(server())
      .post(url)
      .send(await build());

    expect(res.status).toBe(401);
    expect(res.body.detail ?? res.body.message).toBe(REFUSAL);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  /* A person on the roster whose job maps to no role cannot register at all. */
  it.each([
    ["5153-12"], // Жижүүр
    ["1341-02"], // Эрхлэгч — ADMIN is invitation-only
  ])("refuses jobCode %s even with a valid code and a roster row", async (jobCode) => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id, { jobCode });

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(
      await db.membership.count({ where: { kindergartenId: a.kindergarten.id, role: "ADMIN" } }),
    ).toBe(1);
  });

  /* Registering twice must not mint a second account for the same person. */
  it("refuses a second registration for a person who already has an account", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id);

    await request(server()).post(url).send({ code, registerNumber: REG });
    const second = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(second.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(1);
  });

  /*
   * ★ A kindergarten with no code set must refuse everything, rather than
   * treating "no code" as "any code".
   */
  it("refuses when the kindergarten has never issued a code", async () => {
    // `a` is a fresh tenant from this test's own `beforeEach`; nothing in this
    // test calls `issueCode`, so `staffRegistrationCodeHash` stays null.
    await seedRoster(a.kindergarten.id);

    const res = await request(server()).post(url).send({ code: "anything", registerNumber: REG });

    expect(res.status).toBe(401);
  });

  /*
   * ★★ Fail closed on an absent roster, and on a stale one — design §5.
   *
   * An empty table is not "nobody works here", it is "nobody has refreshed
   * this", and the two must not produce the same answer as a genuine match.
   * The stale case is the sharper one: a roster from six months ago still
   * lists the people who have left, which is exactly who must no longer be
   * able to mint an account.
   *
   * There is no fallback to a live ESIS call here and there must not be — the
   * route is public, and the roster exists precisely so that public traffic
   * never reaches the ministry.
   */
  it("refuses when the roster has never been filled", async () => {
    const code = await issueCode(a.kindergarten.id);

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  it("refuses when the roster is older than the staleness threshold", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id, {
      syncedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
    });

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  it("accepts a roster that is inside the threshold", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id, {
      syncedAt: new Date(Date.now() - STALE_AFTER_MS + 60_000),
    });

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(201);
  });

  /*
   * ★★ Another kindergarten's code must not reach this roster. The code is
   * looked up to find the kindergarten, so this is the tenant boundary itself.
   */
  it("does not let one kindergarten's code match another's roster", async () => {
    const codeB = await issueCode(b.kindergarten.id);
    await seedRoster(a.kindergarten.id);

    const res = await request(server()).post(url).send({ code: codeB, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  /*
   * ★ All six of `register()`'s distinct throw sites, compared byte for byte
   * rather than field by field: a wrong code, a register number absent from
   * the roster, one that does not parse, a jobCode this product refuses to
   * turn into a role, a roster row too stale to trust, and a person who
   * already has an account. The `it.each` above already checks
   * `detail`/`message` against `REFUSAL` for three of these; this compares
   * the **whole parsed body** for all six, which additionally rules out a
   * different field (a `hint`, an extra key, a differently shaped `title`)
   * leaking a distinction the message itself does not — exactly what
   * `REFUSAL`'s own doc comment says the branches must not do.
   */
  it("returns byte-identical response bodies across all six refusal branches", async () => {
    const code = await issueCode(a.kindergarten.id);
    const REG_UNMAPPED = "УБ11112222";
    const REG_STALE = "УБ33334444";

    await seedRoster(a.kindergarten.id);
    await seedRoster(a.kindergarten.id, {
      esisPersonId: "90000000000002",
      registerNumber: REG_UNMAPPED,
      jobCode: "5153-12", // жижүүр — maps to no role
    });
    await seedRoster(a.kindergarten.id, {
      esisPersonId: "90000000000003",
      registerNumber: REG_STALE,
      syncedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
    });

    // Consumed for real, so the sixth payload below hits "already registered"
    // rather than a fresh match.
    const registered = await request(server()).post(url).send({ code, registerNumber: REG });
    expect(registered.status).toBe(201);

    const payloads = [
      { code: "wrongcode", registerNumber: REG }, // 1. wrong code
      { code, registerNumber: "УБ99998888" }, // 2. not on the roster
      { code, registerNumber: "nonsense" }, // 3. malformed
      { code, registerNumber: REG_UNMAPPED }, // 4. jobCode maps to no role
      { code, registerNumber: REG_STALE }, // 5. roster row too stale
      { code, registerNumber: REG }, // 6. already has an account
    ];

    const bodies = await Promise.all(
      payloads.map(async (payload) => {
        const res = await request(server()).post(url).send(payload);
        // `requestId` is a per-request correlation id the exception filter
        // stamps on every problem response — it differs by construction and
        // says nothing about which refusal fired, so it is excluded here the
        // same way a byte-for-byte comparison would otherwise falsely fail.
        const { requestId: _requestId, ...body } = JSON.parse(res.text) as Record<string, unknown>;
        return { status: res.status, body };
      }),
    );

    for (const entry of bodies) {
      expect(entry).toEqual(bodies[0]);
    }
  });

  /* CLAUDE.md §3.6 — the counter must survive the failing request's rollback. */
  it("rate-limits repeated failures", async () => {
    await seedRoster(a.kindergarten.id);

    const attempts = [];
    for (let i = 0; i < 12; i += 1) {
      attempts.push(await request(server()).post(url).send({ code: "wrong", registerNumber: REG }));
    }

    expect(attempts.some((res) => res.status === 429)).toBe(true);
  });
});
