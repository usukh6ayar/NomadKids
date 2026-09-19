import type { INestApplication } from "@nestjs/common";
import { esisScopedCatalogSchema } from "@kinder/contracts";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { EsisError } from "../src/integrations/esis/esis.client";
import type { EsisService } from "../src/integrations/esis/esis.service";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
  createMembership,
  createScenario,
  createUser,
  enrollChild,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";

const db = testDb();
const institutionId = "40305";
const organizationRow = { institutionId, institutionName: "Цэцэрлэг A" };
const studentRow = {
  institutionId,
  personId: "90000000000001",
  personRegNumber: "УБ99223344",
  lastName: "Баяр",
  firstName: "Ану",
  dateOfBirth: "2021-03-04",
  genderCode: "F",
};
const organization = vi.fn(async () => ({ data: [organizationRow], status: 200, durationMs: 7 }));
const read = vi.fn(async (key: string) => ({
  data: key === "students" ? [studentRow] : [organizationRow],
  status: 200,
  durationMs: 9,
}));
/*
 * ★ `myProfile()` calls `this.esis.teachers(...)` / `this.esis.staff(...)`
 * directly — they are their own methods on `EsisService`, not routed through
 * the generic `read` this file already mocks — so they need mocks of their
 * own. Empty by default; each test that exercises `/esis/my-profile` sets its
 * own `mockResolvedValueOnce`.
 */
const teachers = vi.fn(async () => ({ data: [] as unknown[], status: 200, durationMs: 5 }));
const staff = vi.fn(async () => ({ data: [] as unknown[], status: 200, durationMs: 5 }));
const esis = {
  status: () => ({
    configured: true,
    baseUrl: "https://hubv2.esis.edu.mn",
    institutionId,
    hasToken: true,
  }),
  // `myProfile()` checks `this.esis.isConfigured` directly, not `.status()`.
  isConfigured: true,
  organization,
  read,
  teachers,
  staff,
} as unknown as Partial<EsisService>;

const mapInstitution = (kindergartenId: string, session: AuthSession) =>
  authed(
    request(server()).put(`/v1/platform/kindergartens/${kindergartenId}/esis/mapping`),
    session,
  ).send({ mapped: true, institutionId, environment: "TEST" });

let app: INestApplication;
let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let adminB: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let superAdmin: AuthSession;

const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp({ esis });
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  organization.mockClear();
  read.mockClear();
  teachers.mockClear();
  staff.mockClear();

  a = await createScenario("esis-a");
  b = await createScenario("esis-b");
  const operator = await createUser({ username: uniq("esis-operator"), isSuperAdmin: true });

  [adminA, adminB, teacherA, parentA, superAdmin] = await Promise.all([
    login(app, a.adminUser.username),
    login(app, b.adminUser.username),
    login(app, a.teacherUser.username),
    login(app, a.parentUser.username),
    login(app, operator.username),
  ]);
});

/**
 * The operator's readiness view — `GET /platform/kindergartens/:id/esis`.
 *
 * ★ **It was `GET /kindergartens/:id/esis` and `@Roles("ADMIN")` until
 * 2026-09-14**, when the client asked for the ESIS system screens to sit with
 * the platform operator rather than a kindergarten's director. The facts on it
 * are the deployment's: `ESIS_TOKEN` and `ESIS_BASE_URL` are environment
 * settings, one ESIS developer account serves every tenant, and the institution
 * mapping it reports was already superadmin-only — so a director read blockers
 * that only somebody else could clear.
 *
 * ★★ Through HTTP against the real route, per §4.1. `assertSuperAdmin` inside
 * the service is the decision, but only a request proves the controller asks.
 */
