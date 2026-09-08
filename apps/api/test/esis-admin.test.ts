import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { EsisError } from "../src/integrations/esis/esis.client";
import type { EsisService } from "../src/integrations/esis/esis.service";
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
    expect(own.body.endpoints).toHaveLength(17);
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
describe("single-resource ESIS read", () => {
  const url = (kindergartenId: string, query: string) =>
    `/v1/kindergartens/${kindergartenId}/esis/resource?${query}`;

  it.each([
    ["teacher", () => teacherA],
    ["guardian", () => parentA],
  ])("returns 404 to a %s and never calls ESIS", async (_label, session) => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=students")),
      session(),
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
