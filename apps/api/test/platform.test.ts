import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createUser,
  login,
  TEST_PASSWORD,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { EsisError } from "../src/integrations/esis/esis.client";
import type { EsisService } from "../src/integrations/esis/esis.service";
import { PlatformRepository } from "../src/platform/platform.repository";

/**
 * Platform routes — through HTTP.
 *
 * Two things are under test and the second matters more than the first: that a
 * platform operator can register a kindergarten, and that being one grants
 * *nothing else*. CLAUDE.md §4.1.
 */

let app: INestApplication;
const db = testDb();

/** Institution 42778, the one the ministry granted — measured 2026-09-14. */
const INSTITUTION_ID = "42778";

const organizationRow = {
  institutionId: INSTITUTION_ID,
  institutionName: "Дэгдээхий үрс цэцэрлэг",
  longName: "Баянзүрх дүүргийн Дэгдээхий үрс цэцэрлэг",
  institutionAddress: "Улаанбаатар, Баянзүрх дүүрэг",
  institutionClassificationName: "Цэцэрлэг",
  propertyTypeName: "Төрийн өмчит",
};

/*
 * ★ Two staff rows, and the register numbers are **lower case on purpose** —
 * `school/staff` sends them that way (measured 2026-09-16) and
 * `normalizeRegisterNumber` upper-cases them. A row without one is dropped by
 * the lookup's projection, so every fixture row carries one or the roster
 * assertions below would pass against an empty list.
 */
const directorRow = {
  personId: "90000000000001",
  personRegNumber: "ул24270406",
  lastName: "Эрдэнэ",
  firstName: "Оюун",
  jobCode: "1345-11",
  positionName: "Эрхлэгч",
};
const teacherRow = {
  personId: "90000000000002",
  personRegNumber: "уб99112233",
  lastName: "Батаа",
  firstName: "Сараа",
  jobCode: "2342-13",
  positionName: "Багш, цэцэрлэгийн /мэргэжлийн/ /СӨБ/",
};

/**
 * The ESIS transport, stubbed file-wide.
 *
 * ★ Only the remote transport is replaced — `createTestApp`'s own boundary.
 * `EsisInstitutionLookupService`, its projection, the authorization in front of
 * it and every row it causes to be written are the real ones.
 *
 * ★★ `isConfigured: true`, or the lookup answers 503 before it reads anything
 * and none of the cases below mean what they say.
 */
const read = vi.fn(async (key: string) => ({
  data: key === "staff" ? [directorRow, teacherRow] : [organizationRow],
  status: 200,
  durationMs: 9,
}));
const esis = { isConfigured: true, read } as unknown as Partial<EsisService>;

let a: Scenario;
// A second, independent kindergarten. Task 6 asserts on it; declared now so the
// fixture setup below is final.
let b: Scenario;
let superadmin: AuthSession;
let adminA: AuthSession;
/** Kindergarten b's own director — the person a deletion must lock out. */
let adminB: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;

/** A valid create body, with unique identifiers so cases never collide. */
function createBody(overrides: Record<string, unknown> = {}) {
  return {
    name: `Цэцэрлэг ${uniq()}`,
    address: "Улаанбаатар, Сүхбаатар дүүрэг",
    phone: "99112233",
    email: null,
    description: null,
    admin: {
      username: uniq("director"),
      email: null,
      phone: null,
      lastName: "Дорж",
      firstName: "Болд",
    },
    ...overrides,
  };
}