describe("ESIS administration authorization", () => {
  const overviewUrl = (kindergartenId: string) =>
    `/v1/platform/kindergartens/${kindergartenId}/esis`;

  it("lets the platform operator read any tenant's readiness", async () => {
    const [first, second] = await Promise.all([
      authed(request(server()).get(overviewUrl(a.kindergarten.id)), superAdmin),
      authed(request(server()).get(overviewUrl(b.kindergarten.id)), superAdmin),
    ]);

    expect(first.status).toBe(200);
    /*
     * ★ 70 since 2026-09-17, was 67 since 2026-09-15 (which was 40). Task 9 of
     * `2026-09-16-esis-sync-tiers.md` wired three more — `studentAwards`,
     * `studentSearch`, `buildingByRegisterNumber` — and dispositioned rather
     * than wired the other three the task named (`esis.requests.ts`'s
     * `ESIS_DISPOSITIONS`).
     *
     * ★★ **73 since 2026-09-18** — spec №3б wired the three group writes the
     * client asked for: 150, 152 and 162.
     */
    expect(first.body.endpoints).toHaveLength(73);
    // Every kindergarten, because the token and the grants are one account's.
    expect(second.status).toBe(200);
  });

  /*
   * ★ The director is refused with **404**, not 403 — CLAUDE.md §1.7. They
   * administer the kindergarten in the path and still learn nothing about the
   * route, which is what keeps its existence from being an oracle.
   */
  it.each([
    ["kindergarten admin", () => adminA],
    ["teacher", () => teacherA],
    ["guardian", () => parentA],
  ])("refuses a %s before any ESIS data is returned", async (_label, session) => {
    const res = await authed(request(server()).get(overviewUrl(a.kindergarten.id)), session());
    expect(res.status).toBe(404);
  });

  /*
   * ★ The old route is gone rather than left answering. A director's bookmark
   * gets a 404 from the router, not a payload from a controller that kept its
   * `@Roles("ADMIN")`.
   */
  it("no longer serves the tenant-scoped overview route", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/esis`),
      adminA,
    );
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(server()).get(overviewUrl(a.kindergarten.id));
    expect(res.status).toBe(401);
  });

  /*
   * ★ "Хэдэн хүсэлт зөвшөөрөгдсөн, хэдийг ашиглаж байна" — the client's own
   * question, and the reason the register is on this payload and no other. The
   * counts are computed from `esis.requests.ts` joined against the catalog by
   * `apiId`; `esis.requests.test.ts` pins the join itself.
   */
  it("reports the deployment's ESIS grants and how many are in use", async () => {
    const res = await authed(request(server()).get(overviewUrl(a.kindergarten.id)), superAdmin);

    expect(res.status).toBe(200);
    expect(res.body.requests.counts.approved).toBeGreaterThan(0);
    expect(res.body.requests.counts.wired).toBeGreaterThan(0);
    expect(res.body.requests.counts.total).toBe(res.body.requests.items.length);
    // A snapshot read off the portal by hand says when it was read.
    expect(res.body.requests.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("allows only the platform operator to map an institution", async () => {
    const body = { mapped: true, institutionId, environment: "TEST" };
    const denied = await authed(
      request(server()).put(`/v1/platform/kindergartens/${a.kindergarten.id}/esis/mapping`),
      adminA,
    ).send(body);
    const allowed = await authed(
      request(server()).put(`/v1/platform/kindergartens/${a.kindergarten.id}/esis/mapping`),
      superAdmin,
    ).send(body);

    expect(denied.status).toBe(404);
    expect(allowed.status).toBe(200);
    expect(
      (await db.kindergarten.findUniqueOrThrow({ where: { id: a.kindergarten.id } }))
        .esisInstitutionId,
    ).toBe(institutionId);
  });
});

/**
 * The dry run behind "Синк шалгалт".
 *
 * ★ On the platform route since 2026-09-14, with `overview()`. It spends the
 * deployment's token against the ministry's rate limits to prove the connection
 * works — the operator's job. The staff-facing "ESIS-ээс татах" reads are
 * `…/esis/resource` and did not move; the describe below them is unchanged.
 */
describe("read-only preview", () => {
  it("refuses a kindergarten admin, who no longer owns the dry run", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const res = await authed(
      request(server()).post(`/v1/platform/kindergartens/${a.kindergarten.id}/esis/preview`),
      adminA,
    ).send({ resources: ["organization"] });

    expect(res.status).toBe(404);
    expect(organization).not.toHaveBeenCalled();
  });

  it("refuses a preview before the platform mapping exists", async () => {
    const res = await authed(
      request(server()).post(`/v1/platform/kindergartens/${a.kindergarten.id}/esis/preview`),
      superAdmin,
    ).send({ resources: ["organization"] });

    expect(res.status).toBe(409);
    expect(organization).not.toHaveBeenCalled();
  });

  it("returns a safe preview after mapping and writes only run/audit evidence", async () => {
    await authed(
      request(server()).put(`/v1/platform/kindergartens/${a.kindergarten.id}/esis/mapping`),
      superAdmin,
    ).send({ mapped: true, institutionId, environment: "TEST" });

    const beforeChildren = await db.child.count({ where: { kindergartenId: a.kindergarten.id } });
    const res = await authed(
      request(server()).post(`/v1/platform/kindergartens/${a.kindergarten.id}/esis/preview`),
      superAdmin,
    ).send({ resources: ["organization"] });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      dryRun: true,
      status: "SUCCEEDED",
      results: [
        {
          resource: "organization",
          count: 1,
          preview: [expect.objectContaining({ institutionName: "Цэцэрлэг A" })],
        },
      ],
    });
    expect(await db.child.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(
      beforeChildren,
    );
    expect(await db.esisSyncRun.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { kindergartenId: a.kindergarten.id, objectType: "EsisSyncRun" },
      }),
    ).toBe(1);
  });

  it("recovers a stale preview lock before starting a new run", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    const stale = await db.esisSyncRun.create({
      data: {
        kindergartenId: a.kindergarten.id,
        initiatedById: a.adminUser.id,
        resources: ["organization"],
        startedAt: new Date(Date.now() - 16 * 60_000),
      },
    });

    const res = await authed(
      request(server()).post(`/v1/platform/kindergartens/${a.kindergarten.id}/esis/preview`),
      superAdmin,
    ).send({ resources: ["organization"] });

    expect(res.status).toBe(201);
    expect(await db.esisSyncRun.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({
      status: "FAILED",
      errorCode: "STALE_RUN_RECOVERED",
    });
    expect(await db.esisSyncRun.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(2);
  });
});

/**
 * The single-resource read behind every "ESIS-ээс татах" button.
 *
 * ★ It can return a ministry roster of children, so it gets §4.1's three
 * authorization cases through HTTP against the real route — not against
 * `TenantAccessService` in isolation, which would pass even if the controller
 * forgot to call it.
 */
/**
 * The role-scoped catalog — `GET /kindergartens/:id/esis/catalog`.
 *
 * ★ Added 2026-09-09, when the client began placing services on the teacher's
 * screens. The operator's `/esis` stayed `@Roles("ADMIN")`; this is what a
 * working screen's panel reads, and what it must *not* carry is as much the
 * point as what it does — a teacher has no business with the token's state or
 * which kindergarten has been mapped.
 */
describe("role-scoped ESIS catalog", () => {
  const url = (kindergartenId: string) => `/v1/kindergartens/${kindergartenId}/esis/catalog`;

  it("gives an admin every service in the reviewed catalog", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), adminA);

    expect(res.status).toBe(200);
    // ADMIN takes every key, so this moves with the catalogue — 73 since
    // 2026-09-18, when spec №3б added the three group writes.
    expect(res.body.endpoints).toHaveLength(73);
  });

  /*
   * ★ One case per role, because the map is the authorization.
   *
   * `esisServicesForActor` is the whole of who may reach what, and the mistake
   * it invites is a paste: a role's list widened by copying the one above it.
   * Naming each set here makes that a failing test rather than a quiet grant.
   */
  /*
   * ★ Seven since 2026-09-09 — every `cook/*` read, at the client's request.
   * It was one, `foodProducts`. The two `POST cook/form1|form2 …/save`
   * services are the assertion that matters here: a role gets the services its
   * screens draw, and nothing in this product files a school's income return.
   */
  it("gives a cook every cook service, and no write", async () => {
    const cook = await createUser({ username: uniq("esis-cook") });
    await createMembership(cook.id, a.kindergarten.id, "COOK");
    const session = await login(app, cook.username);

    const res = await authed(request(server()).get(url(a.kindergarten.id)), session);

    expect(res.status).toBe(200);
    expect(res.body.endpoints.map((e: { key: string }) => e.key).sort()).toEqual(
      [
        "foodKit",
        "foodKitProducts",
        "foodMaterialGroups",
        "foodMaterials",
        "foodProductMaterials",
        "foodProductTypes",
        "foodProducts",
      ].sort(),
    );
    // Not a roster service among them, and not the accountant's statements.
    expect(res.body.endpoints.every((e: { method: string }) => e.method === "GET")).toBe(true);
  });

  /*
   * ★★ The grant is one-directional. `foodKit` and `foodKitProducts` reached
   * the cook's catalog on 2026-09-09 as the drill-down of a `foodProducts`
   * row; nothing about that widened anybody else's list, and this is what
   * would fail if a later edit pasted the cook's array into the teacher's.
   */
  it("keeps the cook's food services away from a teacher", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), teacherA);

    const keys = res.body.endpoints.map((e: { key: string }) => e.key);
    for (const key of [
      "foodKit",
      "foodKitProducts",
      "foodMaterialGroups",
      "foodMaterials",
      "foodProductMaterials",
      "foodProductTypes",
      "foodProducts",
    ]) {
      expect(keys).not.toContain(key);
    }
  });

  /*
   * ★ Three services since 2026-09-14, and the third is the interesting one.
   *
   * `foodDiscountStudents` names children, where the two income statements are
   * monthly totals — so it is the first entry on the accountant's list that
   * carries people. It is here rather than on the cook's list, which holds
   * every other `cook/*` read: who the state subsidises changes no quantity a
   * cook works with, and it is a fact about a family's circumstances. Least
   * privilege puts it with the role that prices the month.
   */
  it("gives an accountant the income statements and the subsidy list, and no roster", async () => {
    const accountant = await createUser({ username: uniq("esis-accountant") });
    await createMembership(accountant.id, a.kindergarten.id, "ACCOUNTANT");
    const session = await login(app, accountant.username);

    const res = await authed(request(server()).get(url(a.kindergarten.id)), session);

    expect(res.status).toBe(200);
    expect(res.body.endpoints.map((e: { key: string }) => e.key)).toEqual([
      "livelihoodForm1",
      "livelihoodForm2",
      "foodDiscountStudents",
    ]);
  });

  /*
   * ★ Seven until 2026-09-10, sixteen now — and the count is not the point.
   *
   * The nine added that day are the суралцагч services the client placed on a
   * child's own record (registration check, guardians, household, living
   * conditions, and the movement history on Суралцсан түүх), their three
   * writes, and the teacher's own заах аргын нэгдэл on `/settings`. Every one
   * is a service a teacher's screen draws, which is the rule this list has
   * always been: not "what may a teacher see" in the abstract, but "what do
   * their screens ask for".
   *
   * `teacherMovements` is the one deliberately withheld. It answers for the
   * whole institution's appointments and releases — a director's question —
   * and lives on `/admin/users`, so it must not appear here.
   */
  it("gives a teacher the twenty-eight their screens draw, and no others", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), teacherA);

    expect(res.status).toBe(200);
    expect(res.body.endpoints.map((e: { key: string }) => e.key).sort()).toEqual(
      [
        "groupAttendance",
        "groupStudents",
        "saveAttendanceV3",
        "studentByRegister",
        "studentInfo",
        "students",
        "teachers",
        "studentMovements",
        "studentCheck",
        "studentContacts",
        "studentContactsSave",
        "studentStatistics",
        "studentStatisticsSave",
        "studentCondition",
        "studentConditionSave",
        "teacherAcademicOrg",
        /*
         * ★ Added 2026-09-15, and the split is per service rather than per
         * block. A teacher gets the three facts the day depends on — харшил,
         * хориотой хүнс, хөгжлийн бэрхшээл — because a child who must not eat
         * something is classroom information, and `child-health.tsx` already
         * draws those sections for staff. The measurement pair is theirs
         * because a teacher runs the measuring session.
         */
        "studentAllergy",
        "studentAllergySave",
        "studentProhibitedFood",
        "studentProhibitedFoodSave",
        "studentDisability",
        "studentDisabilitySave",
        "studentMeasurements",
        "studentMeasurementSave",
        "groupMeasurements",
        "groupMeasurementsSave",
        "vaccineCatalog",
        "schoolAttendance",
      ].sort(),
    );
    /*
     * ★★ The medical record a teacher does not get. Consultation results,
     * surgical history and vaccine serial numbers are not classroom
     * information, and no screen a teacher opens draws them — so the absence
     * is asserted rather than left to the list above being read carefully.
     */
    const keys = res.body.endpoints.map((e: { key: string }) => e.key);
    for (const withheld of [
      "teacherMovements",
      "studentAssessments",
      "studentAssessmentsSave",
      "studentSurgery",
      "studentSurgerySave",
      "studentIncident",
      "studentIncidentSave",
      "vaccineHistory",
      "vaccinePlan",
      "studentScreening",
      "studentScreeningSave",
      "studentAttachmentSave",
      "workerInfo",
      "teacherProfile",
      "teacherCheck",
    ]) {
      expect({ withheld, present: keys.includes(withheld) }).toEqual({ withheld, present: false });
    }
  });

  /*
   * ★ The deployment is absent, not empty. Widening `/esis`'s role list would
   * have handed every teacher the base URL, the token's state, the blockers and
   * the run history; this asserts the payload never grew those keys back.
   */
  it("tells a teacher nothing about the deployment", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), teacherA);

    expect(Object.keys(res.body).sort()).toEqual(["canRead", "endpoints", "mode"]);
    expect(res.body).not.toHaveProperty("deployment");
    expect(res.body).not.toHaveProperty("connection");
    expect(res.body).not.toHaveProperty("blockers");
    expect(res.body).not.toHaveProperty("recentRuns");

    /*
     * ★★ Nor per-service sync state, which is the same information one row at
     * a time: which run last touched this service, whether it failed and with
     * what code. The overview decorates every endpoint with those; this
     * payload carries the catalog entry and stops.
     */
    for (const key of [
      "accessStatus",
      "responseMode",
      "httpStatus",
      "syncStatus",
      "syncErrorCode",
      "lastSyncAt",
      /*
       * ★★★ And the grant half, since 2026-09-14. "Which ESIS scopes has this
       * deployment been granted, and under what name in the portal" is the
       * operator's question about their own developer account; a teacher's
       * panel draws the services their screens use and needs no opinion on it.
       */
      "grant",
      "portalName",
    ]) {
      expect(res.body.endpoints[0], key).not.toHaveProperty(key);
    }
  });

  /*
   * ★ The contract, parsed — the assertion that would have caught this on the
   * day it shipped.
   *
   * The first version of this payload reused the overview's endpoint shape,
   * which had since grown six sync-state fields it did not send. The browser's
   * `get()` parses every response, so it threw, the panel's query resolved to
   * nothing, and every panel on every teacher screen rendered blank — silently,
   * because a failed parse is not a failed request.
   */
  it("matches the schema the browser parses it with", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), teacherA);

    expect(() => esisScopedCatalogSchema.parse(res.body)).not.toThrow();
  });

  it("returns 404 to a guardian, who reaches no ESIS service at all", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), parentA);

    expect(res.status).toBe(404);
  });

  it("returns 404 to a teacher of another kindergarten", async () => {
    const res = await authed(request(server()).get(url(b.kindergarten.id)), teacherA);

    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(server()).get(url(a.kindergarten.id));
    expect(res.status).toBe(401);
  });
});

