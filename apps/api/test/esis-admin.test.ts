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
  createMembership,
  createScenario,
  createUser,
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
const esis = {
  status: () => ({
    configured: true,
    baseUrl: "https://hubv2.esis.edu.mn",
    institutionId,
    hasToken: true,
  }),
  organization,
  read,
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

  a = await createScenario("esis-a");
  b = await createScenario("esis-b");
  const operator = await createUser({ username: uniq("esis-operator"), isSuperAdmin: true });

  [adminA, teacherA, parentA, superAdmin] = await Promise.all([
    login(app, a.adminUser.username),
    login(app, a.teacherUser.username),
    login(app, a.parentUser.username),
    login(app, operator.username),
  ]);
});

describe("ESIS administration authorization", () => {
  it("lets a kindergarten admin read only their own readiness", async () => {
    const own = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/esis`),
      adminA,
    );
    const other = await authed(
      request(server()).get(`/v1/kindergartens/${b.kindergarten.id}/esis`),
      adminA,
    );

    expect(own.status).toBe(200);
    expect(own.body.endpoints).toHaveLength(22);
    expect(other.status).toBe(404);
  });

  it.each([
    ["teacher", () => teacherA],
    ["guardian", () => parentA],
  ])("refuses a %s before any ESIS data is returned", async (_label, session) => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/esis`),
      session(),
    );
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/esis`);
    expect(res.status).toBe(401);
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

describe("read-only preview", () => {
  it("refuses a preview before the platform mapping exists", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/esis/preview`),
      adminA,
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
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/esis/preview`),
      adminA,
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
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/esis/preview`),
      adminA,
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
    expect(res.body.endpoints).toHaveLength(22);
  });

  /*
   * ★ One case per role, because the map is the authorization.
   *
   * `esisServicesForActor` is the whole of who may reach what, and the mistake
   * it invites is a paste: a role's list widened by copying the one above it.
   * Naming each set here makes that a failing test rather than a quiet grant.
   */
  it("gives a cook the one their screens draw", async () => {
    const cook = await createUser({ username: uniq("esis-cook") });
    await createMembership(cook.id, a.kindergarten.id, "COOK");
    const session = await login(app, cook.username);

    const res = await authed(request(server()).get(url(a.kindergarten.id)), session);

    expect(res.status).toBe(200);
    expect(res.body.endpoints.map((e: { key: string }) => e.key)).toEqual(["foodProducts"]);
  });

  it("gives an accountant the two income statements, and no roster", async () => {
    const accountant = await createUser({ username: uniq("esis-accountant") });
    await createMembership(accountant.id, a.kindergarten.id, "ACCOUNTANT");
    const session = await login(app, accountant.username);

    const res = await authed(request(server()).get(url(a.kindergarten.id)), session);

    expect(res.status).toBe(200);
    expect(res.body.endpoints.map((e: { key: string }) => e.key)).toEqual([
      "livelihoodForm1",
      "livelihoodForm2",
    ]);
  });

  it("gives a teacher the seven their screens draw, and no others", async () => {
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
      ].sort(),
    );
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
   * a teacher be able to search by register number. It is a service they may
   * *use*, not a number they may read: `personRegNumber` is a refused output
   * on it as on every roster service, and `read` keeps the value they typed
   * out of the audit row.
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
    // Refused fields are described, never valued.
    const refused = res.body.fields.filter((field: { ingested: boolean }) => !field.ingested);
    expect(refused.map((field: { name: string }) => field.name)).toContain("personRegNumber");
    expect(Object.keys(res.body.rows[0])).not.toContain("personRegNumber");

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
