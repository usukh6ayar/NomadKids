import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
  createScenario,
  createUser,
  enrollChild,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * `GET /platform/kindergartens/:id/access-fees` — the families' portal fee in
 * one kindergarten, counts only (backend list №4, 2026-10-20 the user).
 */

// The gate on, and no free period running.
process.env.ACCESS_FEE_AMOUNT = "22000.00";
delete process.env.ACCESS_FEE_FREE_UNTIL;

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let operator: AuthSession;

const server = () => app.getHttpServer();
const fees = (actor: AuthSession, id: string) =>
  authed(request(server()).get(`/v1/platform/kindergartens/${id}/access-fees`), actor);

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
  b = await createScenario("b");
  const op = await createUser({ username: uniq("operator"), isSuperAdmin: true });
  operator = await login(app, op.username);
});

/** A year's subscription for `childId` — paid and running unless `paid` is false. */
async function subscribe(childId: string, opts: { paid?: boolean; expiresAt?: Date } = {}) {
  const paid = opts.paid ?? true;
  return db.accessSubscription.create({
    data: {
      kindergartenId: a.kindergarten.id,
      childId,
      schoolYearId: a.schoolYear.id,
      amount: "22000.00",
      status: paid ? "ACTIVE" : "UNPAID",
      paidAt: paid ? new Date() : null,
      expiresAt: opts.expiresAt ?? new Date("2099-05-31"),
    } as never,
  });
}

describe("who may look", () => {
  it("answers 404 to the kindergarten's admin, a teacher and a parent", async () => {
    for (const user of [a.adminUser, a.teacherUser, a.parentUser]) {
      const session = await login(app, user.username);
      expect((await fees(session, a.kindergarten.id)).status).toBe(404);
    }
  });

  it("answers 404 for a kindergarten that does not exist", async () => {
    expect((await fees(operator, randomUUID())).status).toBe(404);
  });
});

describe("the figures", () => {
  it("counts paid and unpaid by group over this year's enrolments, and the sum paid", async () => {
    // Group A: the scenario's child, paid; a second child, unpaid.
    await subscribe(a.child.id);
    const unpaid = await createChild(a.kindergarten.id, { firstName: "Төлөөгүй" });
    await enrollChild(a.kindergarten.id, unpaid.id, a.group.id, a.schoolYear.id);
    await subscribe(unpaid.id, { paid: false });
    // A second group: one child whose paid year has run out — unpaid now,
    // but the money still counts.
    const group2 = await createGroup(a.kindergarten.id, a.schoolYear.id, "Б бүлэг");
    const lapsed = await createChild(a.kindergarten.id);
    await enrollChild(a.kindergarten.id, lapsed.id, group2.id, a.schoolYear.id);
    await subscribe(lapsed.id, { expiresAt: new Date("2020-05-31") });
    // Left during the year — neither paid nor unpaid.
    const left = await createChild(a.kindergarten.id);
    await enrollChild(a.kindergarten.id, left.id, a.group.id, a.schoolYear.id, "ENDED");
    // Another kindergarten's paid child is not counted here.
    await db.accessSubscription.create({
      data: {
        kindergartenId: b.kindergarten.id,
        childId: b.child.id,
        schoolYearId: b.schoolYear.id,
        amount: "22000.00",
        status: "ACTIVE",
        paidAt: new Date(),
        expiresAt: new Date("2099-05-31"),
      } as never,
    });

    const res = await fees(operator, a.kindergarten.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      required: true,
      schoolYear: a.schoolYear.name,
      paid: 1,
      unpaid: 2,
      amount: 44000,
    });
    const byId = new Map(
      (res.body.groups as { id: string; paid: number; children: number }[]).map((g) => [g.id, g]),
    );
    expect(byId.get(a.group.id)).toMatchObject({ paid: 1, children: 2 });
    expect(byId.get(group2.id)).toMatchObject({ name: "Б бүлэг", paid: 0, children: 1 });
  });

  it("never carries a child", async () => {
    await subscribe(a.child.id);

    const body = JSON.stringify((await fees(operator, a.kindergarten.id)).body);

    expect(body).not.toContain(a.child.id);
    expect(body).not.toContain(a.child.firstName);
  });
});