describe("single-resource ESIS read", () => {
  const url = (kindergartenId: string, query: string) =>
    `/v1/kindergartens/${kindergartenId}/esis/resource?${query}`;

  /*
   * ★ A teacher reads the services their own screens draw — 2026-09-09.
   *
   * This asserted 404 for every teacher on every service, which was the whole
   * rule until the client began placing panels on the day sheet and the group
   * page. The rule that replaces it is narrower and is the one worth pinning:
   * `esisServicesForActor` decides, and everything outside that list answers
   * 404 rather than 403 — a teacher asking for the food catalog should not
   * learn it exists (CLAUDE.md §1.7).
   */
  it.each([
    ["students", "resource=students"],
    ["studentByRegister", "resource=studentByRegister&personRegNumber=УБ00000000"],
  ])("lets a teacher read %s", async (resource, query) => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    // `Once`: a persistent mock would leak into the assertions below it.
    read.mockResolvedValueOnce({ data: [] });

    const res = await authed(request(server()).get(url(a.kindergarten.id, query)), teacherA);

    expect(res.status).toBe(200);
    expect(res.body.resource).toBe(resource);
  });

  /*
   * ★ `studentByRegister` left this list on 2026-09-09 — the client asked that
   * a teacher be able to search by register number. `read` still keeps the
   * value they typed out of the audit row (`REDACTED_READ_PARAMS`).
   *
   * ★★ **The second half of this comment stopped being true on 2026-09-15.**
   * `personRegNumber` was a refused *output* on every roster service; the
   * client's decision that day ("РД-г тийм") ended that, and nothing yet gates
   * it per caller (`EsisAdminService.visibleRows` is unwired — see the note on
   * `esisVisibleRows` in `esis.schemas.ts`). A teacher reading `students` or
   * `studentByRegister` through this same route now receives every matched
   * child's register number until that gate lands.
   */
  it.each([
    ["organization", "resource=organization"],
    ["foodMaterials", "resource=foodMaterials"],
    ["buildings", "resource=buildings"],
  ])("returns 404 to a teacher for %s, and never calls ESIS", async (_label, query) => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const res = await authed(request(server()).get(url(a.kindergarten.id, query)), teacherA);

    expect(res.status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("returns 404 to a guardian and never calls ESIS", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=students")),
      parentA,
    );

    expect(res.status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("returns 404 to an admin of another kindergarten", async () => {
    await mapInstitution(b.kindergarten.id, superAdmin);

    const res = await authed(
      request(server()).get(url(b.kindergarten.id, "resource=students")),
      adminA,
    );

    expect(res.status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const res = await request(server()).get(url(a.kindergarten.id, "resource=students"));
    expect(res.status).toBe(401);
  });

  it("refuses a resource outside the reviewed catalog", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const [unknown, write] = await Promise.all([
      authed(request(server()).get(url(a.kindergarten.id, "resource=payroll")), adminA),
      authed(request(server()).get(url(a.kindergarten.id, "resource=saveAttendanceV3")), adminA),
    ]);

    expect(unknown.status).toBe(400);
    expect(write.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a service whose path values are missing", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=groupAttendance")),
      adminA,
    );

    expect(res.status).toBe(409);
    expect(res.body.detail).toContain("studentGroupId");
    expect(read).not.toHaveBeenCalled();
  });

  it("returns every ingested field, writes no child row, and records who looked", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    const beforeChildren = await db.child.count({ where: { kindergartenId: a.kindergarten.id } });

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=students")),
      adminA,
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUCCEEDED");
    expect(res.body.count).toBe(1);
    expect(res.body.rows[0]).toMatchObject({ firstName: "Ану", personId: "90000000000001" });
    /*
     * ★ `personRegNumber` flows through — 2026-09-15, "РД-г тийм, нууц үгийг
     * үгүй". It is no longer refused at the parser (`esisStudentSchema` now
     * names it) or at the catalog (`esis.fields.ts`'s `students` entry marks
     * it `keep(…)`), and this is a live value, not a `null` column: the
     * operator screen's column list is built from that same catalog
     * (`rowValues`), so a schema that still dropped the field would show a
     * column claiming ingestion of a value it silently discarded — the exact
     * defect `esis.fields.test.ts`'s "matches the parsing schema key for key"
     * exists to catch.
     *
     * ★★ Who besides an admin may see it is not decided here — nothing gates
     * it per caller yet (`EsisAdminService.visibleRows` is unwired), so this
     * assertion is deliberately about the admin caller this test already uses.
     */
    expect(res.body.rows[0]).toMatchObject({ personRegNumber: "УБ99223344" });
    // Refused fields are described, never valued.
    const refused = res.body.fields.filter((field: { ingested: boolean }) => !field.ingested);
    expect(refused.map((field: { name: string }) => field.name)).toContain("microsoftPassword");
    expect(Object.keys(res.body.rows[0])).not.toContain("microsoftPassword");

    expect(await db.child.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(
      beforeChildren,
    );
    expect(await db.esisSyncRun.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(0);
    expect(
      await db.auditLog.count({
        where: { kindergartenId: a.kindergarten.id, objectType: "EsisResource", action: "VIEW" },
      }),
    ).toBe(1);
  });

  /*
   * ★ The register number is sent and kept nowhere — including the row that
   * says somebody asked.
   *
   * `AuditLog` is append-only (CLAUDE.md §3.2), so a register number written
   * into `metadata` is one this product can never take back, and
   * `ESIS_REQUEST.md` §1.1 (b) is a promise to the ministry that it holds none.
   * The audit row still has to be answerable, so the lookup is recorded and the
   * person is not.
   */
  it("audits a register lookup without recording the register number", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValueOnce({ data: [] });

    const res = await authed(
      request(server()).get(
        url(a.kindergarten.id, "resource=studentByRegister&personRegNumber=УБ99887766"),
      ),
      adminA,
    );

    expect(res.status).toBe(200);

    const rows = await db.auditLog.findMany({
      where: { kindergartenId: a.kindergarten.id, objectType: "EsisResource", action: "VIEW" },
    });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.metadata)).not.toContain("УБ99887766");
    // The lookup itself is still on the record.
    expect(rows[0]!.objectId).toBe("studentByRegister");
  });

  it("reports an upstream failure as a result rather than an error", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockRejectedValueOnce(
      new EsisError("http", "ESIS responded 403", { status: 403, path: "/students/list" }),
    );

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=students")),
      adminA,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "FAILED", errorCode: "SCOPE_DENIED", count: 0 });
    expect(res.body.fields.length).toBeGreaterThan(0);
  });
});

