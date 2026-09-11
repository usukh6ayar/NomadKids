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
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

const server = () => app.getHttpServer();

/** Creates a notice and returns its id. Draft unless `publish` is set. */
/**
 * ★ Posted by the administrator, not the teacher — changed 2026-09-10.
 *
 * A teacher may now only address their own groups (client: "багш зөвхөн
 * өөрийн бүлэгтээ л пост оруулна"), and most of this file's notices are
 * kindergarten-wide, which is the administrator's to send. Every test below
 * keeps the audience it was written for; only who signed it changed.
 *
 * `as` lets the handful of tests that are *about* the new rule post as the
 * teacher and assert what they get.
 */
async function notify(
  targets: { groupId?: string; childId?: string }[] = [],
  options: {
    publish?: boolean;
    title?: string;
    kindergartenId?: string;
    as?: AuthSession;
  } = {},
) {
  const res = await authed(
    request(server()).post(
      `/v1/kindergartens/${options.kindergartenId ?? a.kindergarten.id}/notifications`,
    ),
    options.as ?? adminA,
  ).send({ title: options.title ?? "Мэдэгдэл", body: "Дэлгэрэнгүй", targets });

  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);

  if (options.publish !== false) {
    // The same signature that created it: `requireStaffOwned` lets the author
    // or an administrator publish, and a silent 404 here would leave every
    // audience test reading an unpublished draft as "nobody can see it".
    const published = await authed(
      request(server()).post(`/v1/notifications/${res.body.id}/publish`),
      options.as ?? adminA,
    );
    if (published.status !== 201) {
      throw new Error(`publish failed: ${published.status} ${published.text}`);
    }
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
      adminA,
    ).send({ title: "Халдлага", body: "x", targets: [{ groupId: b.group.id }] });

    expect(res.status).toBe(400);
  });

  it("refuses a target child from another kindergarten", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      adminA,
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
    // Addressed to the teacher's own group, because that is the only audience
    // a teacher may write to since 2026-09-10 — and "the author" is the point
    // of this test, so the author has to be somebody other than the admin.
    const id = await notify([{ groupId: a.group.id }], { publish: false, as: teacherA });

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
    const res = await authed(request(server()).post(`/v1/notifications/${id}/publish`), adminA);
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
      adminA,
    ).send({ title: "Идэвхтэй", body: "x", startsOn: "2020-01-01", endsOn: "2099-01-01" });
    await authed(request(server()).post(`/v1/notifications/${res.body.id}/publish`), adminA);

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

    await authed(request(server()).patch(`/v1/notifications/${id}`), adminA).send({
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

    await authed(request(server()).patch(`/v1/notifications/${id}`), adminA).send({
      targets: [],
    });

    expect(
      (await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies)).body.items,
    ).toHaveLength(1);
  });

  it("archiving hides it from families", async () => {
    const id = await notify([]);
    await authed(request(server()).delete(`/v1/notifications/${id}`), adminA);

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
      adminA,
    ).send({ title: "Чухал", body: "x", isImportant: true });
    await authed(request(server()).post(`/v1/notifications/${res.body.id}/publish`), adminA);

    const list = await request(server()).get("/v1/notifications").set("Cookie", parentA.cookies);
    expect(list.body.items[0].title).toBe("Чухал");
  });

  it("writes an audit entry on creation", async () => {
    await notify([]);
    const entry = await db.auditLog.findFirst({
      where: { objectType: "Notification", action: "CREATE" },
    });
    expect(entry?.actorUserId).toBe(a.adminUser.id);
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

    const adminB = await login(app, b.adminUser.username);
    const forB = await authed(
      request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/notifications`),
      adminB,
    ).send({ title: "B-ийн мэдэгдэл", body: "x" });
    await authed(request(server()).post(`/v1/notifications/${forB.body.id}/publish`), adminB);

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
// Whose notice it is — 2026-08-30
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ★ These are the tests `requireStaffOwned` never had, and the reason it was
 * wrong for as long as it was.
 *
 * It asserted only that the actor was staff of the notice's kindergarten, so
 * **any teacher could edit or delete any other teacher's post**. The name said
 * "owned"; the body checked nothing of the sort. Nothing here failed, because
 * every existing case used one teacher.
 *
 * The rule, as the client stated it on 2026-08-30: a teacher reaches their own
 * notice and nobody else's; an admin reaches any in their kindergarten, which
 * is the existing administrative permission and is not narrowed.
 *
 * 404 rather than 403 throughout — §1.7. A teacher who may not touch another
 * teacher's post should not learn from the status code that it exists.
 */
describe("post ownership", () => {
  let otherTeacher: AuthSession;

  beforeEach(async () => {
    // A second teacher in the *same* kindergarten — the case the old check
    // waved through. A teacher from another kindergarten was already refused
    // by `assertStaff`, which is why that alone looked sufficient.
    const user = await createUser({ username: uniq("teacher-a2") });
    await createMembership(user.id, a.kindergarten.id, "TEACHER");
    otherTeacher = await login(app, user.username);
  });

  it("lets a teacher delete their own post", async () => {
    const id = await notify([{ groupId: a.group.id }], { as: teacherA });

    const res = await authed(request(server()).delete(`/v1/notifications/${id}`), teacherA);

    expect(res.status).toBe(200);
    const row = await testDb().notification.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("refuses a teacher deleting another teacher's post, with 404", async () => {
    const id = await notify([{ groupId: a.group.id }]);

    const res = await authed(request(server()).delete(`/v1/notifications/${id}`), otherTeacher);

    expect(res.status).toBe(404);
    const row = await testDb().notification.findUnique({ where: { id } });
    expect(row?.deletedAt).toBeNull();
  });

  it("refuses a teacher editing another teacher's post", async () => {
    const id = await notify([{ groupId: a.group.id }], { publish: false });

    const res = await authed(request(server()).patch(`/v1/notifications/${id}`), otherTeacher).send(
      { body: "Өөрчилсөн" },
    );

    expect(res.status).toBe(404);
  });

  it("refuses a teacher publishing another teacher's draft", async () => {
    const id = await notify([{ groupId: a.group.id }], { publish: false });

    const res = await authed(
      request(server()).post(`/v1/notifications/${id}/publish`),
      otherTeacher,
    );

    expect(res.status).toBe(404);
  });

  /** The admin permission is unchanged — the client asked for it to stay. */
  it("lets an admin delete any post in their kindergarten", async () => {
    const id = await notify([{ groupId: a.group.id }]);

    const res = await authed(request(server()).delete(`/v1/notifications/${id}`), adminA);

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Category, optional title and the date range — the client's 2026-08-30 filter
// ═══════════════════════════════════════════════════════════════════════════

describe("category and search filters", () => {
  /** Posts a notice in a category, published, and returns its id. */
  async function post(category: string, body: string, title: string | null = null) {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title, category, body, targets: [{ groupId: a.group.id }] });

    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
    await authed(request(server()).post(`/v1/notifications/${res.body.id}/publish`), teacherA);
    return res.body.id as string;
  }

  /**
   * ★ A post with no heading at all.
   *
   * The client asked for this directly: "Өнөөдөр цэцэрлэгт хүрээлэнд явлаа"
   * needs no title, and requiring one produced headings that restated the
   * first line of the body.
   */
  it("accepts a post with no title", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ body: "Гарчиггүй мэдээ", targets: [{ groupId: a.group.id }] });

    expect(res.status).toBe(201);
    expect(res.body.title).toBeNull();
  });

  /** An untouched input posts `""`; storing it would make two empty states. */
  it("stores an empty title as null rather than an empty string", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ title: "   ", body: "Хоосон гарчиг", targets: [{ groupId: a.group.id }] });

    expect(res.status).toBe(201);
    expect(res.body.title).toBeNull();
  });

  it("defaults a post with no category to OTHER, so no filter hides it", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      teacherA,
    ).send({ body: "Ангилалгүй", targets: [{ groupId: a.group.id }] });

    expect(res.body.category).toBe("OTHER");
  });

  it("filters by category", async () => {
    await post("ANNOUNCEMENT", "Намрын аялал");
    await post("BIRTHDAY", "Төрсөн өдрийн мэнд");

    const res = await authed(
      request(server()).get("/v1/notifications?category=ANNOUNCEMENT"),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].body).toBe("Намрын аялал");
  });

  it("refuses a category that is not one of the client's nine", async () => {
    const res = await authed(request(server()).get("/v1/notifications?category=ЗАРЛАЛ"), parentA);
    expect(res.status).toBe(400);
  });

  /**
   * ★ The whole point of the filter, as the client described it: "2026.08.01–
   * 2026.08.30 хоорондох Зарлал төрлийн мэдээнүүдээс 'аялал' гэж хайх".
   */
  it("combines text, category and a date range", async () => {
    await post("ANNOUNCEMENT", "Намрын аялал болно");
    await post("ANNOUNCEMENT", "Эцэг эхийн хурал");
    await post("OUTING", "Аялал дууслаа");

    const today = new Date().toISOString().slice(0, 10);
    const res = await authed(
      request(server()).get(
        `/v1/notifications?q=аялал&category=ANNOUNCEMENT&from=${today}&to=${today}`,
      ),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].body).toBe("Намрын аялал болно");
  });

  /**
   * ★ `to` includes its whole day.
   *
   * A parent choosing today as the end means "up to and including today", and
   * `lte` against a bare date stops at midnight — which would drop everything
   * posted during the day the user actually asked about.
   */
  it("includes posts made on the last day of the range", async () => {
    await post("INFORMATION", "Өнөөдрийн мэдээ");

    const today = new Date().toISOString().slice(0, 10);
    const res = await authed(request(server()).get(`/v1/notifications?to=${today}`), parentA);

    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("excludes a range that ended before the post", async () => {
    await post("INFORMATION", "Өнөөдрийн мэдээ");

    const res = await authed(request(server()).get("/v1/notifications?to=2020-01-01"), parentA);

    expect(res.body.items).toHaveLength(0);
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
// Cook — reads the board, does not post to it. Client decision, 2026-09-08.
// ═══════════════════════════════════════════════════════════════════════════

describe("cook", () => {
  async function cookSession(kindergartenId: string) {
    const user = await createUser({ username: uniq("cook") });
    await createMembership(user.id, kindergartenId, "COOK");
    return login(app, user.username);
  }

  it("reads a published, kindergarten-wide notice", async () => {
    const cookA = await cookSession(a.kindergarten.id);
    await notify([], { title: "Цэцэрлэг маргааш амарна" });

    const res = await authed(request(server()).get("/v1/notifications"), cookA);
    expect(res.status).toBe(200);
    expect(res.body.items.map((n: { title: string }) => n.title)).toContain(
      "Цэцэрлэг маргааш амарна",
    );
  });

  it("does not read a draft it did not author", async () => {
    const cookA = await cookSession(a.kindergarten.id);
    await notify([], { title: "Ноорог", publish: false });

    const res = await authed(request(server()).get("/v1/notifications"), cookA);
    expect(res.body.items.map((n: { title: string }) => n.title)).not.toContain("Ноорог");
  });

  it("never reaches another kindergarten's board", async () => {
    const cookA = await cookSession(a.kindergarten.id);

    const teacherB = await login(app, b.teacherUser.username);
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/notifications`),
      teacherB,
    ).send({ title: "Хааны мэдэгдэл", body: "Дэлгэрэнгүй", targets: [] });
    await authed(request(server()).post(`/v1/notifications/${created.body.id}/publish`), teacherB);

    const res = await authed(request(server()).get("/v1/notifications"), cookA);
    expect(res.body.items.map((n: { title: string }) => n.title)).not.toContain("Хааны мэдэгдэл");
  });

  it("still cannot post — the coarse role gate refuses before the audience filter is even reached", async () => {
    const cookA = await cookSession(a.kindergarten.id);
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      cookA,
    ).send({ title: "x", body: "y", targets: [] });
    expect(res.status).toBe(404);
  });
});

