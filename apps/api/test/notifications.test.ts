import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
  createMembership,
  createScenario,
  createUser,
  enrollChild,
  linkGuardian,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Notifications — §8.1 targeting, read tracking, no realtime.
 *
 * The property that carries the weight: a family's audience is derived from
 * **their own children**, so no targeting mistake can deliver them a notice
 * about a child they are not connected to.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
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

  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

const server = () => app.getHttpServer();

/** Creates a notice and returns its id. Draft unless `publish` is set. */
async function notify(
  targets: { groupId?: string; childId?: string }[] = [],
  options: { publish?: boolean; title?: string; kindergartenId?: string } = {},
) {
  const res = await authed(
    request(server()).post(
      `/v1/kindergartens/${options.kindergartenId ?? a.kindergarten.id}/notifications`,
    ),
    teacherA,
  ).send({ title: options.title ?? "Мэдэгдэл", body: "Дэлгэрэнгүй", targets });

  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);

  if (options.publish !== false) {
    await authed(request(server()).post(`/v1/notifications/${res.body.id}/publish`), teacherA);
  }
  return res.body.id as string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Targeting — §8.1
// ═══════════════════════════════════════════════════════════════════════════

describe("targeting", () => {
  it("no targets means the whole kindergarten", async () => {
    await notify([]);

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(res.body.items).toHaveLength(1);
  });

  it("a group target reaches that group's families only", async () => {
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    await notify([{ groupId: otherGroup.id }]);

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(res.body.items).toHaveLength(0);
  });

  it("a group target reaches a family in that group", async () => {
    await notify([{ groupId: a.group.id }]);

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(res.body.items).toHaveLength(1);
  });

  it("a child target reaches only that child's family", async () => {
    const classmate = await createChild(a.kindergarten.id, { firstName: "Ангийнх" });
    await enrollChild(a.kindergarten.id, classmate.id, a.group.id, a.schoolYear.id);

    const otherParent = await createUser({ username: uniq("p2") });
    await createMembership(otherParent.id, a.kindergarten.id, "PARENT");
    await linkGuardian(a.kindergarten.id, classmate.id, otherParent.id);
    const otherSession = await login(app, otherParent.username);

    await notify([{ childId: a.child.id }]);

    expect(
      (await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies)).body.items,
    ).toHaveLength(1);
    // Same group, same kindergarten — but the notice names another child.
    expect(
      (await request(server()).get("/v1/notifications").set("Cookie", otherSession.cookies)).body
        .items,
    ).toHaveLength(0);
  });

  it("★ cross-kindergarten families are never reached", async () => {
    await notify([]);

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentB.cookies);
    expect(res.body.items).toHaveLength(0);
  });

  it("refuses a target group from another kindergarten", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title: "Халдлага", body: "x", targets: [{ groupId: b.group.id }] });

    expect(res.status).toBe(400);
  });

  it("refuses a target child from another kindergarten", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title: "Халдлага", body: "x", targets: [{ childId: b.child.id }] });

    expect(res.status).toBe(400);
  });

  it("refuses a target naming both a group and a child", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({
      title: "Тодорхойгүй",
      body: "x",
      targets: [{ groupId: a.group.id, childId: a.child.id }],
    });

    expect(res.status).toBe(400);
  });

  it("a notice to last year's group does not follow the family", async () => {
    // Only ACTIVE enrollments contribute a group to the audience.
    const oldGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Хуучин бүлэг");
    await enrollChild(a.kindergarten.id, a.child.id, oldGroup.id, a.schoolYear.id, "ENDED");

    await notify([{ groupId: oldGroup.id }]);

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(res.body.items).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Draft vs published
// ═══════════════════════════════════════════════════════════════════════════

describe("draft and publish", () => {
  it("a new notice is a DRAFT", async () => {
    const id = await notify([], { publish: false });
    const row = await db.notification.findUniqueOrThrow({ where: { id } });

    expect(row.status).toBe("DRAFT");
    expect(row.publishedAt).toBeNull();
  });

  it("★ a guardian CANNOT see a draft", async () => {
    // Publishing is separate so a half-written notice cannot reach two hundred
    // families because someone hit save.
    await notify([], { publish: false });

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(res.body.items).toHaveLength(0);
  });

  it("a guardian cannot open a draft by id", async () => {
    const id = await notify([], { publish: false });

    const res = await request(server())
      .get(`/v1/notifications/${id}`)
      .set("Cookie", parentA.cookies);
    expect(res.status).toBe(404);
  });

  it("the author sees their own draft", async () => {
    const id = await notify([], { publish: false });

    const res = await request(server())
      .get(`/v1/notifications/${id}`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DRAFT");
  });

  it("publishing makes it visible and records the time", async () => {
    const id = await notify([]);
    const row = await db.notification.findUniqueOrThrow({ where: { id } });

    expect(row.status).toBe("PUBLISHED");
    expect(row.publishedAt).not.toBeNull();
  });

  it("refuses to publish twice", async () => {
    const id = await notify([]);
    const res = await authed(request(server()).post(`/v1/notifications/${id}/publish`), teacherA);
    expect(res.status).toBe(400);
  });

  it("a guardian cannot publish", async () => {
    const id = await notify([], { publish: false });
    const res = await authed(request(server()).post(`/v1/notifications/${id}/publish`), parentA);
    expect(res.status).toBe(404);
  });

  it("a guardian cannot create one", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      parentA,
    ).send({ title: "Эцэг эхийн", body: "x" });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Date window
// ═══════════════════════════════════════════════════════════════════════════

describe("date window", () => {
  it("hides a notice that has not started", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title: "Ирээдүйн", body: "x", startsOn: "2099-01-01" });
    await authed(request(server()).post(`/v1/notifications/${res.body.id}/publish`), teacherA);

    const list = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(list.body.items).toHaveLength(0);
  });

  it("hides a notice that has expired", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title: "Хуучирсан", body: "x", endsOn: "2020-01-01" });
    await authed(request(server()).post(`/v1/notifications/${res.body.id}/publish`), teacherA);

    const list = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(list.body.items).toHaveLength(0);
  });

  it("shows one inside its window", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title: "Идэвхтэй", body: "x", startsOn: "2020-01-01", endsOn: "2099-01-01" });
    await authed(request(server()).post(`/v1/notifications/${res.body.id}/publish`), teacherA);

    const list = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(list.body.items).toHaveLength(1);
  });

  it("rejects a window that ends before it starts", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title: "Буруу", body: "x", startsOn: "2026-06-01", endsOn: "2026-01-01" });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Read tracking — no realtime