/**
 * Who may read *this child's* ESIS record.
 *
 * ★ **The subject was never checked until 2026-09-15**, and these are the
 * cases CLAUDE.md §4.1 makes mandatory for any route touching child data.
 *
 * `assertReadable` asked two questions — is the caller in this tenant, does
 * their role reach this service — and neither is about the child. Every
 * per-child ESIS service is addressed by a `personId` the caller supplies, and
 * `students` hands the whole roster's ids to any teacher. So a teacher of one
 * group could read another group's харшил or хэмжилт by substituting an id.
 *
 * ★★ Through HTTP against the real route, not by calling `canAccessChild` —
 * §4.1 is explicit that the latter passes even when the endpoint never calls
 * it, which is precisely the defect these cover.
 */
describe("per-child ESIS reads are gated by canAccessChild", () => {
  const resourceUrl = (kindergartenId: string, personId: string) =>
    `/v1/kindergartens/${kindergartenId}/esis/resource` +
    `?resource=studentMeasurements&personId=${personId}`;

  /** The teacher's own child, with the ESIS match already proven. */
  const MINE = "90000000000777";
  /** A child of the same kindergarten, in a group this teacher does not teach. */
  const THEIRS = "90000000000888";

  beforeEach(async () => {
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Бусад бүлэг");
    const otherChild = await createChild(a.kindergarten.id);
    await enrollChild(a.kindergarten.id, otherChild.id, otherGroup.id, a.schoolYear.id);

    await db.child.update({ where: { id: a.child.id }, data: { esisPersonId: MINE } });
    await db.child.update({ where: { id: otherChild.id }, data: { esisPersonId: THEIRS } });
    await mapInstitution(a.kindergarten.id, superAdmin);
  });

  it("lets a teacher read a child in their own group", async () => {
    const res = await authed(request(server()).get(resourceUrl(a.kindergarten.id, MINE)), teacherA);

    expect(res.status).toBe(200);
  });

  /* The case this whole block exists for. */
  it("returns 404 to a teacher for a child in another group", async () => {
    const res = await authed(
      request(server()).get(resourceUrl(a.kindergarten.id, THEIRS)),
      teacherA,
    );

    expect(res.status).toBe(404);
  });

  /*
   * ★ Unproven is refused, not waved through. `esisPersonId` is written only
   * where the product has established the match against the live roster; a
   * child without one cannot be attributed to anybody, and "we do not know
   * whose record this is" is not a reason to show it.
   */
  it("returns 404 to a teacher for a personId no child is mapped to", async () => {
    const res = await authed(
      request(server()).get(resourceUrl(a.kindergarten.id, "90000000000999")),
      teacherA,
    );

    expect(res.status).toBe(404);
  });

  /*
   * ★★ An admin is exempt, and the exemption is not a hole: `isAdminOver`
   * passes for every child of a kindergarten they administer, so the gate could
   * only ever answer yes. Running it anyway would refuse an admin a child whose
   * ESIS id nobody has proven yet — denying access the rule itself grants.
   */
  it("lets an admin read a child whose ESIS id is not mapped", async () => {
    const res = await authed(
      request(server()).get(resourceUrl(a.kindergarten.id, "90000000000999")),
      adminA,
    );

    expect(res.status).toBe(200);
  });

  it("returns 404 to a guardian, who reaches no ESIS service at all", async () => {
    const res = await authed(request(server()).get(resourceUrl(a.kindergarten.id, MINE)), parentA);

    expect(res.status).toBe(404);
  });

  it("returns 404 to a teacher of another kindergarten", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const res = await authed(request(server()).get(resourceUrl(a.kindergarten.id, MINE)), teacherB);

    expect(res.status).toBe(404);
  });

  /*
   * ★ Tier 3 (plan `2026-09-16-esis-sync-tiers.md` Task 6) was already built
   * before this plan started — `EsisAdminService.read` gates on
   * `assertCanReadEsisChild` and writes one `AuditLog` `VIEW` row. This is the
   * case that proves the row is attributable, not merely present: it names
   * who looked (`actorUserId`), what they looked at (`objectId`, the
   * resource), and whose record it was (`metadata.params.personId`) — the
   * three facts a ministry reviewer would ask for about any per-child read.
   */
  it("leaves exactly one AuditLog row naming the actor, the child and the resource", async () => {
    read.mockResolvedValueOnce({ data: [] });

    const res = await authed(request(server()).get(resourceUrl(a.kindergarten.id, MINE)), teacherA);

    expect(res.status).toBe(200);

    const rows = await db.auditLog.findMany({
      where: { kindergartenId: a.kindergarten.id, objectType: "EsisResource", action: "VIEW" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: teacherA.userId,
      objectId: "studentMeasurements",
    });
    expect(rows[0]!.metadata).toMatchObject({
      resource: "studentMeasurements",
      params: { personId: MINE },
    });
  });
});

