import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
  createScenario,
  enrollChild,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * The meal register — `нэмэлт.md` §2. A different resource from the menu, which
 * `meals.test.ts` covers.
 *
 * ★ The distinction these tests exist to protect: `MenuDay` is what the kitchen
 * planned to cook, kindergarten-wide; `MealRecord` is what one child actually
 * ate at one sitting. §3 computes the food cost from **хооллосон өдөр** — days
 * eaten, not days attended — so a child collected before lunch attended and did
 * not eat, and nothing here may be inferred from `Attendance`.
 *
 * ★★ Written because there were none. The routes shipped with the finance
 * foundation and every rule below — the group-assignment check, the dropped
 * stale row, the future-date guard, the soft-delete path the partial unique
 * index forces — was reachable only by hand.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let adminA: AuthSession;
let parentA: AuthSession;
let teacherB: AuthSession;

/** Comfortably in the past, so the future-date guard is never the reason. */
const DATE = "2026-02-10";

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
  adminA = await login(app, a.adminUser.username);
  parentA = await login(app, a.parentUser.username);
  teacherB = await login(app, b.teacherUser.username);
});

const server = () => app.getHttpServer();

const sheetUrl = (groupId: string, date = DATE, kind = "LUNCH") =>
  `/v1/groups/${groupId}/meals?date=${date}&kind=${kind}`;