// ═══════════════════════════════════════════════════════════════════════════

describe("read tracking", () => {
  it("counts unread", async () => {
    await notify([]);
    await notify([], { title: "Хоёр дахь" });

    const res = await request(server())
      .get("/v1/notifications/unread-count")
      .set("Cookie", parentA.cookies);

    expect(res.body.count).toBe(2);
  });

  /**
   * ★ A superadmin holds no `Membership` at all (CLAUDE.md §1.1), so
   * `audienceFilter` falls through to its "matches nothing" case. That case
   * used to be `{ id: "__none__" }` — not a valid UUID, and `Notification.id`
   * is `@db.Uuid` — so Postgres rejected the query outright instead of
   * returning zero rows. Both routes that build a where clause even with no
   * audience must survive an actor with none.
   */
  it("a superadmin gets zero, not a 500", async () => {
    const operator = await createUser({ username: uniq("super"), isSuperAdmin: true });
    const operatorSession = await login(app, operator.username);

    const count = await request(server())
      .get("/v1/notifications/unread-count")
      .set("Cookie", operatorSession.cookies);
    expect(count.status).toBe(200);
    expect(count.body.count).toBe(0);

    const list = await request(server())
      .get("/v1/notifications")
      .set("Cookie", operatorSession.cookies);
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
  });

  it("marking read decrements the count", async () => {
    const id = await notify([]);
    await authed(request(server()).post(`/v1/notifications/${id}/read`), parentA);

    const res = await request(server())
      .get("/v1/notifications/unread-count")
      .set("Cookie", parentA.cookies);
    expect(res.body.count).toBe(0);
  });

  it("is idempotent — reading twice does not duplicate", async () => {
    const id = await notify([]);
    await authed(request(server()).post(`/v1/notifications/${id}/read`), parentA);
    await authed(request(server()).post(`/v1/notifications/${id}/read`), parentA);

    expect(await db.notificationRead.count({ where: { notificationId: id } })).toBe(1);
  });

  it("read state is per user", async () => {
    const father = await createUser({ username: uniq("father") });
    await createMembership(father.id, a.kindergarten.id, "PARENT");
    await linkGuardian(a.kindergarten.id, a.child.id, father.id);
    const fatherSession = await login(app, father.username);

    const id = await notify([]);
    await authed(request(server()).post(`/v1/notifications/${id}/read`), parentA);

    expect(
      (await request(server()).get("/v1/notifications/unread-count").set("Cookie", parentA.cookies))
        .body.count,
    ).toBe(0);
    expect(
      (
        await request(server())
          .get("/v1/notifications/unread-count")
          .set("Cookie", fatherSession.cookies)
      ).body.count,
    ).toBe(1);
  });

  it("★ cannot mark read a notice not addressed to you", async () => {
    // Otherwise this endpoint confirms a notice exists.
    const id = await notify([]);

    const res = await authed(request(server()).post(`/v1/notifications/${id}/read`), parentB);
    expect(res.status).toBe(404);
  });

  it("the list reports isRead per item", async () => {
    const id = await notify([]);
    await notify([], { title: "Уншаагүй" });
    await authed(request(server()).post(`/v1/notifications/${id}/read`), parentA);

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    const read = res.body.items.find((n: { id: string }) => n.id === id);

    expect(read.isRead).toBe(true);
    expect(res.body.items.filter((n: { isRead: boolean }) => !n.isRead)).toHaveLength(1);
  });

  it("★ never leaks who else has read a notice", async () => {
    const id = await notify([]);
    await authed(request(server()).post(`/v1/notifications/${id}/read`), parentA);

    const res = await request(server())
      .get(`/v1/notifications/${id}`)
      .set("Cookie", teacherA.cookies);

    // A family's reading habits are not the staff's business, and the response
    // carries only the caller's own receipt.
    expect(res.body.reads).toBeUndefined();
  });

  it("filters to unread only", async () => {
    const id = await notify([]);
    await notify([], { title: "Уншаагүй" });
    await authed(request(server()).post(`/v1/notifications/${id}/read`), parentA);

    const res = await request(server())
      .get("/v1/notifications?unread=true")
      .set("Cookie", parentA.cookies);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("Уншаагүй");
  });

  it("★ searches the title case-insensitively", async () => {
    await notify([], { title: "Зуслангийн мэдээ" });
    await notify([], { title: "Хавтгай тайлан" });

    const res = await request(server())
      .get("/v1/notifications")
      .query({ q: "ЗУСЛАНГИЙН" })
      .set("Cookie", parentA.cookies);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("Зуслангийн мэдээ");
  });

  it("a search term still respects the audience filter", async () => {
    // Same title a matching search would otherwise surface, but targeted at
    // a child parentA has no connection to — the search must narrow what
    // parentA may see, never widen it past the audience filter.
    const classmate = await createChild(a.kindergarten.id, { firstName: "Ангийнх" });
    await enrollChild(a.kindergarten.id, classmate.id, a.group.id, a.schoolYear.id);
    await notify([{ childId: classmate.id }], { title: "Зуслангийн мэдээ" });

    const res = await request(server())
      .get("/v1/notifications")
      .query({ q: "Зуслангийн" })
      .set("Cookie", parentA.cookies);

    expect(res.body.items).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Editing and lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("editing", () => {
  it("a colleague in the same kindergarten may edit", async () => {
    // §8.1 is a shared staff queue, not a personal outbox.
    const id = await notify([], { publish: false });

    const res = await authed(request(server()).patch(`/v1/notifications/${id}`), adminA).send({
      title: "Засварласан",
    });
    expect(res.status).toBe(200);
  });

  it("staff from another kindergarten cannot edit", async () => {
    const id = await notify([], { publish: false });
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(request(server()).patch(`/v1/notifications/${id}`), teacherB).send({
      title: "Хулгай",
    });
    expect(res.status).toBe(404);
  });

  it("replaces targets rather than appending", async () => {
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    const id = await notify([{ groupId: a.group.id }], { publish: false });

    await authed(request(server()).patch(`/v1/notifications/${id}`), teacherA).send({
      targets: [{ groupId: otherGroup.id }],
    });

    const targets = await db.notificationTarget.findMany({ where: { notificationId: id } });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.groupId).toBe(otherGroup.id);
  });

  it("clearing targets widens to the whole kindergarten", async () => {
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    const id = await notify([{ groupId: otherGroup.id }]);

    expect(
      (await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies)).body.items,
    ).toHaveLength(0);

    await authed(request(server()).patch(`/v1/notifications/${id}`), teacherA).send({
      targets: [],
    });

    expect(
      (await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies)).body.items,
    ).toHaveLength(1);
  });

  it("archiving hides it from families", async () => {
    const id = await notify([]);
    await authed(request(server()).delete(`/v1/notifications/${id}`), teacherA);

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(res.body.items).toHaveLength(0);
  });

  it("a guardian cannot archive", async () => {
    const id = await notify([]);
    expect(
      (await authed(request(server()).delete(`/v1/notifications/${id}`), parentA)).status,
    ).toBe(404);
  });

  it("requires CSRF on writes", async () => {
    const res = await request(server())
      .post(`/v1/kindergartens/${a.kindergarten.id}/notifications`)
      .set("Cookie", teacherA.cookies)
      .send({ title: "CSRF-гүй", body: "x" });

    expect(res.status).toBe(403);
  });

  it("requires authentication", async () => {
    expect((await request(server()).get("/v1/notifications")).status).toBe(401);
  });
});

describe("ordering and audit", () => {
  it("puts important notices first", async () => {
    await notify([], { title: "Энгийн" });
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title: "Чухал", body: "x", isImportant: true });
    await authed(request(server()).post(`/v1/notifications/${res.body.id}/publish`), teacherA);

    const list = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(list.body.items[0].title).toBe("Чухал");
  });

  it("writes an audit entry on creation", async () => {
    await notify([]);
    const entry = await db.auditLog.findFirst({
      where: { objectType: "Notification", action: "CREATE" },
    });
    expect(entry?.actorUserId).toBe(a.teacherUser.id);
  });

  it("a teacher who is also a parent sees both audiences", async () => {
    // The union is correct: their kindergarten's staff notices, and the notice
    // sent to their own child's group.
    const dual = await createUser({ username: uniq("dual") });
    await createMembership(dual.id, a.kindergarten.id, "TEACHER");
    await createMembership(dual.id, b.kindergarten.id, "PARENT");

    const ownChild = await createChild(b.kindergarten.id, { firstName: "Хүү" });
    await enrollChild(b.kindergarten.id, ownChild.id, b.group.id, b.schoolYear.id);
    await linkGuardian(b.kindergarten.id, ownChild.id, dual.id);

    const session = await login(app, dual.username);

    await notify([]); // kindergarten A, as staff

    const teacherB = await login(app, b.teacherUser.username);
    const forB = await authed(
      request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/notifications`),
      teacherB,
    ).send({ title: "B-ийн мэдэгдэл", body: "x" });
    await authed(request(server()).post(`/v1/notifications/${forB.body.id}/publish`), teacherB);

    const res = await request(server()).get("/v1/notifications").set("Cookie", session.cookies);
    expect(res.body.items).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Reactions — the class board is likeable, not commentable
// ═══════════════════════════════════════════════════════════════════════════

describe("likes", () => {
  it("a guardian can like a notice they can see", async () => {
    const id = await notify([]);

    const res = await authed(request(server()).post(`/v1/notifications/${id}/like`), parentA);

    expect(res.status).toBe(200);
    expect(res.body.likeCount).toBe(1);
    expect(res.body.likedByMe).toBe(true);
  });

  it("liking twice still counts once", async () => {
    const id = await notify([]);

    await authed(request(server()).post(`/v1/notifications/${id}/like`), parentA);
    const res = await authed(request(server()).post(`/v1/notifications/${id}/like`), parentA);

    // Idempotent: a double-tap on a phone must not produce two likes, and must
    // not fail on the unique constraint either.
    expect(res.status).toBe(200);
    expect(res.body.likeCount).toBe(1);
  });

  it("un-liking removes it, and can be repeated", async () => {
    const id = await notify([]);

    await authed(request(server()).post(`/v1/notifications/${id}/like`), parentA);
    const off = await authed(request(server()).delete(`/v1/notifications/${id}/like`), parentA);
    expect(off.status).toBe(200);
    expect(off.body.likeCount).toBe(0);
    expect(off.body.likedByMe).toBe(false);

    const again = await authed(request(server()).delete(`/v1/notifications/${id}/like`), parentA);
    expect(again.status).toBe(200);
    expect(again.body.likeCount).toBe(0);
  });

  it("re-liking after un-liking works", async () => {
    const id = await notify([]);

    await authed(request(server()).post(`/v1/notifications/${id}/like`), parentA);
    await authed(request(server()).delete(`/v1/notifications/${id}/like`), parentA);
    const res = await authed(request(server()).post(`/v1/notifications/${id}/like`), parentA);

    // The soft-deleted row is still there and its unique pair still applies —
    // this is the case a plain `create` would fail on.
    expect(res.status).toBe(200);
    expect(res.body.likeCount).toBe(1);
    expect(res.body.likedByMe).toBe(true);
  });

  it("counts everyone but reports only my own reaction", async () => {
    const id = await notify([]);

    await authed(request(server()).post(`/v1/notifications/${id}/like`), parentA);
    await authed(request(server()).post(`/v1/notifications/${id}/like`), teacherA);

    const mine = await request(server())
      .get(`/v1/notifications/${id}`)
      .set("Cookie", parentA.cookies);

    expect(mine.body.likeCount).toBe(2);
    expect(mine.body.likedByMe).toBe(true);

    /*
     * ★ Never a list of who liked it.
     *
     * Asserted as the absence of the fields rather than by scanning the payload
     * for a user id — the notice's author is a real, intended id in the
     * response, and a blanket search fails on it while proving nothing about
     * reactions.
     */
    expect(mine.body.reactions).toBeUndefined();
    expect(mine.body._count).toBeUndefined();
    expect(Object.keys(mine.body)).not.toContain("reactions");
  });

  it("the count shows in the list", async () => {
    const id = await notify([]);
    await authed(request(server()).post(`/v1/notifications/${id}/like`), teacherA);

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);

    const row = res.body.items.find((n: { id: string }) => n.id === id);
    expect(row.likeCount).toBe(1);
    expect(row.likedByMe).toBe(false);
  });

  // ── Authorization — CLAUDE.md §4.1 ──────────────────────────────────────

  it("a guardian from another kindergarten gets 404", async () => {
    const id = await notify([]);

    const res = await authed(request(server()).post(`/v1/notifications/${id}/like`), parentB);

    // 404, never 403 — a like must not confirm that a notice exists.
    expect(res.status).toBe(404);
  });

  it("a guardian cannot like a notice targeted at another family", async () => {
    const otherChild = await createChild(a.kindergarten.id, { lastName: "Өөр" });
    await enrollChild(a.kindergarten.id, otherChild.id, a.group.id, a.schoolYear.id);
    const id = await notify([{ childId: otherChild.id }]);

    const res = await authed(request(server()).post(`/v1/notifications/${id}/like`), parentA);

    expect(res.status).toBe(404);
  });

  it("a guardian cannot like an unpublished draft", async () => {
    const id = await notify([], { publish: false });

    const res = await authed(request(server()).post(`/v1/notifications/${id}/like`), parentA);

    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const id = await notify([]);

    expect((await request(server()).post(`/v1/notifications/${id}/like`)).status).toBe(401);
  });

  it("requires CSRF", async () => {
    const id = await notify([]);

    const res = await request(server())
      .post(`/v1/notifications/${id}/like`)
      .set("Cookie", parentA.cookies);

    expect(res.status).toBe(403);
  });

  // ── The absent feature ──────────────────────────────────────────────────

  it("there is no comment endpoint", async () => {
    const id = await notify([]);

    // Guards the decision, not an accident of routing: a class board parents
    // can reply to is a moderation surface nobody has been staffed to police.
    const res = await authed(
      request(server()).post(`/v1/notifications/${id}/comments`),
      parentA,
    ).send({ body: "Сэтгэгдэл" });

    expect(res.status).toBe(404);
  });

  it("a guardian still cannot post a notice", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      parentA,
    ).send({ title: "Эцэг эхээс", body: "Болохгүй", targets: [] });

    // 404, not 403: the tenant check runs before the role check, and a
    // kindergarten a guardian holds no staff membership in is simply not there
    // as far as this endpoint is concerned. Refused either way — the assertion
    // is that nothing was created.
    expect(res.status).toBe(404);
    expect(res.body.id).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Photos on a notice — staff attach, everyone in the audience sees
// ═══════════════════════════════════════════════════════════════════════════

describe("notice photos", () => {
  /** A tiny valid PNG — enough for the content sniffer to accept. */
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  const attach = (id: string, session: AuthSession) =>
    authed(request(server()).post(`/v1/notifications/${id}/media`), session).attach(
      "file",
      PNG,
      "zurag.png",
    );

  it("a teacher can attach a photo", async () => {
    const id = await notify([]);

    const res = await attach(id, teacherA);

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    // Never the storage key — §1.4.
    expect(res.body.storageKey).toBeUndefined();
  });

  it("the photo appears on the notice for the audience", async () => {
    const id = await notify([]);
    await attach(id, teacherA);

    const res = await request(server())
      .get(`/v1/notifications/${id}`)
      .set("Cookie", parentA.cookies);

    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0].id).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain("notifications/");
  });

  it("photos show in the list too", async () => {
    const id = await notify([]);
    await attach(id, teacherA);

    const res = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);

    const row = res.body.items.find((n: { id: string }) => n.id === id);
    expect(row.media).toHaveLength(1);
  });

  // ── Authorization — CLAUDE.md §4.1 ──────────────────────────────────────

  it("a guardian cannot attach a photo", async () => {
    const id = await notify([]);

    const res = await attach(id, parentA);

    /*
     * Liking is open; illustrating is not. An upload endpoint that accepted a
     * parent would be a way around "only staff post".
     *
     * 404 rather than 403, because `assertStaff` answers "no such kindergarten"
     * to someone holding no staff membership in it — the same non-confirming
     * shape as §1.7, and the same status a guardian gets when trying to create
     * a notice. What the test pins is that nothing was attached.
     */
    expect(res.status).toBe(404);
    expect(res.body.id).toBeUndefined();
  });

  it("staff from another kindergarten cannot attach", async () => {
    const id = await notify([]);
    const teacherB = await login(app, b.teacherUser.username);

    const res = await attach(id, teacherB);

    expect([403, 404]).toContain(res.status);
  });

  it("requires authentication", async () => {
    const id = await notify([]);

    const res = await request(server())
      .post(`/v1/notifications/${id}/media`)
      .attach("file", PNG, "zurag.png");

    expect(res.status).toBe(401);
  });

  it("requires CSRF", async () => {
    const id = await notify([]);

    const res = await request(server())
      .post(`/v1/notifications/${id}/media`)
      .set("Cookie", teacherA.cookies)
      .attach("file", PNG, "zurag.png");

    expect(res.status).toBe(403);
  });

  it("the audience can actually fetch the photo", async () => {
    const id = await notify([]);
    const attached = await attach(id, teacherA);

    const res = await request(server())
      .get(`/v1/media/${attached.body.id}`)
      .set("Cookie", parentA.cookies)
      .redirects(0);

    /*
     * ★ The case that made this endpoint necessary.
     *
     * `getDownloadUrl` used to reject anything without a `childId`, and a class
     * photo has none — so the upload succeeded and the image 404'd. A notice
     * photo is readable exactly when its notice is.
     */
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("http");
  });

  it("someone outside the audience cannot fetch it", async () => {
    const id = await notify([]);
    const attached = await attach(id, teacherA);

    const res = await request(server())
      .get(`/v1/media/${attached.body.id}`)
      .set("Cookie", parentB.cookies)
      .redirects(0);

    expect(res.status).toBe(404);
  });

  it("a photo on an unpublished draft is not fetchable by a guardian", async () => {
    const id = await notify([], { publish: false });
    const attached = await attach(id, teacherA);

    const res = await request(server())
      .get(`/v1/media/${attached.body.id}`)
      .set("Cookie", parentA.cookies)
      .redirects(0);

    expect(res.status).toBe(404);
  });

  it("rejects a file that is not an image", async () => {
    const id = await notify([]);

    const res = await authed(
      request(server()).post(`/v1/notifications/${id}/media`),
      teacherA,
    ).attach("file", Buffer.from("#!/bin/sh\necho hi\n"), "zurag.png");

    // Sniffed from content, not trusted from the extension — §1.6.
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// One group's board — the `?groupId=` filter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ★ The filter is a *view* of the reader's own audience, never a way to reach
 * another one.
 *
 * `audienceFilter` decides the set and this narrows it, folded in as one more
 * `AND` beside it. The cases below assert both halves: that a staff reader can
 * look at one group's board, and that a guardian passing a group id they have
 * no child in gets an empty board rather than that group's notices.
 */
describe("filtering the board by group", () => {
  /** A second group in kindergarten A, so "one group's board" has an other. */
  async function secondGroup() {
    return db.group.create({
      data: {
        kindergartenId: a.kindergarten.id,
        schoolYearId: a.schoolYear.id,
        name: "Наран бүлэг",
        ageBand: "MIDDLE",
      },
    });
  }

  it("returns the notices aimed at that group", async () => {
    const other = await secondGroup();
    await notify([{ groupId: a.group.id }], { title: "Дэлбээгийн зар" });
    await notify([{ groupId: other.id }], { title: "Нарангийн зар" });

    const res = await authed(
      request(server()).get(`/v1/notifications?groupId=${a.group.id}`),
      teacherA,
    );

    expect(res.status).toBe(200);
    const titles = res.body.items.map((n: { title: string }) => n.title);
    expect(titles).toContain("Дэлбээгийн зар");
    expect(titles).not.toContain("Нарангийн зар");
  });

  /**
   * ★ A kindergarten-wide notice is on every group's board.
   *
   * "No target rows" is this module's convention for "everyone". Filtering to
   * group-specific notices only would hide the closure announcement from every
   * board in the kindergarten — the one notice that most needs to be on all of
   * them.
   */
  it("keeps a kindergarten-wide notice on every group's board", async () => {
    const other = await secondGroup();
    await notify([], { title: "Цэцэрлэг хаагдана" });

    for (const groupId of [a.group.id, other.id]) {
      const res = await authed(
        request(server()).get(`/v1/notifications?groupId=${groupId}`),
        teacherA,
      );
      const titles = res.body.items.map((n: { title: string }) => n.title);
      expect(titles, `group ${groupId}`).toContain("Цэцэрлэг хаагдана");
    }
  });

  it("narrows the audience it is given rather than widening it", async () => {
    const other = await secondGroup();
    await notify([{ groupId: other.id }], { title: "Нарангийн зар" });

    // The guardian has no child in `other`, so this notice is not theirs to
    // read — asking for that group's board must not hand it over.
    const res = await authed(
      request(server()).get(`/v1/notifications?groupId=${other.id}`),
      parentA,
    );

    expect(res.status).toBe(200);
    const titles = res.body.items.map((n: { title: string }) => n.title);
    expect(titles).not.toContain("Нарангийн зар");
  });

  it("rejects a group id that is not a uuid", async () => {
    const res = await authed(request(server()).get("/v1/notifications?groupId=naran"), teacherA);
    expect(res.status).toBe(400);
  });

  /** Without the filter the board is unchanged — every audience, as before. */
  it("shows every board when no group is named", async () => {
    const other = await secondGroup();
    await notify([{ groupId: a.group.id }], { title: "Дэлбээгийн зар" });
    await notify([{ groupId: other.id }], { title: "Нарангийн зар" });

    const res = await authed(request(server()).get("/v1/notifications"), teacherA);
    const titles = res.body.items.map((n: { title: string }) => n.title);

    expect(titles).toContain("Дэлбээгийн зар");
    expect(titles).toContain("Нарангийн зар");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The kind of notice — the client's own taxonomy
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ★ Зарлал · Үйл ажиллагаа · Сургалт, plus the honest fourth.
 *
 * The board's filter row is drawn from this vocabulary, so what these protect
 * is that it *is* a vocabulary: a fixed enum the API refuses to extend at the
 * caller's request, defaulting to OTHER rather than guessing when nobody said.
 */
describe("the notice's category", () => {
  async function notifyWith(category: string | undefined, title: string) {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title, body: "Дэлгэрэнгүй", targets: [], ...(category ? { category } : {}) });
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
    await authed(request(server()).post(`/v1/notifications/${res.body.id}/publish`), teacherA);
    return res.body;
  }

  it("stores the category it was given", async () => {
    const created = await notifyWith("ACTIVITY", "Намрын аялал");
    expect(created.category).toBe("ACTIVITY");
  });

  /**
   * ★ OTHER, not ANNOUNCEMENT.
   *
   * "The author did not say" is a fact, and the category that means exactly
   * that is the honest place to put it. Defaulting to Зарлал because most
   * notices are announcements would put a classification on a notice nobody
   * classified — and a parent filtering to Зарлал would then read it as one.
   */
  it("files an unclassified notice as OTHER rather than guessing", async () => {
    const created = await notifyWith(undefined, "Ангилалгүй");
    expect(created.category).toBe("OTHER");
  });

  it("refuses a category outside the vocabulary", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title: "Буруу", body: "Дэлгэрэнгүй", targets: [], category: "GOSSIP" });

    expect(res.status).toBe(400);
  });

  it("filters the board to one kind", async () => {
    await notifyWith("ACTIVITY", "Намрын аялал");
    await notifyWith("TRAINING", "Эцэг эхийн хурал");

    const res = await authed(
      request(server()).get("/v1/notifications?category=ACTIVITY"),
      teacherA,
    );
    const titles = res.body.items.map((n: { title: string }) => n.title);

    expect(titles).toContain("Намрын аялал");
    expect(titles).not.toContain("Эцэг эхийн хурал");
  });

  it("rejects a category it does not know as a filter", async () => {
    const res = await authed(request(server()).get("/v1/notifications?category=GOSSIP"), teacherA);
    expect(res.status).toBe(400);
  });

  /**
   * ★ A safety incident is an announcement, not OTHER.
   *
   * `IncidentsService.report` classifies it explicitly. Leaving it to the DTO's
   * default would file the most consequential notice this product sends under
   * "none of the above", where a parent filtering to Зарлал would not find it.
   */
  it("classifies an incident notice as an announcement", async () => {
    const incident = await db.safetyIncident.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        kind: "INJURY",
        occurredAt: new Date(),
        description: "Ширээний ирмэгт маажуулав.",
        recordedById: a.teacherUser.id,
      },
    });

    const res = await authed(
      request(server()).post(`/v1/incidents/${incident.id}/report`),
      teacherA,
    ).send({ title: "Аюулгүй байдлын мэдэгдэл", body: "Ариутгаж, наалт наав." });

    expect(res.status).toBe(201);

    const notice = await db.notification.findFirst({
      where: { kindergartenId: a.kindergarten.id, title: "Аюулгүй байдлын мэдэгдэл" },
    });
    expect(notice?.category).toBe("ANNOUNCEMENT");
  });
});
