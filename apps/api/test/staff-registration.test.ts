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
} from "./support/fixtures";

const db = testDb();

/**
 * Staff self-registration reaches no ESIS mock and needs none: the institution
 * number is a column, and `seedRoster` writes `EsisStaffRoster` rows directly,
 * exactly as `EsisAdminService.refreshStaffRoster` would have left them.
 * `createTestApp()` therefore takes no `esis` override — this whole file is
 * the proof that the public route never has to.
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
  /*
   * ★ The ESIS institution number is what the public form's first field
   * carries since 2026-09-20. Written straight onto the row because only the
   * platform operator's route sets it in production — a director cannot, and
   * a test that went through that route would be testing the platform module.
   */
  const institutionId = `4${uniq()}`.slice(0, 12);
  await db.kindergarten.update({
    where: { id: kindergarten.id },
    data: { esisInstitutionId: institutionId },
  });
  const adminUser = await createUser({
    username: uniq(`admin-${label}`),
    lastName: "Захирал",
    firstName: label,
  });
  await createMembership(adminUser.id, kindergarten.id, "ADMIN");
  const adminSession = await login(app, adminUser.username);
  return { kindergarten, adminUser, adminSession, institutionId };
}

let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;

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

/**
 * The register number both `describe` blocks below match against, and the
 * roster row that carries it — the teacher self-registration matches, and the
 * one "who registered" reads back once a registration has gone through it.
 * Lifted to file scope rather than repeated per block.
 */
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

/*
 * ★ The route is **public** — the teacher has no account yet. So it must not
 * reach ESIS: public traffic in the ministry's logs is what the roster table
 * exists to prevent. Every case below matches against stored rows only.
 */