/**
 * Whose audience is whose — client, 2026-09-10: "багш зөвхөн өөрийн бүлэгтээ л
 * пост оруулна ... Удирдлага л бүх цэцэрлэг болон бүлэг сонгон судалгаа болон
 * пост оруулж болно."
 *
 * ★ Enforced on the server, not by narrowing the compose screen's select.
 *
 * `targets` is optional in the DTO and an empty list *means* the whole
 * kindergarten, so a request that never loaded that screen asks for the widest
 * audience there is simply by omitting a field. Every case below goes through
 * HTTP for that reason (§4.1).
 *
 * ★★ 404, not 403 — `docs/SECURITY.md` §5.4. A teacher must not learn which
 * groups exist by watching the error code change.
 */
describe("who may address whom", () => {
  const post = (session: AuthSession, body: Record<string, unknown>) =>
    authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      session,
    ).send({ title: "Мэдэгдэл", body: "x", ...body });

  it("lets a teacher post to a group they teach", async () => {
    const res = await post(teacherA, { targets: [{ groupId: a.group.id }] });
    expect(res.status).toBe(201);
  });

  it("refuses a teacher the whole kindergarten", async () => {
    const res = await post(teacherA, { targets: [] });
    expect(res.status).toBe(404);
  });

  /**
   * ★ The case the loop would have missed.
   *
   * Omitting `targets` altogether is the same request as sending `[]` — the
   * DTO defaults it — and a check written as "every named group must be mine"
   * passes trivially when nothing is named.
   */
  it("refuses a teacher who names no audience at all", async () => {
    const res = await post(teacherA, {});
    expect(res.status).toBe(404);
  });

  it("refuses a teacher a group in their own kindergarten that they do not teach", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Тэдний биш бүлэг");

    const res = await post(teacherA, { targets: [{ groupId: other.id }] });

    expect(res.status).toBe(404);
  });

  /** A named child is narrower than a group, so it is allowed — if it is theirs. */
  it("lets a teacher post to a child in their own group", async () => {
    const res = await post(teacherA, { targets: [{ childId: a.child.id }] });
    expect(res.status).toBe(201);
  });

  it("refuses a teacher a child outside their groups", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Тэдний биш бүлэг");
    const child = await createChild(a.kindergarten.id, { firstName: "Хөрш" });
    await enrollChild(a.kindergarten.id, child.id, other.id, a.schoolYear.id);

    const res = await post(teacherA, { targets: [{ childId: child.id }] });

    expect(res.status).toBe(404);
  });

  /**
   * ★ One good target does not carry the rest.
   *
   * The natural way to widen an audience is to keep the group you are allowed
   * and add one you are not, which passes any check that stops at the first
   * match.
   */
  it("refuses a mixed list where one group is not theirs", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Тэдний биш бүлэг");

    const res = await post(teacherA, {
      targets: [{ groupId: a.group.id }, { groupId: other.id }],
    });

    expect(res.status).toBe(404);
  });

  it("lets an administrator address the whole kindergarten", async () => {
    const res = await post(adminA, { targets: [] });
    expect(res.status).toBe(201);
  });

  it("lets an administrator address a group they do not teach", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Аль ч бүлэг");

    const res = await post(adminA, { targets: [{ groupId: other.id }] });

    expect(res.status).toBe(201);
  });

  /**
   * ★ Re-checked on edit, because widening afterwards is the same act with an
   * extra step.
   *
   * A teacher publishes to their own group, then PATCHes the targets to `[]`.
   * `PATCH` runs `requireStaffOwned`, which the author passes — so without the
   * audience check on this path the rule would hold for exactly one request.
   */
  it("refuses a teacher widening their own post afterwards", async () => {
    const id = await notify([{ groupId: a.group.id }], { as: teacherA, publish: false });

    const res = await authed(request(server()).patch(`/v1/notifications/${id}`), teacherA).send({
      targets: [],
    });

    expect(res.status).toBe(404);
    expect(await db.notificationTarget.count({ where: { notificationId: id } })).toBe(1);
  });

  /** An edit that does not touch the audience is untouched by the rule. */
  it("still lets a teacher edit the words of their own post", async () => {
    const id = await notify([{ groupId: a.group.id }], { as: teacherA, publish: false });

    const res = await authed(request(server()).patch(`/v1/notifications/${id}`), teacherA).send({
      title: "Засварласан",
    });

    expect(res.status).toBe(200);
  });

  /**
   * ★ A teacher assigned to no group has no audience, not the whole
   * kindergarten.
   *
   * The failure this guards is the tempting shortcut of treating an empty
   * teaching set as "unscoped" — which is precisely backwards, and which the
   * child visibility filter's own note warns must never be "optimised" into
   * omitting the filter.
   */
  it("gives an unassigned teacher no audience at all", async () => {
    const stranger = await createUser({ username: uniq("nogroup") });
    await createMembership(stranger.id, a.kindergarten.id, "TEACHER");
    const session = await login(app, stranger.username);

    expect((await post(session, { targets: [{ groupId: a.group.id }] })).status).toBe(404);
    expect((await post(session, { targets: [] })).status).toBe(404);
  });
});