// ═══════════════════════════════════════════════════════════════════════════
// Reading the day sheet
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /groups/:id/meals", () => {
  it("an assigned teacher reads the sitting", async () => {
    const res = await authed(request(server()).get(sheetUrl(a.group.id)), teacherA);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].child.id).toBe(a.child.id);
    expect(res.body[0].enrollmentId).toBe(a.enrollment.id);
  });

  it("an admin of the kindergarten reads it without being assigned", async () => {
    // `createScenario` assigns the teacher, never the admin — an admin reaches
    // every group in their kindergarten through the role, not an assignment.
    const res = await authed(request(server()).get(sheetUrl(a.group.id)), adminA);
    expect(res.status).toBe(200);
  });

  /**
   * ★ The whole point of a register: a child nobody has marked appears, marked
   * as nothing. Returning only the rows that exist would leave the teacher with
   * no way to see who is still missing.
   */
  it("returns every active enrolled child, unmarked ones with `record: null`", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёрдугаар" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    await authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA).send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "TAKEN" }],
    });

    const res = await authed(request(server()).get(sheetUrl(a.group.id)), teacherA);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const marked = res.body.find((r: { child: { id: string } }) => r.child.id === a.child.id);
    const unmarked = res.body.find((r: { child: { id: string } }) => r.child.id === second.id);
    expect(marked.record.status).toBe("TAKEN");
    expect(unmarked.record).toBeNull();
  });

  /** Each sitting is its own sheet — lunch marked does not show under breakfast. */
  it("separates the sittings", async () => {
    await authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA).send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "TAKEN" }],
    });

    const breakfast = await authed(
      request(server()).get(sheetUrl(a.group.id, DATE, "BREAKFAST")),
      teacherA,
    );
    expect(breakfast.body[0].record).toBeNull();
  });

  /**
   * ★ `kind` is required, and the UI must never fire the query without it.
   * `attendance-today.tsx` documents the sibling failure — a query that runs
   * before its parameter exists and 404s before it can succeed.
   */
  it("requires both `date` and `kind`", async () => {
    const noKind = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/meals?date=${DATE}`),
      teacherA,
    );
    const noDate = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/meals?kind=LUNCH`),
      teacherA,
    );
    const badKind = await authed(
      request(server()).get(sheetUrl(a.group.id, DATE, "SUPPER")),
      teacherA,
    );

    expect([noKind.status, noDate.status, badKind.status]).toEqual([400, 400, 400]);
  });

  it("rejects a malformed date", async () => {
    const res = await authed(request(server()).get(sheetUrl(a.group.id, "10-02-2026")), teacherA);
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recording a sitting
// ═══════════════════════════════════════════════════════════════════════════

describe("PUT /groups/:id/meals", () => {
  it("an assigned teacher records a whole sitting in one request", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёрдугаар" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: DATE,
      kind: "LUNCH",
      entries: [
        { childId: a.child.id, status: "TAKEN" },
        { childId: second.id, status: "NOT_TAKEN", note: "Гэрээсээ хоолтой ирсэн." },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const rows = await db.mealRecord.findMany({
      where: { date: new Date(`${DATE}T00:00:00.000Z`) },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "LUNCH")).toBe(true);
    expect(rows.every((r) => r.recordedById === a.teacherUser.id)).toBe(true);
    expect(rows.find((r) => r.childId === second.id)?.note).toBe("Гэрээсээ хоолтой ирсэн.");
  });

  it("an admin can record", async () => {
    const res = await authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), adminA).send({
      date: DATE,
      kind: "BREAKFAST",
      entries: [{ childId: a.child.id, status: "TAKEN" }],
    });

    expect(res.status).toBe(200);
  });

  /**
   * ★ A second save updates in place — there is no DELETE and no "unrecord",
   * so changing a mark is the only correction the product offers.
   */
  it("a second save for the same sitting updates rather than duplicating", async () => {
    const put = () => authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA);

    await put().send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "TAKEN" }],
    });
    await put().send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "PARTIAL", note: "Хагасыг идсэн." }],
    });

    const rows = await db.mealRecord.findMany({ where: { childId: a.child.id, kind: "LUNCH" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("PARTIAL");
    expect(rows[0]!.note).toBe("Хагасыг идсэн.");
  });

  it("accepts every status the enum defines", async () => {
    const children = await Promise.all(
      ["TAKEN", "NOT_TAKEN", "PARTIAL", "SPECIAL"].map(async (_, i) => {
        const child = await createChild(a.kindergarten.id, { firstName: `Хүүхэд${i}` });
        await enrollChild(a.kindergarten.id, child.id, a.group.id, a.schoolYear.id);
        return child;
      }),
    );

    const statuses = ["TAKEN", "NOT_TAKEN", "PARTIAL", "SPECIAL"];
    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: DATE,
      kind: "LUNCH",
      entries: children.map((child, i) => ({ childId: child.id, status: statuses[i] })),
    });

    expect(res.status).toBe(200);
    expect(res.body.map((r: { status: string }) => r.status).sort()).toEqual([...statuses].sort());
  });

  it("rejects a status outside the enum", async () => {
    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "MAYBE" }],
    });

    expect(res.status).toBe(400);
  });

  it("rejects a future date", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: tomorrow,
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "TAKEN" }],
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/ирээдүйд/);
  });

  it("rejects a note longer than 500 characters", async () => {
    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "SPECIAL", note: "a".repeat(501) }],
    });

    expect(res.status).toBe(400);
  });

  it("rejects an empty batch", async () => {
    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: DATE,
      kind: "LUNCH",
      entries: [],
    });

    expect(res.status).toBe(400);
  });

  /**
   * ★ A stale roster row is dropped, not an error.
   *
   * Between the sheet loading and the teacher pressing save, a child may have
   * transferred. Failing the whole batch would lose the marks that are correct;
   * writing the row anyway would attribute the meal to the wrong group's
   * register, which §3 then bills to the wrong kindergarten.
   */
  it("ignores a child who is not enrolled in this group, and saves the rest", async () => {
    const elsewhere = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    const moved = await createChild(a.kindergarten.id, { firstName: "Шилжсэн" });
    await enrollChild(a.kindergarten.id, moved.id, elsewhere.id, a.schoolYear.id);

    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: DATE,
      kind: "LUNCH",
      entries: [
        { childId: a.child.id, status: "TAKEN" },
        { childId: moved.id, status: "TAKEN" },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].childId).toBe(a.child.id);

    // Nothing was written for the transferred child, in either group.
    expect(await db.mealRecord.count({ where: { childId: moved.id } })).toBe(0);
  });

  it("400s when every entry is dropped", async () => {
    const stranger = await createChild(b.kindergarten.id, { firstName: "Танихгүй" });

    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: stranger.id, status: "TAKEN" }],
    });

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/олдсонгүй/);
  });

  /**
   * ★★ The reason the repository hand-rolls find-then-write instead of calling
   * Prisma's `upsert()`.
   *
   * The unique index is **partial** — `WHERE "deletedAt" IS NULL` — so a
   * soft-deleted row leaves its sitting free. `upsert()` matches on the plain
   * key and cannot see that, so it would resurrect the deleted row or fail on
   * the constraint. Nothing in the API soft-deletes a meal record, which is why
   * this state has to be built directly here.
   */
  it("treats a soft-deleted row as absent: the sheet hides it and a save creates a new one", async () => {
    await authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA).send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "TAKEN" }],
    });

    const original = await db.mealRecord.findFirstOrThrow({ where: { childId: a.child.id } });
    await db.mealRecord.update({
      where: { id: original.id },
      data: { deletedAt: new Date() },
    });

    // The sheet no longer shows it…
    const sheet = await authed(request(server()).get(sheetUrl(a.group.id)), teacherA);
    expect(sheet.body[0].record).toBeNull();

    // …and recording again succeeds, as a second row rather than a constraint
    // violation or a resurrection of the deleted one.
    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "PARTIAL" }],
    });

    expect(res.status).toBe(200);
    expect(res.body[0].id).not.toBe(original.id);

    const live = await db.mealRecord.findMany({
      where: { childId: a.child.id, kind: "LUNCH", deletedAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0]!.status).toBe("PARTIAL");
  });

  /** §14 asks for a financial audit trail, and this feeds the food cost. */
  it("writes one audit row per sitting, not one per child", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёрдугаар" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    await authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA).send({
      date: DATE,
      kind: "LUNCH",
      entries: [
        { childId: a.child.id, status: "TAKEN" },
        { childId: second.id, status: "TAKEN" },
      ],
    });

    const entries = await db.auditLog.findMany({ where: { objectType: "MealRecord" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorUserId).toBe(a.teacherUser.id);
    expect(entries[0]!.objectId).toBe(a.group.id);
    expect(entries[0]!.metadata).toMatchObject({ date: DATE, kind: "LUNCH", count: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — 404 everywhere, never 403
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  /** Membership of the kindergarten is not enough; the assignment is the gate. */
  it("a teacher not assigned to the group gets 404 on both routes", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Хариуцаагүй бүлэг");
    const child = await createChild(a.kindergarten.id, { firstName: "Хол" });
    await enrollChild(a.kindergarten.id, child.id, other.id, a.schoolYear.id);

    const read = await authed(request(server()).get(sheetUrl(other.id)), teacherA);
    const write = await authed(
      request(server()).put(`/v1/groups/${other.id}/meals`),
      teacherA,
    ).send({
      date: DATE,
      kind: "LUNCH",
      entries: [{ childId: child.id, status: "TAKEN" }],
    });

    expect([read.status, write.status]).toEqual([404, 404]);
    expect(await db.mealRecord.count({ where: { childId: child.id } })).toBe(0);
  });

  it("a teacher from another kindergarten gets 404 on both routes", async () => {
    const read = await authed(request(server()).get(sheetUrl(a.group.id)), teacherB);
    const write = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherB,
    ).send({ date: DATE, kind: "LUNCH", entries: [{ childId: a.child.id, status: "TAKEN" }] });

    expect([read.status, write.status]).toEqual([404, 404]);
    expect(await db.mealRecord.count()).toBe(0);
  });

  /**
   * ★ A parent is refused the group register in both directions.
   *
   * `GroupMealsController` carries a class-level `@Roles("TEACHER", "ADMIN")`,
   * so this is the coarse role gate answering — 404, never 403. Note this says
   * nothing about `GET /children/:id/meals/summary`, which is a different
   * controller with a different rule.
   */
  it("a parent can neither read nor write the group register", async () => {
    const read = await authed(request(server()).get(sheetUrl(a.group.id)), parentA);
    const write = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      parentA,
    ).send({ date: DATE, kind: "LUNCH", entries: [{ childId: a.child.id, status: "TAKEN" }] });

    expect([read.status, write.status]).toEqual([404, 404]);
    expect(await db.mealRecord.count()).toBe(0);
  });

  it("requires authentication", async () => {
    expect((await request(server()).get(sheetUrl(a.group.id))).status).toBe(401);
  });

  it("returns 404 for a group that does not exist", async () => {
    const res = await authed(
      request(server()).get(sheetUrl("00000000-0000-4000-8000-000000000000")),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed group id", async () => {
    const res = await authed(request(server()).get(sheetUrl("not-a-uuid")), teacherA);
    expect(res.status).toBe(400);
  });
});
