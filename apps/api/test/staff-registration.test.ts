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
/**
 * The kindergarten chosen by name instead of its ESIS number (#211): the
 * sign-up dialog lists a district's contracted kindergartens and sends the id.
 * Everything behind the first field is unchanged — and so is the one refusal.
 */
describe("staff self-registration by kindergarten id", () => {
  const url = "/v1/staff-registration";

  it("registers a teacher on the roster who chose their kindergarten", async () => {
    await seedRoster(a.kindergarten.id);

    const res = await request(server())
      .post(url)
      .send({ kindergartenId: a.kindergarten.id, registerNumber: REG });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const membership = await db.membership.findFirst({
      where: { kindergartenId: a.kindergarten.id, role: "TEACHER" },
    });
    expect(membership).not.toBeNull();
  });

  it("refuses a solo workspace, an inactive kindergarten, an unknown and a malformed id alike", async () => {
    const solo = await createKindergarten(`Бие даасан ${uniq()}`);
    await db.kindergarten.update({ where: { id: solo.id }, data: { kind: "SOLO_TEACHER" } });
    await seedRoster(solo.id);
    await db.kindergarten.update({ where: { id: b.kindergarten.id }, data: { isActive: false } });
    await seedRoster(b.kindergarten.id, { esisPersonId: "90000000000002" });

    const ids = [solo.id, b.kindergarten.id, "00000000-0000-4000-8000-000000000000", "not-an-id"];
    const responses = [];
    for (const kindergartenId of ids) {
      responses.push(
        await request(server()).post(url).send({ kindergartenId, registerNumber: REG }),
      );
    }

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    // `requestId` differs by construction — see the six-branch case above.
    const bodies = responses.map((r) => {
      const { requestId: _requestId, ...body } = r.body as Record<string, unknown>;
      return JSON.stringify(body);
    });
    expect(new Set(bodies).size).toBe(1);
    expect(responses[0]!.body.detail ?? responses[0]!.body.message).toBe(REFUSAL);
    const created = await db.membership.count({ where: { role: "TEACHER" } });
    expect(created).toBe(0);
  });

  it("takes exactly one of the ESIS number and the kindergarten", async () => {
    const both = await request(server()).post(url).send({
      institutionId: a.institutionId,
      kindergartenId: a.kindergarten.id,
      registerNumber: REG,
    });
    const neither = await request(server()).post(url).send({ registerNumber: REG });

    expect([both.status, neither.status]).toEqual([400, 400]);
  });
});

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

/*
 * «Бүх багшийг урих» — the client, 2026-10-15: the director invites the ESIS
 * roster the way a teacher invites a group's parents, one QR per person, and
 * the account is linked to its ESIS record from the start.
 */
