import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createChild,
  createScenario,
  enrollChild,
  login,
  setUpSoloWorkspace,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * D2 — in a solo teacher's workspace a child is inactive until the family pays
 * (the user, 2026-10-11).
 *
 * What is pinned: the teacher meets 402 on everything they would do for an
 * unpaid child, but may still invite the family and sees «UNPAID» on the
 * roster; once paid, everything opens; a contracted kindergarten's teacher is
 * never gated; a stranger still gets 404, before any fee question.
 */

// ★ The gate is off in the rest of the suite; this file turns it on before the
// app is built — `ChildAccessService` reads the price once, at construction.
process.env.ACCESS_FEE_AMOUNT = "27000.00";

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();
const PASSWORD = "Shine-Nuuts99";

let solo: { session: AuthSession; kindergartenId: string; childId: string };
let contracted: Scenario;
let contractedTeacher: AuthSession;

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  const signup = await request(server()).post("/v1/teacher-applications").send({
    lastName: "Дорж",
    firstName: "Сараа",
    password: PASSWORD,
    phone: "99112233",
    email: "saraa@example.mn",
  });
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);

  const kindergarten = await db.kindergarten.findFirstOrThrow({
    where: { kind: "SOLO_TEACHER" },
  });
  const { schoolYear, group } = await setUpSoloWorkspace(kindergarten.id);
  const child = await createChild(kindergarten.id, { firstName: "Тэмүүлэн" });
  await enrollChild(kindergarten.id, child.id, group.id, schoolYear.id);

  solo = {
    session: await login(app, "99112233", PASSWORD),
    kindergartenId: kindergarten.id,
    childId: child.id,
  };
  contracted = await createScenario("c");
  contractedTeacher = await login(app, contracted.teacherUser.username);
});

async function pay(kindergartenId: string, childId: string) {
  const year = await db.schoolYear.findFirstOrThrow({ where: { kindergartenId } });
  await db.accessSubscription.create({
    data: {
      kindergartenId,
      childId,
      schoolYearId: year.id,
      amount: "27000.00",
      status: "ACTIVE",
      paidAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

const get = (session: AuthSession, url: string) => authed(request(server()).get(url), session);

describe("an unpaid child in a solo workspace", () => {
  it("is 402 for the teacher — reading and writing — with a sentence about the family", async () => {
    const read = await get(solo.session, `/v1/children/${solo.childId}`);
    expect(read.status).toBe(402);
    expect(read.body.detail).toContain("эцэг эх");

    const write = await authed(
      request(server()).patch(`/v1/children/${solo.childId}`),
      solo.session,
    ).send({ firstName: "Тэмүүжин" });
    expect(write.status).toBe(402);
  });

  it("can still have its family invited", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${solo.childId}/guardian-invitations`),
      solo.session,
    ).send({ isPrimary: true });
    expect(res.status).toBe(201);
  });

  it("shows on the roster as unpaid", async () => {
    const res = await get(solo.session, "/v1/children");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ id: solo.childId, portalFee: "UNPAID" }),
    ]);
  });

  it("is still 404, not 402, to a stranger", async () => {
    expect((await get(contractedTeacher, `/v1/children/${solo.childId}`)).status).toBe(404);
  });
});

describe("once the family pays", () => {
  it("opens everything, and the roster says so", async () => {
    await pay(solo.kindergartenId, solo.childId);

    expect((await get(solo.session, `/v1/children/${solo.childId}`)).status).toBe(200);
    const roster = await get(solo.session, "/v1/children");
    expect(roster.body.items[0]).toMatchObject({ id: solo.childId, portalFee: "PAID" });
  });
});

describe("a contracted kindergarten", () => {
  it("never gates its teacher, and shows no fee badge", async () => {
    expect((await get(contractedTeacher, `/v1/children/${contracted.child.id}`)).status).toBe(200);
    const roster = await get(contractedTeacher, "/v1/children");
    expect(roster.body.items[0]).toMatchObject({ id: contracted.child.id, portalFee: null });
  });
});
