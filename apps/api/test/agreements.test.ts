import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_AGREEMENT_VERSIONS } from "@kinder/contracts";
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
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * User agreements accepted on first sign-in (#211). What is pinned: the server
 * accepts only the current version of a kind that is the person's own, a
 * second acceptance is the first one, and only a platform operator reads
 * everybody's.
 */

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();

let a: Scenario;
let teacher: AuthSession;
let parent: AuthSession;
let admin: AuthSession;

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  a = await createScenario("a");
  teacher = await login(app, a.teacherUser.username);
  parent = await login(app, a.parentUser.username);
  admin = await login(app, a.adminUser.username);
});

const accept = (who: AuthSession, kind: string, version: string) =>
  authed(request(server()).post("/v1/me/agreements"), who).send({ kind, version });

describe("/me/agreements", () => {
  it("records the current version and returns it on the next read", async () => {
    const before = await request(server()).get("/v1/me/agreements").set("Cookie", teacher.cookies);
    const res = await accept(teacher, "TEACHER", CURRENT_AGREEMENT_VERSIONS.TEACHER);
    const after = await request(server()).get("/v1/me/agreements").set("Cookie", teacher.cookies);

    expect(before.body).toEqual({ accepted: [] });
    expect(res.status).toBe(201);
    expect(after.body.accepted).toEqual([
      {
        kind: "TEACHER",
        version: CURRENT_AGREEMENT_VERSIONS.TEACHER,
        acceptedAt: expect.any(String),
      },
    ]);
  });

  it("a second acceptance is the first one — same moment, one row, one audit entry", async () => {
    const first = await accept(parent, "PARENT", CURRENT_AGREEMENT_VERSIONS.PARENT);
    const second = await accept(parent, "PARENT", CURRENT_AGREEMENT_VERSIONS.PARENT);

    expect(second.body.acceptedAt).toBe(first.body.acceptedAt);
    expect(await db.agreementAcceptance.count({ where: { userId: a.parentUser.id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { objectType: "AgreementAcceptance", action: "CREATE" } }),
    ).toBe(1);
  });

  it("refuses a version nobody is shown, and a kind that is not the person's", async () => {
    const stale = await accept(teacher, "TEACHER", "trial-2020-01-01");
    const notAParent = await accept(teacher, "PARENT", CURRENT_AGREEMENT_VERSIONS.PARENT);

    expect([stale.status, notAParent.status]).toEqual([400, 400]);
    expect(await db.agreementAcceptance.count()).toBe(0);
  });

  it("is each person's own: one never sees another's", async () => {
    await accept(teacher, "TEACHER", CURRENT_AGREEMENT_VERSIONS.TEACHER);

    const res = await request(server()).get("/v1/me/agreements").set("Cookie", parent.cookies);

    expect(res.body).toEqual({ accepted: [] });
  });

  it("requires signing in", async () => {
    const res = await request(server()).get("/v1/me/agreements");

    expect(res.status).toBe(401);
  });
});

describe("GET /platform/agreements", () => {
  it("lists who accepted which version, for the platform operator", async () => {
    await accept(teacher, "TEACHER", CURRENT_AGREEMENT_VERSIONS.TEACHER);
    await accept(parent, "PARENT", CURRENT_AGREEMENT_VERSIONS.PARENT);
    const operator = await createUser({ username: uniq("super"), isSuperAdmin: true });
    const session = await login(app, operator.username);

    const all = await request(server())
      .get("/v1/platform/agreements")
      .set("Cookie", session.cookies);
    const teachers = await request(server())
      .get("/v1/platform/agreements")
      .query({ kind: "TEACHER" })
      .set("Cookie", session.cookies);

    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(teachers.body.items).toHaveLength(1);
    expect(teachers.body.items[0].user.id).toBe(a.teacherUser.id);
  });

  it("is 404 to a kindergarten's director", async () => {
    const res = await request(server()).get("/v1/platform/agreements").set("Cookie", admin.cookies);

    expect(res.status).toBe(404);
  });
});
