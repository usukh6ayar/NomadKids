import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";

/*
 * The portal fee on the А/79 group summary (CLAUDE.md §1.7). Configured
 * before the app is built: `ChildAccessService` reads it once.
 */
process.env.ACCESS_FEE_AMOUNT = "27000.00";

let app: INestApplication;
const db = testDb();
let a: Scenario;
let teacherA: AuthSession;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  a = await createScenario("a");
  teacherA = await login(app, a.teacherUser.username);
});

const summary = () =>
  authed(request(server()).get(`/v1/groups/${a.group.id}/a79-summary`), teacherA);
const server = () => app.getHttpServer();
const childIds = (body: { children: { childId: string }[] }) => body.children.map((c) => c.childId);

describe("the А/79 summary and the portal fee", () => {
  it("a solo teacher's unpaid child is out of the record until the family pays", async () => {
    await db.kindergarten.update({
      where: { id: a.kindergarten.id },
      data: { kind: "SOLO_TEACHER" },
    });

    const unpaid = await summary();
    expect(unpaid.status).toBe(200);
    expect(childIds(unpaid.body)).not.toContain(a.child.id);

    await db.accessSubscription.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        schoolYearId: a.schoolYear.id,
        period: "YEAR",
        amount: "27000.00",
        status: "ACTIVE",
        paidAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    expect(childIds((await summary()).body)).toContain(a.child.id);
  });

  it("a contracted kindergarten's staff are never gated", async () => {
    expect(childIds((await summary()).body)).toContain(a.child.id);
  });
});