beforeAll(async () => {
  app = await createTestApp({ esis });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  read.mockClear();
  read.mockImplementation(async (key: string) => ({
    data: key === "staff" ? [directorRow, teacherRow] : [organizationRow],
    status: 200,
    durationMs: 9,
  }));

  a = await createScenario("a");
  b = await createScenario("b");

  const operator = await createUser({ username: uniq("super"), isSuperAdmin: true });
  superadmin = await login(app, operator.username);
  adminA = await login(app, a.adminUser.username);
  adminB = await login(app, b.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
});

describe("POST /platform/kindergartens", () => {
  it("registers a kindergarten with its first director", async () => {
    const body = createBody();

    const res = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      superadmin,
    ).send(body);

    expect(res.status).toBe(201);
    expect(res.body.kindergarten.name).toBe(body.name);
    expect(res.body.admin.username).toBe(body.admin.username);
    expect(typeof res.body.invitationToken).toBe("string");

    const membership = await db.membership.findFirst({
      where: { kindergartenId: res.body.kindergarten.id },
    });
    expect(membership?.role).toBe("ADMIN");
    expect(membership?.userId).toBe(res.body.admin.id);

    const token = await db.authToken.findFirst({ where: { userId: res.body.admin.id } });
    expect(token?.purpose).toBe("INVITATION");
  });

  it("lets the invited director set a password and log in as an ADMIN", async () => {
    const body = createBody();
    const created = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      superadmin,
    ).send(body);

    const accepted = await request(app.getHttpServer())
      .post("/v1/auth/invitation/accept")
      .send({ token: created.body.invitationToken, password: TEST_PASSWORD });
    expect(accepted.status).toBeLessThan(300);

    const director = await login(app, body.admin.username);
    const groups = await request(app.getHttpServer())
      .get(`/v1/groups?kindergartenId=${created.body.kindergarten.id}`)
      .set("Cookie", director.cookies);

    expect(groups.status).toBe(200);
  });

  it("refuses a duplicate username with 409 and creates no kindergarten", async () => {
    const body = createBody({ admin: { ...createBody().admin, username: a.adminUser.username } });

    const res = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      superadmin,
    ).send(body);

    expect(res.status).toBe(409);
    expect(await db.kindergarten.findFirst({ where: { name: body.name } })).toBeNull();
  });

  it.each([
    ["a kindergarten admin", () => adminA],
    ["a teacher", () => teacherA],
    ["a parent", () => parentA],
  ])("refuses %s with 404", async (_label, session) => {
    const res = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      session(),
    ).send(createBody());

    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated request", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/platform/kindergartens")
      .send(createBody());

    expect(res.status).toBe(401);
  });
});

/**
 * Registering a kindergarten **already mapped** to its ESIS institution.
 *
 * ★ The window this closes is the reason it exists. Mapping used to be a
 * second screen, so between the two there was a tenant that existed and was
 * either unmapped or mapped to the wrong institution — and nothing about the
 * first screen made the second one happen.
 *
 * ★★ Every case goes through HTTP against the real route. The lookup runs
 * server-side on the way in, so these are also the proof that a body naming an
 * institution the ministry refuses cannot leave a kindergarten behind.
 */