describe("a director invites from the ESIS roster", () => {
  const url = (kindergartenId: string) => `/v1/kindergartens/${kindergartenId}/staff-invitations`;
  const PASSWORD = "Shine-Nuuts99";

  beforeEach(async () => {
    await seedRoster(a.kindergarten.id, {
      esisPersonId: "esis-teacher",
      registerNumber: "УЛ90010101",
      lastName: "Ганжаргал",
      firstName: "Болд",
    });
    await seedRoster(a.kindergarten.id, {
      esisPersonId: "esis-cook",
      registerNumber: "УЛ90010102",
      lastName: "Амаржаргал",
      firstName: "Сэлэнгэ",
      jobCode: "5120-11",
      positionName: "туслах Тогооч",
      isInstructor: false,
    });
    // The жижүүр: a job code that grants no role, so no invitation.
    await seedRoster(a.kindergarten.id, {
      esisPersonId: "esis-caretaker",
      registerNumber: "УЛ90010103",
      lastName: "Минжмаа",
      firstName: "Пүрэв",
      jobCode: "5153-11",
      positionName: "Жижүүр /байрны/",
      isInstructor: false,
    });
  });

  it("invites every unclaimed person a role fits, each account linked to ESIS", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send(
      {},
    );

    expect(res.status).toBe(201);
    expect(res.body.skipped).toBe(1);
    expect(
      res.body.items.map((item: { esisPersonId: string; role: string }) => [
        item.esisPersonId,
        item.role,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["esis-teacher", "TEACHER"],
        ["esis-cook", "COOK"],
      ]),
    );
    expect(res.body.items).toHaveLength(2);

    const teacher = await db.user.findUniqueOrThrow({
      where: { esisPersonId: "esis-teacher" },
      include: { memberships: true },
    });
    expect(teacher.lastName).toBe("Ганжаргал");
    // The director made it, not the person — «Ажилтны бүртгэл» must not list it.
    expect(teacher.selfRegisteredAt).toBeNull();
    expect(teacher.memberships.map((m) => [m.kindergartenId, m.role])).toEqual([
      [a.kindergarten.id, "TEACHER"],
    ]);
    expect(await db.user.count({ where: { esisPersonId: "esis-caretaker" } })).toBe(0);

    // Nobody is left on the unclaimed list but the caretaker.
    const unclaimed = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/esis/staff-roster/unclaimed`),
      a.adminSession,
    );
    expect(unclaimed.body.items.map((row: { esisPersonId: string }) => row.esisPersonId)).toEqual([
      "esis-caretaker",
    ]);
    expect(unclaimed.body.items[0].role).toBeNull();
  });

  it("opens an account the person activates and signs into, without retyping their name", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send({
      esisPersonId: "esis-teacher",
    });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    const token = res.body.items[0].invitationToken as string;

    const described = await request(server()).get(`/v1/auth/invitation/${token}`);
    expect(described.body).toMatchObject({ valid: true, kind: "staff", knows: { name: true } });

    const accept = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token, password: PASSWORD });
    expect(accept.status).toBe(204);

    const account = await db.user.findUniqueOrThrow({ where: { esisPersonId: "esis-teacher" } });
    const signIn = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: account.username, password: PASSWORD });
    expect(signIn.status).toBe(200);
  });

  it("invites nobody twice", async () => {
    await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send({});
    const again = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send(
      {},
    );

    expect(again.status).toBe(201);
    expect(again.body.items).toEqual([]);
    expect(await db.user.count({ where: { esisPersonId: "esis-teacher" } })).toBe(1);
  });

  it("skips a person who already has an account here under the same name", async () => {
    const existing = await createUser({
      username: uniq("invited"),
      lastName: "Ганжаргал",
      firstName: "Болд",
    });
    await createMembership(existing.id, a.kindergarten.id, "TEACHER");

    const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send(
      {},
    );

    expect(res.body.items.map((item: { esisPersonId: string }) => item.esisPersonId)).toEqual([
      "esis-cook",
    ]);
  });

  it("lets the director choose the role on one row — a PE teacher ESIS files as a teacher", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send({
      esisPersonId: "esis-teacher",
      role: "PE_TEACHER",
    });

    expect(res.status).toBe(201);
    expect(res.body.items[0].role).toBe("PE_TEACHER");
    const account = await db.user.findUniqueOrThrow({
      where: { esisPersonId: "esis-teacher" },
      include: { memberships: true },
    });
    expect(account.memberships.map((m) => m.role)).toEqual(["PE_TEACHER"]);
  });

  it("grants a role the job code gives none, when the director picks it — the doctor", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send({
      esisPersonId: "esis-caretaker",
      role: "DOCTOR",
    });

    expect(res.status).toBe(201);
    expect(res.body.items[0].role).toBe("DOCTOR");
  });

  it("refuses a chosen role for the whole roster, and ADMIN or ACCOUNTANT on any row", async () => {
    const bulk = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send({
      role: "PE_TEACHER",
    });
    expect(bulk.status).toBe(400);

    for (const role of ["ADMIN", "ACCOUNTANT", "PARENT"]) {
      const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send(
        { esisPersonId: "esis-teacher", role },
      );
      expect(res.status, role).toBe(400);
    }
    expect(await db.user.count({ where: { esisPersonId: { not: null } } })).toBe(0);
  });

  it("answers 404 for a person not on this kindergarten's unclaimed list", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send({
      esisPersonId: "not-on-the-roster",
    });

    expect(res.status).toBe(404);
  });

  it("refuses one row whose job code grants no role", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send({
      esisPersonId: "esis-caretaker",
    });

    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { esisPersonId: "esis-caretaker" } })).toBe(0);
  });

  it("refuses a roster older than the staleness threshold", async () => {
    await db.esisStaffRoster.updateMany({
      where: { kindergartenId: a.kindergarten.id },
      data: { syncedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000) },
    });

    const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send(
      {},
    );

    expect(res.status).toBe(400);
    expect(await db.user.count({ where: { esisPersonId: { not: null } } })).toBe(0);
  });

  it("returns 404 to a teacher, and creates nothing", async () => {
    const teacherUser = await createUser({ username: uniq("teacher-a") });
    await createMembership(teacherUser.id, a.kindergarten.id, "TEACHER");
    const teacherSession = await login(app, teacherUser.username);

    const res = await authed(request(server()).post(url(a.kindergarten.id)), teacherSession).send(
      {},
    );

    expect(res.status).toBe(404);
    expect(await db.user.count({ where: { esisPersonId: { not: null } } })).toBe(0);
  });

  it("returns 404 to an admin of another kindergarten, and creates nothing", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), b.adminSession).send(
      {},
    );

    expect(res.status).toBe(404);
    expect(await db.user.count({ where: { esisPersonId: { not: null } } })).toBe(0);
  });

  /**
   * ★ Taking an invitation back (the user, 2026-10-15). The code on the card is
   * stored hashed and is shown once; a director who lost it, or invited the
   * wrong person, had no way back — the person was off the unclaimed list for
   * good. Revoking returns them to it, so a fresh card can be printed.
   */
  describe("taking an invitation back", () => {
    const revoke = (membershipId: string) => `/v1/memberships/${membershipId}/invitation`;

    async function inviteTeacher() {
      const res = await authed(request(server()).post(url(a.kindergarten.id)), a.adminSession).send(
        { esisPersonId: "esis-teacher" },
      );
      expect(res.status).toBe(201);
      const user = await db.user.findUniqueOrThrow({
        where: { esisPersonId: "esis-teacher" },
        include: { memberships: true },
      });
      return { user, membership: user.memberships[0]!, token: res.body.items[0].invitationToken };
    }

    it("returns the person to the unclaimed list, and a new card can be printed", async () => {
      const { user, membership, token } = await inviteTeacher();

      const res = await authed(request(server()).delete(revoke(membership.id)), a.adminSession);
      expect(res.status).toBe(204);

      const unclaimed = await authed(
        request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/esis/staff-roster/unclaimed`),
        a.adminSession,
      );
      expect(
        unclaimed.body.items.map((row: { esisPersonId: string }) => row.esisPersonId),
      ).toContain("esis-teacher");

      // The old card opens nothing.
      const described = await request(server()).get(`/v1/auth/invitation/${token}`);
      expect(described.body.valid).toBe(false);

      // Archived, never deleted — and the ESIS id is free for the next account.
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.deletedAt).not.toBeNull();
      expect(row.esisPersonId).toBeNull();
      const audit = await db.auditLog.findFirst({
        where: { objectType: "Membership", objectId: membership.id, action: "DELETE" },
      });
      expect(audit?.actorUserId).toBe(a.adminUser.id);

      const again = await authed(
        request(server()).post(url(a.kindergarten.id)),
        a.adminSession,
      ).send({ esisPersonId: "esis-teacher" });
      expect(again.status).toBe(201);
      expect(again.body.items).toHaveLength(1);
    });

    it("works after the membership was deactivated", async () => {
      const { membership } = await inviteTeacher();
      await authed(request(server()).delete(`/v1/memberships/${membership.id}`), a.adminSession);

      const res = await authed(request(server()).delete(revoke(membership.id)), a.adminSession);
      expect(res.status).toBe(204);
    });

    it("refuses once the person has signed in — that is «Идэвхгүй болгох»", async () => {
      const { user, membership } = await inviteTeacher();
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      const res = await authed(request(server()).delete(revoke(membership.id)), a.adminSession);
      expect(res.status).toBe(409);
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.deletedAt).toBeNull();
    });

    it("returns 404 to an admin of another kindergarten, and changes nothing", async () => {
      const { user, membership } = await inviteTeacher();

      const res = await authed(request(server()).delete(revoke(membership.id)), b.adminSession);
      expect(res.status).toBe(404);
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.deletedAt).toBeNull();
    });

    it("returns 404 to a teacher of the same kindergarten", async () => {
      const { membership } = await inviteTeacher();
      const teacherUser = await createUser({ username: uniq("teacher-a") });
      await createMembership(teacherUser.id, a.kindergarten.id, "TEACHER");
      const teacherSession = await login(app, teacherUser.username);

      const res = await authed(request(server()).delete(revoke(membership.id)), teacherSession);
      expect(res.status).toBe(404);
    });
  });
});