describe("staff self-registration", () => {
  const url = "/v1/staff-registration";

  it("registers a teacher on the roster who names their institution", async () => {
    const institutionId = a.institutionId;
    await seedRoster(a.kindergarten.id);

    const res = await request(server()).post(url).send({ institutionId, registerNumber: REG });

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
    const institutionId = a.institutionId;
    await seedRoster(a.kindergarten.id);
    const res = await request(server()).post(url).send({ institutionId, registerNumber: REG });

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
   * If "unknown institution number" and "not on this roster" differed, the
   * route would answer "does this person work at this kindergarten?" for
   * anybody holding a list of register numbers — which is a list that exists
   * on paper in several offices. The institution number itself is public, so
   * this uniformity is the whole defence at that layer.
   */
  it.each([
    [
      "an unknown institution number",
      async () => ({ institutionId: "9999999", registerNumber: REG }),
    ],
    [
      "a register number not on the roster",
      async () => ({ institutionId: a.institutionId, registerNumber: "УБ99998888" }),
    ],
    [
      "a malformed register number",
      async () => ({ institutionId: a.institutionId, registerNumber: "nonsense" }),
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
  ])(
    "refuses jobCode %s even with a valid institution number and a roster row",
    async (jobCode) => {
      const institutionId = a.institutionId;
      await seedRoster(a.kindergarten.id, { jobCode });

      const res = await request(server()).post(url).send({ institutionId, registerNumber: REG });

      expect(res.status).toBe(401);
      expect(
        await db.membership.count({ where: { kindergartenId: a.kindergarten.id, role: "ADMIN" } }),
      ).toBe(1);
    },
  );

  /* Registering twice must not mint a second account for the same person. */
  it("refuses a second registration for a person who already has an account", async () => {
    const institutionId = a.institutionId;
    await seedRoster(a.kindergarten.id);

    await request(server()).post(url).send({ institutionId, registerNumber: REG });
    const second = await request(server()).post(url).send({ institutionId, registerNumber: REG });

    expect(second.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(1);
  });

  /*
   * ★ An institution number no kindergarten here carries must refuse
   * everything, rather than being treated as "any kindergarten".
   */
  it("refuses an institution number no kindergarten carries", async () => {
    await seedRoster(a.kindergarten.id);

    const res = await request(server())
      .post(url)
      .send({ institutionId: "anything", registerNumber: REG });

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
    const institutionId = a.institutionId;

    const res = await request(server()).post(url).send({ institutionId, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  it("refuses when the roster is older than the staleness threshold", async () => {
    const institutionId = a.institutionId;
    await seedRoster(a.kindergarten.id, {
      syncedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
    });

    const res = await request(server()).post(url).send({ institutionId, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  it("accepts a roster that is inside the threshold", async () => {
    const institutionId = a.institutionId;
    await seedRoster(a.kindergarten.id, {
      syncedAt: new Date(Date.now() - STALE_AFTER_MS + 60_000),
    });

    const res = await request(server()).post(url).send({ institutionId, registerNumber: REG });

    expect(res.status).toBe(201);
  });

  /*
   * ★★ Another kindergarten's institution number must not reach this roster.
   * That number is what resolves the kindergarten, so this is the tenant
   * boundary itself.
   */
  it("does not let one kindergarten's number match another's roster", async () => {
    const institutionIdB = b.institutionId;
    await seedRoster(a.kindergarten.id);

    const res = await request(server())
      .post(url)
      .send({ institutionId: institutionIdB, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  /*
   * ★ All six of `register()`'s distinct throw sites, compared byte for byte
   * rather than field by field: an unknown institution number, a register
   * number absent from
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
    const institutionId = a.institutionId;
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
    const registered = await request(server())
      .post(url)
      .send({ institutionId, registerNumber: REG });
    expect(registered.status).toBe(201);

    const payloads = [
      { institutionId: "9999999", registerNumber: REG }, // 1. unknown institution number
      { institutionId, registerNumber: "УБ99998888" }, // 2. not on the roster
      { institutionId, registerNumber: "nonsense" }, // 3. malformed
      { institutionId, registerNumber: REG_UNMAPPED }, // 4. jobCode maps to no role
      { institutionId, registerNumber: REG_STALE }, // 5. roster row too stale
      { institutionId, registerNumber: REG }, // 6. already has an account
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
      attempts.push(
        await request(server()).post(url).send({ institutionId: "9999999", registerNumber: REG }),
      );
    }

    expect(attempts.some((res) => res.status === 429)).toBe(true);
  });
});

/*
 * ★ The client's instruction: "захирал заавал батлах хэрэг байхгүй зүгээр
 * хянадад л болно хэн хэн бүртгүүлсэн байгаа эсэх мэдээлэл" — review, not
 * approval. This is a read; revocation already exists as `DELETE
 * /v1/memberships/:id` and is not rebuilt here.
 */
describe("who registered themselves", () => {
  const url = (kindergartenId: string) => `/v1/kindergartens/${kindergartenId}/staff-registrations`;

  it("lists self-registered staff with when and as what", async () => {
    const institutionId = a.institutionId;
    await seedRoster(a.kindergarten.id);
    await request(server())
      .post("/v1/staff-registration")
      .send({ institutionId, registerNumber: REG });

    const res = await authed(request(server()).get(url(a.kindergarten.id)), a.adminSession);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      lastName: "Овог",
      firstName: "Нэр",
      role: "TEACHER",
      source: "SELF_REGISTERED",
    });
  });

  /*
   * A register number must not appear on a list a screen renders. `REG` alone
   * cannot fail here — it lives only on `EsisStaffRoster`, which this route
   * never joins against — so `esisPersonId` is checked too: it lives on the
   * very row the query selects from, and a widened `select` would ship it.
   */
  it("does not return a register number or an esisPersonId", async () => {
    const institutionId = a.institutionId;
    await seedRoster(a.kindergarten.id);
    await request(server())
      .post("/v1/staff-registration")
      .send({ institutionId, registerNumber: REG });

    const res = await authed(request(server()).get(url(a.kindergarten.id)), a.adminSession);
    const text = JSON.stringify(res.body);

    expect(text).not.toContain(REG);
    expect(text).not.toContain("90000000000001");
  });

  it("returns 404 to a teacher", async () => {
    const teacherUser = await createUser({ username: uniq("teacher-a") });
    await createMembership(teacherUser.id, a.kindergarten.id, "TEACHER");
    const teacherSession = await login(app, teacherUser.username);

    const res = await authed(request(server()).get(url(a.kindergarten.id)), teacherSession);

    expect(res.status).toBe(404);
  });

  it("returns 404 to an admin of another kindergarten", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), b.adminSession);

    expect(res.status).toBe(404);
  });

  /* An invited account leaves `esisPersonId` NULL, so it never appears here. */
  it("does not list an account created by invitation", async () => {
    const invitedUser = await createUser({ username: uniq("invited-a") });
    await createMembership(invitedUser.id, a.kindergarten.id, "TEACHER");

    const res = await authed(request(server()).get(url(a.kindergarten.id)), a.adminSession);

    expect(res.body.items).toHaveLength(0);
  });

  /*
   * A membership `DELETE /v1/memberships/:id` has already revoked has nothing
   * left to review — pins both the `isActive: true` filter and that
   * `membershipId` is the exact field that route accepts, which is the whole
   * reason this list exists: to hand the director something to revoke with.
   */
  it("drops a membership the director has already revoked", async () => {
    const institutionId = a.institutionId;
    await seedRoster(a.kindergarten.id);
    await request(server())
      .post("/v1/staff-registration")
      .send({ institutionId, registerNumber: REG });

    const before = await authed(request(server()).get(url(a.kindergarten.id)), a.adminSession);
    const membershipId = before.body.items[0].membershipId as string;

    const revoke = await authed(
      request(server()).delete(`/v1/memberships/${membershipId}`),
      a.adminSession,
    );
    expect(revoke.status).toBeLessThan(300);

    const after = await authed(request(server()).get(url(a.kindergarten.id)), a.adminSession);
    expect(after.body.items).toHaveLength(0);
  });
});
