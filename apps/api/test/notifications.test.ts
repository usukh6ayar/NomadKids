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
