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
type Row = { childId: string; feeDue: boolean; total: number; byDomain: unknown[] };
const rowOf = (body: { children: Row[] }, childId: string) =>
  body.children.find((c) => c.childId === childId);

describe("the А/79 summary and the portal fee", () => {
  /*
   * ★ Named, with every figure withheld — 2026-10-17. The child used to be
   * left out, and a solo teacher whose families had not paid yet read
   * «Бүлэгт хүүхэд алга» on a group full of children.
   */
  it("a solo teacher's unpaid child is listed as fee-due, with no figures, until the family pays", async () => {
    await db.kindergarten.update({
      where: { id: a.kindergarten.id },
      data: { kind: "SOLO_TEACHER" },
    });

    const unpaid = await summary();
    expect(unpaid.status).toBe(200);
    expect(rowOf(unpaid.body, a.child.id)).toMatchObject({ feeDue: true, total: 0, byDomain: [] });

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
    const paid = rowOf((await summary()).body, a.child.id);
    expect(paid?.feeDue).toBe(false);
    expect(paid?.total).toBeGreaterThan(0);
  });

  it("a contracted kindergarten's staff are never gated", async () => {
    expect(rowOf((await summary()).body, a.child.id)).toMatchObject({ feeDue: false });
  });
});