/*
 * ★ CLAUDE.md §4.1 — through HTTP, against the real route. A unit test on
 * `esisVisibleRows` passes whether or not any controller calls it, which is
 * exactly the failure mode that rule exists to catch.
 */
describe("register numbers by role", () => {
  const url = (kindergartenId: string, query: string) =>
    `/v1/kindergartens/${kindergartenId}/esis/resource?${query}`;

  const REG = "УЛ24270406";
  const CIVIL = "4812345619";
  const rosterRow = {
    personId: "90000000000001",
    firstName: "Ану",
    personRegNumber: REG,
    civilId: CIVIL,
    googleEmailPass: "leaked",
    microsoftEmailPass: "leaked",
    username: "leaked",
  };

  it("shows an admin of this kindergarten the register number", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValueOnce({ data: [rosterRow] });

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=students")),
      adminA,
    );

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(REG);
  });

  it("hides it from a teacher reading the same service", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValueOnce({ data: [rosterRow] });

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=students")),
      teacherA,
    );

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect({ reg: body.includes(REG), civil: body.includes(CIVIL) }).toEqual({
      reg: false,
      civil: false,
    });
    // …and the row is still there, minus the two fields.
    expect(body).toContain("Ану");
  });

  /*
   * ★ `myProfile()` does not call the generic `read` mock — it calls
   * `this.esis.teachers(...)` directly (teacherA holds a TEACHER membership,
   * so `myProfile` picks the `teachers` resource) and matches the returned
   * rows against the signed-in user's own name before rendering one. A row
   * shaped like `rosterRow` above would never match — it carries no
   * `lastName`, and `createUser`'s default identity is "Овог Nэр" — so the
   * match would fail with 0 results and the assertions below would pass
   * vacuously against a conflict error rather than against a stripped row.
   * This row is teacherA's own identity (`createScenario` does not override
   * it), so the match succeeds and there is a real row to strip.
   */
  const teacherProfileRow = {
    personId: "90000000000002",
    lastName: "Овог",
    firstName: "Нэр",
    personRegNumber: REG,
    civilId: CIVIL,
    googleEmailPass: "leaked",
    microsoftEmailPass: "leaked",
    username: "leaked",
  };

  it("hides it from a teacher's own ESIS profile", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    teachers.mockResolvedValueOnce({ data: [teacherProfileRow], status: 200, durationMs: 5 });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/esis/my-profile`),
      teacherA,
    );

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect({ reg: body.includes(REG), civil: body.includes(CIVIL) }).toEqual({
      reg: false,
      civil: false,
    });
  });

  /*
   * ★★ Spec §4.3's "any guardian payload: never" is already covered — see
   * "returns 404 to a guardian and never calls ESIS" earlier in this file. A
   * parent never reaches the route, so there is no body to strip. Confirm that
   * test still passes rather than writing a third.
   */

  /*
   * ★★★ The credential half, asserted on the route that shows the most. If an
   * ADMIN cannot see a provider password, no narrower caller needs checking.
   *
   * ★ Scoped to `res.body.rows`, not the whole response — a change from the
   * literal draft. `res.body.fields` is the catalog's description of every
   * known field, refused ones included (`CREDENTIAL_FIELDS` declares
   * `googleEmailPass`, `microsoftEmailPass` and `username` by name so the
   * operator screen can say *why* a column is empty — see "returns every
   * ingested field…" above, which pins that behaviour deliberately). Checking
   * the whole JSON body would fail on that description string every time,
   * whether or not any *value* leaked, which is not what this test is for.
   */
  it("never shows a provider password, even to an admin", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValueOnce({ data: [rosterRow] });

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=staff")),
      adminA,
    );

    const rows = JSON.stringify(res.body.rows);
    // No leaked value, under any key.
    expect(rows).not.toContain("leaked");
    // And no leaked key either — `username` has no declared field for
    // `staff` (only for `teachers`), so without the gate it would arrive as
    // a *discovered* field and `esisFieldsFor` would mark it `ingested: true`.
    for (const name of ["googleEmailPass", "microsoftEmailPass", "username"]) {
      expect({ name, present: rows.includes(`"${name}"`) }).toEqual({ name, present: false });
    }
  });
});

/*
 * ★ The roster exists so that `POST /v1/staff-registration` — which is public —
 * never has to call ESIS. This is the only route that fills it, and it is
 * ADMIN-only: a refresh spends the deployment's token against the ministry's
 * rate limits.
 */
describe("staff roster refresh", () => {
  const url = (kindergartenId: string) =>
    `/v1/kindergartens/${kindergartenId}/esis/staff-roster/refresh`;

  /*
   * ★ The register number is **lower case here on purpose.**
   *
   * Measured live on 2026-09-16: `school/staff` returns register numbers in
   * lower case — 0 of 13 matched the pattern as sent, 13 of 13 after
   * upper-casing — while `teacher/list` returns the same thirteen people's
   * numbers in upper case. The roster is built from `school/staff` because it
   * is the superset, so this fixture is what the service actually receives.
   */
  const staffRow = {
    personId: "90000000000001",
    personRegNumber: "ул24270406",
    lastName: "Овог",
    firstName: "Нэр",
    jobCode: "2342-13",
    positionName: "Багш, цэцэрлэгийн /мэргэжлийн/ /СӨБ/",
  };

  it("stores the register number normalised, not as the ministry cased it", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValue({ data: [staffRow] });

    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    const stored = await db.esisStaffRoster.findMany({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(stored).toHaveLength(1);
    /*
     * Upper case, though the fixture was lower. Storing it raw would make the
     * registration lookup fail for every member of staff, and the screen would
     * say "you are not on the list" — indistinguishable from the truth.
     */
    expect(stored[0]).toMatchObject({ registerNumber: "УЛ24270406", jobCode: "2342-13" });
  });

  /* A row nobody could ever match is counted and skipped, not stored. */
  it("skips a row whose register number cannot be read", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValue({
      data: [staffRow, { ...staffRow, personId: "90000000000002", personRegNumber: "" }],
    });

    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    expect(res.body).toMatchObject({ count: 1, skipped: 1 });
  });

  /*
   * ★ The two services are not interchangeable, and every test above this one
   * would pass if they were swapped.
   *
   * `read.mockResolvedValue(...)` answers both `read("staff", …)` and
   * `read("teachers", …)` with the same array, so nothing above can tell the
   * two apart. That matters: on institution 42778 `school/staff` returns 13
   * rows and `teacher/list` returns 10, and the three who appear only in the
   * larger list are the two тогооч and the жижүүр. Building the roster from
   * `teacher/list` would silently lock the cooks out of registering — they map
   * to `COOK` through jobCode `5120` and have every right to an account.
   *
   * This mock answers per service, so a transposition fails here.
   */
  it("builds the roster from school/staff, and flags who teacher/list also names", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const cook = {
      ...staffRow,
      personId: "90000000000002",
      personRegNumber: "аб11112222",
      jobCode: "5120-11",
      positionName: "ахлах Тогооч",
    };

    read.mockImplementation(async (resource: string) => ({
      data: resource === "teachers" ? [staffRow] : [staffRow, cook],
    }));

    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    expect(res.body.count).toBe(2);

    const stored = await db.esisStaffRoster.findMany({
      where: { kindergartenId: a.kindergarten.id },
      orderBy: { registerNumber: "asc" },
    });

    /* The cook is on the roster — she is in `school/staff` and not in `teacher/list`. */
    expect(stored.map((row) => row.registerNumber)).toEqual(["АБ11112222", "УЛ24270406"]);
    expect(stored.map((row) => row.isInstructor)).toEqual([false, true]);
  });

  /*
   * ★★ Replace, not merge. Somebody who has left the kindergarten must stop
   * being able to register, and a merge would leave their row behind.
   */
  it("replaces the previous roster rather than merging into it", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    read.mockResolvedValue({ data: [staffRow] });
    await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    read.mockResolvedValue({
      data: [{ ...staffRow, personId: "90000000000002", personRegNumber: "УБ11112222" }],
    });
    await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    const stored = await db.esisStaffRoster.findMany({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(stored.map((row) => row.registerNumber)).toEqual(["УБ11112222"]);
  });

  it("returns 404 to a teacher and stores nothing", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const res = await authed(request(server()).post(url(a.kindergarten.id)), teacherA).send({});

    expect(res.status).toBe(404);
    expect(await db.esisStaffRoster.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(
      0,
    );
  });

  it("returns 404 to an admin of another kindergarten", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminB).send({});

    expect(res.status).toBe(404);
  });
});

/*
 * ★ The code is a **throttle, not authentication** — a secret shared among
 * thirteen people. The roster match is the real gate. It is hashed anyway: a
 * plaintext column is one database read away from registering as anybody.
 */
describe("the kindergarten's registration code", () => {
  const url = (kindergartenId: string) =>
    `/v1/kindergartens/${kindergartenId}/staff-registration-code`;

  it("issues a code to an admin, and stores only its hash", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    expect(res.status).toBe(201);
    expect(typeof res.body.code).toBe("string");
    expect(res.body.code.length).toBeGreaterThanOrEqual(8);

    const row = await db.kindergarten.findUniqueOrThrow({ where: { id: a.kindergarten.id } });
    expect(row.staffRegistrationCodeHash).not.toBeNull();
    expect(row.staffRegistrationCodeHash).not.toContain(res.body.code);
    expect(row.staffRegistrationCodeSetAt).not.toBeNull();
  });

  /* Rotating invalidates the old one — that is the whole point of rotating. */
  it("replaces the previous code", async () => {
    const first = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});
    const second = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    expect(second.body.code).not.toBe(first.body.code);
  });

  it("returns 404 to a teacher", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), teacherA).send({});
    expect(res.status).toBe(404);
  });
});

/**
 * `POST /kindergartens/:id/esis/write` — the immediate write route.
 *
 * ★ It had **no test at all** until 2026-09-18, which is how six services whose
 * field names nothing has ever confirmed stayed reachable by a teacher. The
 * gate below is the product's answer; this is the part that proves it, because
 * a comment saying "unproven" stopped nothing when 162 had the same problem.
 */
describe("POST /kindergartens/:id/esis/write", () => {
  const url = (kindergartenId: string) => `/v1/kindergartens/${kindergartenId}/esis/write`;

  /*
   * ★ Their read halves answered `203` for every child on institution 42778,
   * the portal renders none of them, and the probe cannot reach their
   * validation — so the field lists are inference with nothing behind them.
   * These describe a child's allergies, disability, surgery and safety
   * incidents; a wrong field there is a wrong medical record.
   */
  for (const resource of [
    "studentAllergySave",
    "studentProhibitedFoodSave",
    "studentDisabilitySave",
    "studentSurgerySave",
    "studentIncidentSave",
    "studentScreeningSave",
  ]) {
    it(`refuses ${resource}, whose fields ESIS has never documented`, async () => {
      const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({
        resource,
        payload: { personId: 1 },
      });

      expect(res.status).toBe(409);
    });
  }

  /*
   * ★★ And the three that were corrected are **not** refused — 86, 71 and 101
   * now carry the ministry's own field names rather than this product's
   * inventions, so the gate has to let them past or it is just an outage.
   */
  it("lets a corrected service through the gate", async () => {
    /*
     * ★ The mapping matters: without a confirmed `esisInstitutionId` the route
     * answers 409 for an entirely different reason ("байгууллагын код
     * баталгаажаагүй"), which would make this assertion pass while proving
     * nothing about the gate.
     */
    await testDb().kindergarten.update({
      where: { id: a.kindergarten.id },
      data: { esisInstitutionId: "42778", esisEnvironment: "PRODUCTION", esisMappedAt: new Date() },
    });

    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({
      resource: "studentStatisticsSave",
      payload: { personId: 1, infoFlag9: "N" },
    });

    expect(res.status).not.toBe(409);
  });

  it("returns 404 to an administrator of another kindergarten", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminB).send({
      resource: "studentStatisticsSave",
      payload: { personId: 1 },
    });

    expect(res.status).toBe(404);
  });
});

/**
 * `GET /kindergartens/:id/esis/coverage` — the 84/84 matrix.
 *
 * ★ The artifact that argues for the next institutions: the ministry granted 84
 * services for one month and will ask both "did you use them?" and "did you
 * call anything without a reason?". These two questions pull against each
 * other, and the matrix is the one page that answers both.
 */
describe("GET /kindergartens/:id/esis/coverage", () => {
  const url = (kindergartenId: string) => `/v1/kindergartens/${kindergartenId}/esis/coverage`;

  it("reports one row per approved grant, and no unexplained zero", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), adminA);

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(50);
    /*
       The claim the whole report rests on. A granted service reading zero calls
       must be either wired to a screen or carry a named reason; `UNDECIDED`
       means a grant was left lying around.
    */
    expect(res.body.totals.undecided).toBe(0);
    for (const row of res.body.rows) {
      if (row.calls > 0) continue;
      expect({
        apiId: row.apiId,
        explained: row.serviceKey !== null || row.reason !== null,
      }).toEqual({ apiId: row.apiId, explained: true });
    }
  });

  /*
   * ★★ **It reaches ESIS not at all.** A report that called the ministry to say
   * how often it calls the ministry would add traffic with no purpose a
   * reviewer could name, in the month they are reading the logs.
   */
  it("makes no ESIS call to produce itself", async () => {
    read.mockClear();
    organization.mockClear();
    staff.mockClear();

    await authed(request(server()).get(url(a.kindergarten.id)), adminA);

    expect(read).not.toHaveBeenCalled();
    expect(organization).not.toHaveBeenCalled();
    expect(staff).not.toHaveBeenCalled();
  });

  it("counts a sync run's resources, not just the run", async () => {
    await db.esisSyncRun.create({
      data: {
        kindergartenId: a.kindergarten.id,
        initiatedById: a.adminUser.id,
        status: "SUCCEEDED",
        resources: ["buildings", "rooms"],
      },
    });

    const res = await authed(request(server()).get(url(a.kindergarten.id)), adminA);
    const buildings = res.body.rows.find(
      (row: { serviceKey: string | null }) => row.serviceKey === "buildings",
    );

    expect(buildings.calls).toBeGreaterThan(0);
    expect(buildings.state).toBe("IN_USE");
  });

  /*
   * ★ One kindergarten's matrix is what its director hands the ministry about
   * their own institution. Another tenant's traffic must not appear on it.
   */
  it("counts only this kindergarten's calls", async () => {
    await db.esisSyncRun.create({
      data: {
        kindergartenId: b.kindergarten.id,
        initiatedById: b.adminUser.id,
        status: "SUCCEEDED",
        resources: ["subjectAreas"],
      },
    });

    const res = await authed(request(server()).get(url(a.kindergarten.id)), adminA);
    const subjectAreas = res.body.rows.find(
      (row: { serviceKey: string | null }) => row.serviceKey === "subjectAreas",
    );

    expect(subjectAreas.calls).toBe(0);
  });

  it("returns 404 to an administrator of another kindergarten", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), adminB);
    expect(res.status).toBe(404);
  });

  it("returns 404 to a teacher of this kindergarten", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), teacherA);
    expect(res.status).toBe(404);
  });

  it("serves the same matrix as a spreadsheet", async () => {
    /*
       ★ `.buffer()` alone is not enough — supertest still runs its default
       text parser over a binary body and `res.body` comes back as something
       with no `slice`. The explicit binary parser is what makes the assertion
       about a real xlsx rather than about a mangled string.
    */
    const res = await authed(request(server()).get(`${url(a.kindergarten.id)}/export`), adminA)
      .buffer()
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("esis-coverage-");
    // "PK" — a real zip, which is what an xlsx is.
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });
});
