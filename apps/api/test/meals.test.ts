import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * The weekly menu — RFP §989. Kindergarten-wide, not per-child: there is no
 * per-child "did they eat" record here, deliberately (not in the RFP).
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

const server = () => app.getHttpServer();

describe("saving a day", () => {
  it("a teacher saves the menu for a day", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: ["сүү"] }] });

    expect(res.status).toBe(200);

    const row = await db.menuDay.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(row.dishes).toEqual([{ name: "Будаатай шөл", allergenTags: ["сүү"] }]);
    expect(row.createdById).toBe(a.teacherUser.id);
  });

  it("a second PUT for the same day updates rather than duplicates", async () => {
    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Шөл", allergenTags: [] }] });

    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Хуурга", allergenTags: ["самар"] }] });

    const rows = await db.menuDay.findMany({ where: { kindergartenId: a.kindergarten.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dishes).toEqual([{ name: "Хуурга", allergenTags: ["самар"] }]);
  });

  it("a parent cannot save the menu", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      parentA,
    ).send({ dishes: [{ name: "x", allergenTags: [] }] });

    // The coarse @Roles("TEACHER", "ADMIN") gate — 404, never 403.
    expect(res.status).toBe(404);
  });

  it("a teacher saves the day's total calories alongside the dishes", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: [] }], totalCalories: 620 });

    expect(res.status).toBe(200);
    const row = await db.menuDay.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(row.totalCalories).toBe(620);
  });

  it("totalCalories is optional and stays null when omitted", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: [] }] });

    expect(res.status).toBe(200);
    const row = await db.menuDay.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(row.totalCalories).toBeNull();
  });

  it("rejects a negative or implausibly large totalCalories", async () => {
    const negative = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [], totalCalories: -10 });
    expect(negative.status).toBe(400);

    const tooLarge = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [], totalCalories: 50_000 });
    expect(tooLarge.status).toBe(400);
  });
});

describe("reading", () => {
  it("a parent reads their own kindergarten's menu", async () => {
    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: ["сүү"] }] });

    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu?from=2026-03-01&to=2026-03-07`,
      ),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].dishes[0].name).toBe("Будаатай шөл");
  });

  it("a parent reads the day's total calories too", async () => {
    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: [] }], totalCalories: 450 });

    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu?from=2026-03-01&to=2026-03-07`,
      ),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body[0].totalCalories).toBe(450);
  });
});

describe("isolation", () => {
  it("a parent from another kindergarten gets 404 reading the menu", async () => {
    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu?from=2026-03-01&to=2026-03-07`,
      ),
      parentB,
    );
    expect(res.status).toBe(404);
  });

  it("a teacher from another kindergarten gets 404 saving the menu", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      await login(app, b.teacherUser.username),
    ).send({ dishes: [{ name: "x", allergenTags: [] }] });

    expect(res.status).toBe(404);
  });
});