describe("POST /platform/kindergartens — with an ESIS institution", () => {
  const post = () =>
    authed(request(app.getHttpServer()).post("/v1/platform/kindergartens"), superadmin);

  it("creates the kindergarten already mapped, with its staff roster", async () => {
    const body = createBody({ esisInstitutionId: INSTITUTION_ID });

    const res = await post().send(body);

    expect(res.status).toBe(201);
    const kindergarten = await db.kindergarten.findUnique({
      where: { id: res.body.kindergarten.id },
    });
    expect(kindergarten?.esisInstitutionId).toBe(INSTITUTION_ID);
    expect(kindergarten?.esisMappedAt).toBeInstanceOf(Date);

    const roster = await db.esisStaffRoster.findMany({
      where: { kindergartenId: res.body.kindergarten.id },
      orderBy: { esisPersonId: "asc" },
    });
    expect(roster).toHaveLength(2);
    expect(roster[0]).toMatchObject({
      esisPersonId: "90000000000001",
      // Stored normalised, which is what self-registration matches against.
      registerNumber: "УЛ24270406",
      positionName: "Эрхлэгч",
      // ★ `isInstructor` means "`teacher/list` also returned this person", and
      // the lookup never reads `teacher/list`. It must stay at its default
      // rather than being inferred from a job code.
      isInstructor: false,
    });
    expect(roster[1]).toMatchObject({ esisPersonId: "90000000000002", isInstructor: false });
  });

  /*
   * ★ The roster's spelling of a name wins over the body's, and the body's
   * `username` wins over everything. The names are the ministry's and are what
   * a member of staff is matched against at self-registration; the login name
   * is not a name at all, it is something a person has to be able to type.
   */
  it("takes the admin's name from the roster row and the username from the body", async () => {
    const body = createBody({
      esisInstitutionId: INSTITUTION_ID,
      adminEsisPersonId: "90000000000001",
      admin: {
        username: uniq("director"),
        email: null,
        phone: null,
        lastName: "ОГТ",
        firstName: "ӨӨР",
      },
    });

    const res = await post().send(body);

    expect(res.status).toBe(201);
    expect(res.body.admin.lastName).toBe("Эрдэнэ");
    expect(res.body.admin.firstName).toBe("Оюун");
    expect(res.body.admin.username).toBe(body.admin.username);

    const stored = await db.user.findUnique({ where: { id: res.body.admin.id } });
    expect(stored?.lastName).toBe("Эрдэнэ");
    expect(stored?.firstName).toBe("Оюун");
  });

  it("refuses an institution another kindergarten already holds, and creates nothing", async () => {
    await db.kindergarten.update({
      where: { id: b.kindergarten.id },
      data: {
        esisInstitutionId: INSTITUTION_ID,
        esisMappedAt: new Date(),
      },
    });
    const before = await db.kindergarten.count();
    const body = createBody({ esisInstitutionId: INSTITUTION_ID });

    const res = await post().send(body);

    expect(res.status).toBe(409);
    expect(res.body.detail).toContain("аль хэдийн бүртгэлтэй");
    expect(await db.kindergarten.count()).toBe(before);
    expect(await db.user.findFirst({ where: { username: body.admin.username } })).toBeNull();
  });

  /*
   * ★ The one case `alreadyUsed` cannot see.
   *
   * `esisInstitutionId` is `@unique` across the whole table, but the lookup's
   * `findKindergartenByInstitutionId` carries `deletedAt: null` — so a
   * soft-deleted kindergarten still holds its id and the pre-check truthfully
   * answers "no live kindergarten has this". The insert then fails on the
   * index, and the operator must be told which field is actually the problem
   * rather than being sent to change a username that was fine.
   */
  it("names the institution, not the username, when a soft-deleted kindergarten holds the id", async () => {
    await db.kindergarten.update({
      where: { id: b.kindergarten.id },
      data: {
        esisInstitutionId: INSTITUTION_ID,
        esisMappedAt: new Date(),
        deletedAt: new Date(),
      },
    });
    const body = createBody({ esisInstitutionId: INSTITUTION_ID });

    const res = await post().send(body);

    expect(res.status).toBe(409);
    expect(res.body.detail).toBe("Энэ ESIS байгууллагын код өөр цэцэрлэгтэй холбогдсон байна.");
    expect(await db.kindergarten.findFirst({ where: { name: body.name } })).toBeNull();
  });

  /*
   * ★ ESIS answers 403 for an institution this company account has not been
   * granted. The lookup turns that into 409 rather than forwarding it — 403 is
   * kept out of this product's vocabulary (§1.7) — and what matters here is
   * that the refusal happens *before* anything is written.
   *
   * ★★ `mockImplementation` keyed on the resource, never `mockRejectedValueOnce`:
   * the lookup fires `organization` and `staff` inside one `Promise.all`, so
   * `Once` binds to whichever lands first.
   */
  it("refuses when the ministry has not granted the institution, and creates nothing", async () => {
    read.mockImplementation(async (key: string) => {
      if (key === "organization") {
        throw new EsisError("http", "ESIS responded 403", {
          status: 403,
          path: "/organization/list",
        });
      }
      return { data: [directorRow], status: 200, durationMs: 9 };
    });
    const before = await db.kindergarten.count();
    const body = createBody({ esisInstitutionId: "40284" });

    const res = await post().send(body);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SCOPE_DENIED");
    expect(await db.kindergarten.count()).toBe(before);
    expect(await db.user.findFirst({ where: { username: body.admin.username } })).toBeNull();
  });

  it("refuses an admin who is not on the ministry's staff list", async () => {
    const before = await db.kindergarten.count();
    const body = createBody({
      esisInstitutionId: INSTITUTION_ID,
      adminEsisPersonId: "90000000000999",
    });

    const res = await post().send(body);

    expect(res.status).toBe(409);
    expect(res.body.detail).toBe("Сонгосон ажилтан ESIS-ийн жагсаалтад алга байна.");
    expect(await db.kindergarten.count()).toBe(before);
  });

  /*
   * ★ 400 and not 409: naming a person without naming the institution they
   * belong to is a malformed request, and the schema says so before any service
   * runs — which is also why ESIS is never asked.
   */
  it("rejects an adminEsisPersonId with no institution id", async () => {
    const res = await post().send(createBody({ adminEsisPersonId: "90000000000001" }));

    expect(res.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  /*
   * ★ The whole point of the field being optional. A deployment with no ESIS
   * presence still registers kindergartens, and it does it without the ministry
   * being asked anything at all.
   */
  it("still creates an unmapped kindergarten when no institution is named", async () => {
    const body = createBody();

    const res = await post().send(body);

    expect(res.status).toBe(201);
    expect(read).not.toHaveBeenCalled();

    const kindergarten = await db.kindergarten.findUnique({
      where: { id: res.body.kindergarten.id },
    });
    expect(kindergarten?.esisInstitutionId).toBeNull();
    expect(kindergarten?.esisMappedAt).toBeNull();
    expect(
      await db.esisStaffRoster.count({ where: { kindergartenId: res.body.kindergarten.id } }),
    ).toBe(0);
  });
});

describe("GET /platform/stats", () => {
  it("totals across every kindergarten, not just one", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/stats")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    // resetData() truncates everything, so this is exactly the two
    // createScenario() fixtures: one child, one group, one admin + one
    // teacher, one parent, each.
    /*
     * ★ The totals stay exact. `esis` is asserted separately below rather than
     * folded in here: this case exists to pin that the operator's page counts
     * *every* tenant, and burying six more numbers in it would make a failure
     * say "stats changed" instead of "the totals are wrong".
     */
    expect(res.body).toMatchObject({
      kindergartens: 2,
      groups: 2,
      children: 2,
      staff: 4,
      guardians: 2,
    });
  });

  /*
   * ЭСИС-тэй тулгалт, platform-wide — 2026-09-24, at the client's request.
   *
   * ★ **Sums across tenants, and no call to the ministry.** `EsisStaffRoster`
   * is refilled nightly per kindergarten, so an operator with twenty tenants
   * still costs one query; reading each live would be twenty outbound requests
   * on a page open.
   */
  it("★ sums the ministry's staff roster across every kindergarten", async () => {
    await db.esisStaffRoster.createMany({
      data: [
        { kindergartenId: a.kindergarten.id, esisPersonId: "900001", registerNumber: "УБ00000001" },
        { kindergartenId: a.kindergarten.id, esisPersonId: "900002", registerNumber: "УБ00000002" },
        { kindergartenId: b.kindergarten.id, esisPersonId: "900003", registerNumber: "УБ00000003" },
      ].map((row) => ({ ...row, lastName: "Ганболд", firstName: "Багш", jobCode: "2342-13" })),
    });

    const res = await request(app.getHttpServer())
      .get("/v1/platform/stats")
      .set("Cookie", superadmin.cookies);

    expect(res.body.esis.staffInRoster).toBe(3);
  });

  /*
   * ★★ `connected` counts kindergartens carrying an `esisInstitutionId` — a
   * fact this database holds. It deliberately does not claim the ministry is
   * answering today, which no stored column can know.
   */
  it("★ counts how many kindergartens are mapped to an institution", async () => {
    const before = await request(app.getHttpServer())
      .get("/v1/platform/stats")
      .set("Cookie", superadmin.cookies);
    expect(before.body.esis.connected).toBe(0);

    await db.kindergarten.update({
      where: { id: a.kindergarten.id },
      data: { esisInstitutionId: "42778" },
    });

    const after = await request(app.getHttpServer())
      .get("/v1/platform/stats")
      .set("Cookie", superadmin.cookies);
    expect(after.body.esis.connected).toBe(1);
    expect(after.body.kindergartens).toBe(2);
  });

  /*
   * ★ `staffRegistered` counts every staff role; `staff` beside it counts
   * `TEACHER` and `ADMIN` only. A cook is staff, and the pair is what makes
   * the older tile's narrowing visible rather than silently wrong.
   */
  it("★ counts a cook as staff where the older total does not", async () => {
    const cook = await createUser({ username: uniq("plat-cook") });
    await createMembership(cook.id, a.kindergarten.id, "COOK");

    const res = await request(app.getHttpServer())
      .get("/v1/platform/stats")
      .set("Cookie", superadmin.cookies);

    expect(res.body.esis.staffRegistered).toBe(res.body.staff + 1);
  });

  it.each([
    ["a kindergarten admin", () => adminA],
    ["a teacher", () => teacherA],
    ["a parent", () => parentA],
  ])("refuses %s with 404", async (_label, session) => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/stats")
      .set("Cookie", session().cookies);

    expect(res.status).toBe(404);
  });
});

describe("GET /platform/kindergartens", () => {
  it("lists every kindergarten, not just the operator's", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((k: { id: string }) => k.id);
    expect(ids).toContain(a.kindergarten.id);
    expect(ids).toContain(b.kindergarten.id);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by name", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/platform/kindergartens?q=${encodeURIComponent(a.kindergarten.name)}`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(a.kindergarten.id);
  });

  it("filters by isActive, and ?isActive=false means inactive", async () => {
    await db.kindergarten.update({
      where: { id: b.kindergarten.id },
      data: { isActive: false },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens?isActive=false")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items.map((k: { id: string }) => k.id)).toEqual([b.kindergarten.id]);
  });

  it.each([
    ["a kindergarten admin", () => adminA],
    ["a teacher", () => teacherA],
    ["a parent", () => parentA],
  ])("refuses %s with 404", async (_label, session) => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens")
      .set("Cookie", session().cookies);

    expect(res.status).toBe(404);
  });
});

describe("GET /platform/kindergartens/:id", () => {
  it("returns the kindergarten with its live counts", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/platform/kindergartens/${a.kindergarten.id}`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a.kindergarten.id);
    // createScenario builds one child in one group (admin + teacher = staff,
    // one parent = guardian).
    expect(res.body.counts).toEqual({ children: 1, groups: 1, staff: 2, guardians: 1 });
    expect(Array.isArray(res.body.assessmentCoverage)).toBe(true);
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens/00000000-0000-4000-8000-000000000000")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("refuses a kindergarten admin with 404 — even for their own kindergarten", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/platform/kindergartens/${a.kindergarten.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /platform/kindergartens/:id", () => {
  it("deactivates a kindergarten without deleting it", async () => {
    const res = await authed(
      request(app.getHttpServer()).patch(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    ).send({ isActive: false });

    expect(res.status).toBe(200);

    const row = await db.kindergarten.findUnique({ where: { id: b.kindergarten.id } });
    expect(row?.isActive).toBe(false);
    expect(row?.deletedAt).toBeNull();
  });

  it("refuses a kindergarten admin with 404", async () => {
    const res = await authed(
      request(app.getHttpServer()).patch(`/v1/platform/kindergartens/${a.kindergarten.id}`),
      adminA,
    ).send({ name: "Дур мэдэн өөрчилсөн" });

    expect(res.status).toBe(404);

    const row = await db.kindergarten.findUnique({ where: { id: a.kindergarten.id } });
    expect(row?.name).toBe(a.kindergarten.name);
  });
});

describe("POST /platform/kindergartens/:id/admins", () => {
  const adminBody = (overrides: Record<string, unknown> = {}) => ({
    username: uniq("director2"),
    email: null,
    phone: null,
    lastName: "Дорж",
    firstName: "Сүрэн",
    ...overrides,
  });

  /** Maps `b` to institution 42778, whose staff the mocked ESIS returns. */
  async function mapB() {
    await db.kindergarten.update({
      where: { id: b.kindergarten.id },
      data: { esisInstitutionId: INSTITUTION_ID, esisMappedAt: new Date() },
    });
  }

  it("adds a second director to a kindergarten that already exists", async () => {
    const body = adminBody();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/platform/kindergartens/${b.kindergarten.id}/admins`),
      superadmin,
    ).send(body);

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(body.username);
    expect(res.body.invitationToken).toEqual(expect.any(String));
    // Never in the payload, and never set: the invitee chooses their own.
    expect(res.body.user).not.toHaveProperty("passwordHash");

    const membership = await db.membership.findFirst({
      where: { userId: res.body.user.id, kindergartenId: b.kindergarten.id, deletedAt: null },
    });
    expect(membership?.role).toBe("ADMIN");

    const invitation = await db.authToken.findFirst({
      where: { userId: res.body.user.id, purpose: "INVITATION", usedAt: null },
    });
    expect(invitation).not.toBeNull();
  });

  it("rolls the account back when the membership cannot be written", async () => {
    // A kindergarten that does not exist is refused before anything is
    // written; the account must not survive the refusal.
    const body = adminBody();
    const res = await authed(
      request(app.getHttpServer()).post(
        "/v1/platform/kindergartens/00000000-0000-4000-8000-000000000000/admins",
      ),
      superadmin,
    ).send(body);

    expect(res.status).toBe(404);
    expect(await db.user.findUnique({ where: { username: body.username } })).toBeNull();
  });

  it("answers a duplicate username with 409", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(`/v1/platform/kindergartens/${b.kindergarten.id}/admins`),
      superadmin,
    ).send(adminBody({ username: b.adminUser.username }));

    expect(res.status).toBe(409);
  });

  it("refuses a kindergarten admin with 404 — including for their own kindergarten", async () => {
    const body = adminBody();
    const res = await authed(
      request(app.getHttpServer()).post(`/v1/platform/kindergartens/${a.kindergarten.id}/admins`),
      adminA,
    ).send(body);

    expect(res.status).toBe(404);
    expect(await db.user.findUnique({ where: { username: body.username } })).toBeNull();
  });

  it("records who did it", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(`/v1/platform/kindergartens/${b.kindergarten.id}/admins`),
      superadmin,
    ).send(adminBody());

    const rows = await db.auditLog.findMany({
      where: { objectType: "User", objectId: res.body.user.id, action: "CREATE" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kindergartenId).toBe(b.kindergarten.id);
    expect((rows[0]!.metadata as { by?: string }).by).toBe("platform-operator");
  });

  it("shows up on the kindergarten's own detail payload", async () => {
    await authed(
      request(app.getHttpServer()).post(`/v1/platform/kindergartens/${b.kindergarten.id}/admins`),
      superadmin,
    ).send(adminBody({ username: uniq("shown") }));

    const res = await authed(
      request(app.getHttpServer()).get(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    );

    expect(res.status).toBe(200);
    expect(res.body.admins).toHaveLength(2);
    // The figure the operator is really after: has anybody ever signed in.
    expect(res.body.admins.every((row: { lastLoginAt: unknown }) => "lastLoginAt" in row)).toBe(
      true,
    );
  });

  /*
   * ★ The rule the client set on 2026-09-19: "удирдлага нэмэх нь зөвхөн тэр
   * тухайн байгууллага дахь ажилчдаас сонгоно". The three cases below are the
   * whole of it — required when there is a list, verified against that list,
   * and skipped entirely when there is none.
   */
  it("refuses a free-typed name on a kindergarten that is mapped to ESIS", async () => {
    await mapB();
    const body = adminBody();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/platform/kindergartens/${b.kindergarten.id}/admins`),
      superadmin,
    ).send(body);

    expect(res.status).toBe(400);
    expect(await db.user.findUnique({ where: { username: body.username } })).toBeNull();
  });

  it("takes the name from the ministry, not from the body", async () => {
    await mapB();

    const res = await authed(
      request(app.getHttpServer()).post(`/v1/platform/kindergartens/${b.kindergarten.id}/admins`),
      superadmin,
    ).send(
      adminBody({ esisPersonId: directorRow.personId, lastName: "Буруу", firstName: "Бичсэн" }),
    );

    expect(res.status).toBe(201);
    /*
     * The ministry's spelling is what staff self-registration matches a
     * register number against later; two spellings of one person is how that
     * match silently stops working.
     */
    expect(res.body.user.lastName).toBe(directorRow.lastName);
    expect(res.body.user.firstName).toBe(directorRow.firstName);
  });
});

describe("DELETE /platform/kindergartens/:id", () => {
  it("retires the kindergarten and closes every membership in it", async () => {
    const before = await db.membership.count({
      where: { kindergartenId: b.kindergarten.id, deletedAt: null },
    });
    expect(before).toBeGreaterThan(0);

    const res = await authed(
      request(app.getHttpServer()).delete(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    ).send({ confirmName: b.kindergarten.name });

    expect(res.status).toBe(200);
    expect(res.body.closedMemberships).toBe(before);

    const row = await db.kindergarten.findUnique({ where: { id: b.kindergarten.id } });
    // Soft, not hard — §3.2. The row is still there and its children with it.
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.isActive).toBe(false);
    // The mapping is released so the institution can be registered again.
    expect(row?.esisInstitutionId).toBeNull();

    const live = await db.membership.count({
      where: { kindergartenId: b.kindergarten.id, deletedAt: null },
    });
    expect(live).toBe(0);
  });

  it("leaves the children in place", async () => {
    const before = await db.child.count({
      where: { kindergartenId: b.kindergarten.id, deletedAt: null },
    });

    await authed(
      request(app.getHttpServer()).delete(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    ).send({ confirmName: b.kindergarten.name });

    const after = await db.child.count({
      where: { kindergartenId: b.kindergarten.id, deletedAt: null },
    });
    expect(after).toBe(before);
  });

  it("drops it from the operator's list", async () => {
    await authed(
      request(app.getHttpServer()).delete(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    ).send({ confirmName: b.kindergarten.name });

    const res = await authed(
      request(app.getHttpServer()).get("/v1/platform/kindergartens?page=1&pageSize=50"),
      superadmin,
    );

    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { id: string }) => item.id)).not.toContain(b.kindergarten.id);
  });

  it("refuses a name that does not match, and changes nothing", async () => {
    const res = await authed(
      request(app.getHttpServer()).delete(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    ).send({ confirmName: "өөр нэр" });

    expect(res.status).toBe(400);

    const row = await db.kindergarten.findUnique({ where: { id: b.kindergarten.id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("locks the director out afterwards", async () => {
    await authed(
      request(app.getHttpServer()).delete(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    ).send({ confirmName: b.kindergarten.name });

    /*
     * ★ The point of closing the memberships rather than only the tenant row.
     * Roles are re-read from `Membership` on every request (§1.3), so a
     * director whose membership is closed reaches nothing in the tenant —
     * with their existing cookie, without having to sign in again.
     */
    const res = await authed(
      request(app.getHttpServer()).get(`/v1/kindergartens/${b.kindergarten.id}/children`),
      adminB,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a kindergarten admin with 404", async () => {
    const res = await authed(
      request(app.getHttpServer()).delete(`/v1/platform/kindergartens/${a.kindergarten.id}`),
      adminA,
    ).send({ confirmName: a.kindergarten.name });

    expect(res.status).toBe(404);

    const row = await db.kindergarten.findUnique({ where: { id: a.kindergarten.id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("writes one DELETE audit row carrying the prior state", async () => {
    await authed(
      request(app.getHttpServer()).delete(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    ).send({ confirmName: b.kindergarten.name });

    const rows = await db.auditLog.findMany({
      where: { objectType: "Kindergarten", objectId: b.kindergarten.id, action: "DELETE" },
    });

    expect(rows).toHaveLength(1);
    const metadata = rows[0]!.metadata as { before?: { name?: string } };
    expect(metadata.before?.name).toBe(b.kindergarten.name);
  });
});

describe("unauthenticated access", () => {
  it("refuses every platform route with 401", async () => {
    const server = request(app.getHttpServer());
    const id = a.kindergarten.id;

    const responses = await Promise.all([
      server.get("/v1/platform/kindergartens"),
      server.get(`/v1/platform/kindergartens/${id}`),
      request(app.getHttpServer()).patch(`/v1/platform/kindergartens/${id}`).send({ name: "X" }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401]);
  });
});

describe("a platform operator is not an admin of anything", () => {
  it("gets 404 on a child", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/children/${a.child.id}`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("gets 404 on a child's portfolio", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("gets 404 on a child's observations", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("gets 404 on a child's guardians", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/children/${a.child.id}/guardians`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  // Positive control: `children/:id/guardians` has no other 200 assertion in
  // the suite (only a cross-tenant 404 in children.test.ts), so the 404 above
  // would be indistinguishable from a dead route without this. `children/:id`,
  // `portfolio`, `observations`, `dashboard/admin` and `kindergartens` already
  // carry 200 coverage in their own suites (children.test.ts, portfolio.test.ts,
  // observations.test.ts, dashboard.test.ts, tenants.test.ts) — not duplicated
  // here.
  it("an admin, unlike the operator, gets the guardians of their own child", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/children/${a.child.id}/guardians`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(200);
  });

  it("sees an empty list from the membership-scoped kindergarten route", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/kindergartens")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("gets 404 from the admin dashboard", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/dashboard/admin")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });
});

