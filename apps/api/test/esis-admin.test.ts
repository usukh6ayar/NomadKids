import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
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
const organization = vi.fn(async () => ({
  data: [{ institutionId, institutionName: "Цэцэрлэг A" }],
  status: 200,
  durationMs: 7,
}));
const esis = {
  status: () => ({
    configured: true,
    baseUrl: "https://hubv2.esis.edu.mn",
    institutionId,
    hasToken: true,
  }),
  organization,
} as Partial<EsisService>;

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
          preview: [{ label: "Цэцэрлэг A" }],
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
    await authed(
      request(server()).put(`/v1/platform/kindergartens/${a.kindergarten.id}/esis/mapping`),
      superAdmin,
    ).send({ mapped: true, institutionId, environment: "TEST" });
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