/**
 * The two halves of the duplicate-identifier race, which the endpoint's own
 * pre-check hides from every test above.
 *
 * `PlatformService.assertIdentifiersFree` answers an ordinary duplicate before
 * the transaction opens, so the 409 case earlier in this file never reaches
 * either the `$transaction` rollback or the P2002 branch that catches a
 * collision losing the race between the check and the insert. Left there, both
 * would be untested code on the failure path of the one endpoint that writes
 * four rows at once.
 *
 * Splitting it in two keeps both halves deterministic rather than racing two
 * requests and hoping they interleave:
 *
 *  1. The repository against a real Postgres proves a genuine collision throws
 *     P2002 **and** takes the kindergarten down with it.
 *  2. The endpoint, with the repository made to throw exactly that, proves the
 *     service turns it into 409 rather than 500.
 *
 * The first is what makes the second honest: it establishes that a real
 * collision looks the way the second one pretends it does.
 */
describe("duplicate identifiers losing the race with the pre-check", () => {
  it("rolls the kindergarten back when the director insert collides", async () => {
    const repo = app.get(PlatformRepository);
    const name = `Цэцэрлэг ${uniq()}`;

    // Called directly, because the service's pre-check is precisely what stops
    // an HTTP request from ever reaching the transaction with a taken username.
    const attempt = repo.createWithAdmin({
      kindergarten: { name },
      admin: {
        username: a.adminUser.username, // already taken
        email: null,
        phone: null,
        lastName: "Дорж",
        firstName: "Болд",
        passwordHash: "unused",
        invitationTokenHash: uniq("hash"),
        invitationExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(attempt).rejects.toMatchObject({ code: "P2002" });

    // The kindergarten is inserted first, so this is the assertion that proves
    // the rollback rather than the ordering.
    expect(await db.kindergarten.findFirst({ where: { name } })).toBeNull();
    expect(await db.authToken.findFirst({ where: { userId: a.adminUser.id } })).toBeNull();
  });

  it("answers that collision with 409, not 500", async () => {
    const repo = app.get(PlatformRepository);
    const collision = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const spy = vi.spyOn(repo, "createWithAdmin").mockRejectedValueOnce(collision);

    try {
      const body = createBody();
      const res = await authed(
        request(app.getHttpServer()).post("/v1/platform/kindergartens"),
        superadmin,
      ).send(body);

      expect(res.status).toBe(409);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await db.kindergarten.findFirst({ where: { name: body.name } })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
