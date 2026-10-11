import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  assignTeacher,
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
import { uniq } from "./support/db";
import { WEB_ROUTINE_TEMPLATE } from "./support/routine-template";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Өдрийн дэглэм · дугуйлан — a group's routine and clubs (client, 2026-10-09).
 *
 * What is pinned: the group's teacher keeps it and the director reads it;
 * any other teacher, kindergarten or family gets 404 (CLAUDE.md §1.7, §4.1);
 * a family asks only for their own child and only for a club of the child's
 * current group; a request is decided once; learning areas are checked
 * against the `DevelopmentDomain` table.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let adminA: AuthSession;
let parentA: AuthSession;
let teacherB: AuthSession;
let parentB: AuthSession;
/** Kindergarten A's second group: its own teacher, child and parent. */
let other: { groupId: string; childId: string; teacher: AuthSession; parent: AuthSession };

const server = () => app.getHttpServer();
const groupUrl = (groupId: string, rest = "") => `/v1/groups/${groupId}${rest}`;
const childUrl = (childId: string, rest = "") => `/v1/children/${childId}${rest}`;

const ITEM = {
  start: "08:00",
  end: "08:40",
  name: "Өглөөний хүлээн авалт",
  description: "Мэндчилгээ",
  areas: ["Нийгэм-сэтгэл хөдлөл"],
};

const CLUB = {
  name: "Бяцхан хөгжимчин",
  teacherName: "Д.Энхжаргал",
  room: "Хөгжмийн өрөө",
  days: [1, 3],
  start: "15:00",
  end: "15:35",
  areas: ["Хөгжим"],
  goal: "Хэмнэлд тохируулан хөдлөх.",
};

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

  const group2 = await createGroup(a.kindergarten.id, a.schoolYear.id, "Нарлаг");
  const teacher2 = await createUser({ username: uniq("teacher-a2") });
  const membership2 = await createMembership(teacher2.id, a.kindergarten.id, "TEACHER");
  await assignTeacher(a.kindergarten.id, group2.id, membership2.id);
  const parent2 = await createUser({ username: uniq("parent-a2") });
  await createMembership(parent2.id, a.kindergarten.id, "PARENT");
  const child2 = await createChild(a.kindergarten.id, { firstName: "Тэмүүлэн" });
  await enrollChild(a.kindergarten.id, child2.id, group2.id, a.schoolYear.id);
  await linkGuardian(a.kindergarten.id, child2.id, parent2.id);

  teacherA = await login(app, a.teacherUser.username);
  adminA = await login(app, a.adminUser.username);
  parentA = await login(app, a.parentUser.username);
  teacherB = await login(app, b.teacherUser.username);
  parentB = await login(app, b.parentUser.username);
  other = {
    groupId: group2.id,
    childId: child2.id,
    teacher: await login(app, teacher2.username),
    parent: await login(app, parent2.username),
  };
});

const get = (session: AuthSession, url: string) => authed(request(server()).get(url), session);
const put = (session: AuthSession, url: string, body: object) =>
  authed(request(server()).put(url), session).send(body);
const post = (session: AuthSession, url: string, body: object = {}) =>
  authed(request(server()).post(url), session).send(body);
const del = (session: AuthSession, url: string) => authed(request(server()).delete(url), session);

async function createClub(groupId = a.group.id, session = teacherA) {
  const res = await post(session, groupUrl(groupId, "/clubs"), CLUB);
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function requestClub(clubId: string, childId = a.child.id, session = parentA) {
  const res = await post(session, childUrl(childId, "/club-requests"), { clubId });
  expect(res.status).toBe(201);
  return res.body as { id: string; status: string };
}

describe("GET /groups/:id/routine", () => {
  it("a group that never saved one answers empty, for the screen's template", async () => {
    const res = await get(teacherA, groupUrl(a.group.id, "/routine"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      group: { id: a.group.id, name: a.group.name },
      items: [],
      plan: [],
      clubs: [],
      requests: [],
      updatedAt: null,
    });
  });

  it("the director reads it", async () => {
    expect((await get(adminA, groupUrl(a.group.id, "/routine"))).status).toBe(200);
  });

  it("teacher from another group gets 404", async () => {
    expect((await get(other.teacher, groupUrl(a.group.id, "/routine"))).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    expect((await get(teacherB, groupUrl(a.group.id, "/routine"))).status).toBe(404);
  });

  it("a family gets 404 on the group route", async () => {
    expect((await get(parentA, groupUrl(a.group.id, "/routine"))).status).toBe(404);
  });
});

describe("PUT routine items and plan", () => {
  it("the teacher saves the day, sorted by time, and reads it back", async () => {
    const later = { ...ITEM, start: "09:00", end: "09:30", name: "Цай", areas: [] };
    const res = await put(teacherA, groupUrl(a.group.id, "/routine/items"), {
      items: [later, ITEM],
    });
    expect(res.status).toBe(200);

    const read = await get(teacherA, groupUrl(a.group.id, "/routine"));
    expect(read.body.items.map((i: { name: string }) => i.name)).toEqual([ITEM.name, later.name]);
    expect(read.body.updatedAt).not.toBeNull();
  });

  it("the plan keeps the group's own label", async () => {
    const plan = [{ area: "Хөгжим", label: "Хөгжим, бүжиг", goal: "Дуулах", content: "Дуу" }];
    expect((await put(teacherA, groupUrl(a.group.id, "/routine/plan"), { plan })).status).toBe(200);
    const read = await get(adminA, groupUrl(a.group.id, "/routine"));
    expect(read.body.plan).toEqual(plan);
  });

  it("the web's own template saves as it is — all seven areas, by name", async () => {
    const items = await put(teacherA, groupUrl(a.group.id, "/routine/items"), {
      items: WEB_ROUTINE_TEMPLATE.items,
    });
    expect(items.status).toBe(200);
    const plan = await put(teacherA, groupUrl(a.group.id, "/routine/plan"), {
      plan: WEB_ROUTINE_TEMPLATE.plan,
    });
    expect(plan.status).toBe(200);
    expect(plan.body.items).toHaveLength(WEB_ROUTINE_TEMPLATE.items.length);
    expect(plan.body.plan).toHaveLength(7);
  });

  it("an area the kindergarten does not have is refused", async () => {
    const res = await put(teacherA, groupUrl(a.group.id, "/routine/items"), {
      items: [{ ...ITEM, areas: ["Шатар"] }],
    });
    expect(res.status).toBe(400);
  });

  it("an end before the start is refused", async () => {
    const res = await put(teacherA, groupUrl(a.group.id, "/routine/items"), {
      items: [{ ...ITEM, start: "09:00", end: "08:00" }],
    });
    expect(res.status).toBe(400);
  });

  it("the director reads but does not write", async () => {
    const res = await put(adminA, groupUrl(a.group.id, "/routine/items"), { items: [ITEM] });
    expect(res.status).toBe(404);
    expect(await db.groupRoutine.count()).toBe(0);
  });

  it("a director who teaches another group does not write this one", async () => {
    const membership = await createMembership(a.adminUser.id, a.kindergarten.id, "TEACHER");
    await assignTeacher(a.kindergarten.id, other.groupId, membership.id);
    const director = await login(app, a.adminUser.username);

    const res = await put(director, groupUrl(a.group.id, "/routine/items"), { items: [ITEM] });
    expect(res.status).toBe(404);
    expect(await db.groupRoutine.count()).toBe(0);
    // …and still reads it, as the director.
    expect((await get(director, groupUrl(a.group.id, "/routine"))).status).toBe(200);
  });

  it("teacher from another group gets 404, and nothing is written", async () => {
    const items = put(other.teacher, groupUrl(a.group.id, "/routine/items"), { items: [ITEM] });
    expect((await items).status).toBe(404);
    const plan = put(other.teacher, groupUrl(a.group.id, "/routine/plan"), { plan: [] });
    expect((await plan).status).toBe(404);
    expect(await db.groupRoutine.count()).toBe(0);
  });

  it("user from another kindergarten gets 404", async () => {
    const res = await put(teacherB, groupUrl(a.group.id, "/routine/plan"), { plan: [] });
    expect(res.status).toBe(404);
  });
});

describe("clubs", () => {
  it("the teacher adds, edits and removes a club", async () => {
    const club = await createClub();

    const edited = await put(teacherA, groupUrl(a.group.id, `/clubs/${club.id}`), {
      ...CLUB,
      room: null,
      days: [5],
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ id: club.id, room: null, days: [5] });

    expect((await del(teacherA, groupUrl(a.group.id, `/clubs/${club.id}`))).status).toBe(204);
    const read = await get(teacherA, groupUrl(a.group.id, "/routine"));
    expect(read.body.clubs).toEqual([]);

    const row = await db.club.findUniqueOrThrow({ where: { id: club.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it("a club of another group cannot be edited through this group", async () => {
    const club = await createClub(other.groupId, other.teacher);
    const res = await put(teacherA, groupUrl(a.group.id, `/clubs/${club.id}`), CLUB);
    expect(res.status).toBe(404);
  });

  it("teacher from another group gets 404", async () => {
    expect((await post(other.teacher, groupUrl(a.group.id, "/clubs"), CLUB)).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    const club = await createClub();
    expect((await del(teacherB, groupUrl(a.group.id, `/clubs/${club.id}`))).status).toBe(404);
  });

  it("the director cannot add one", async () => {
    expect((await post(adminA, groupUrl(a.group.id, "/clubs"), CLUB)).status).toBe(404);
  });
});

describe("GET /children/:id/routine", () => {
  it("the family sees the group's day and clubs, and only their own child's requests", async () => {
    await put(teacherA, groupUrl(a.group.id, "/routine/items"), { items: [ITEM] });
    const club = await createClub();
    await requestClub(club.id);

    // A second child of the same group, of another family.
    const sibling = await createChild(a.kindergarten.id, { firstName: "Номин" });
    await enrollChild(a.kindergarten.id, sibling.id, a.group.id, a.schoolYear.id);
    const otherParent = await createUser({ username: uniq("parent-a3") });
    await createMembership(otherParent.id, a.kindergarten.id, "PARENT");
    await linkGuardian(a.kindergarten.id, sibling.id, otherParent.id);
    await requestClub(club.id, sibling.id, await login(app, otherParent.username));

    const res = await get(parentA, childUrl(a.child.id, "/routine"));
    expect(res.status).toBe(200);
    expect(res.body.group).toEqual({ id: a.group.id, name: a.group.name });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.clubs).toHaveLength(1);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0]).toMatchObject({ childId: a.child.id, status: "PENDING" });
  });

  it("guardian of another child gets 404", async () => {
    expect((await get(other.parent, childUrl(a.child.id, "/routine"))).status).toBe(404);
  });

  it("teacher from another group gets 404", async () => {
    expect((await get(other.teacher, childUrl(a.child.id, "/routine"))).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    expect((await get(parentB, childUrl(a.child.id, "/routine"))).status).toBe(404);
  });

  it("a child with no current enrollment answers 404", async () => {
    await db.enrollment.update({
      where: { id: a.enrollment.id },
      data: { status: "ENDED", endedOn: new Date("2026-01-31") },
    });
    expect((await get(parentA, childUrl(a.child.id, "/routine"))).status).toBe(404);
  });
});

describe("club requests", () => {
  it("the teacher sees a request and approves it, once", async () => {
    const club = await createClub();
    const req = await requestClub(club.id);

    const group = await get(teacherA, groupUrl(a.group.id, "/routine"));
    expect(group.body.requests).toEqual([
      expect.objectContaining({ id: req.id, childId: a.child.id, status: "PENDING" }),
    ]);
    expect(group.body.requests[0].childName).toContain(a.child.firstName);

    const approve = groupUrl(a.group.id, `/club-requests/${req.id}/approve`);
    expect((await post(teacherA, approve)).status).toBe(200);
    expect((await post(teacherA, approve)).status).toBe(409);
    const reject = groupUrl(a.group.id, `/club-requests/${req.id}/reject`);
    expect((await post(teacherA, reject)).status).toBe(409);

    const audit = await db.auditLog.findMany({ where: { objectId: req.id } });
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(["CREATE", "UPDATE"]));
  });

  it("asking twice while the first is pending is refused; after a rejection it is allowed", async () => {
    const club = await createClub();
    const first = await requestClub(club.id);
    const again = await post(parentA, childUrl(a.child.id, "/club-requests"), { clubId: club.id });
    expect(again.status).toBe(409);

    await post(teacherA, groupUrl(a.group.id, `/club-requests/${first.id}/reject`));
    await requestClub(club.id);
  });

  it("a club of another group cannot be asked for", async () => {
    const club = await createClub(other.groupId, other.teacher);
    const res = await post(parentA, childUrl(a.child.id, "/club-requests"), { clubId: club.id });
    expect(res.status).toBe(404);
  });

  it("a removed club cannot be asked for, and its requests leave the screen", async () => {
    const club = await createClub();
    await requestClub(club.id);
    await del(teacherA, groupUrl(a.group.id, `/clubs/${club.id}`));

    const res = await post(parentA, childUrl(a.child.id, "/club-requests"), { clubId: club.id });
    expect(res.status).toBe(404);
    const group = await get(teacherA, groupUrl(a.group.id, "/routine"));
    expect(group.body.requests).toEqual([]);
  });

  it("guardian of another child gets 404", async () => {
    const club = await createClub();
    const res = await post(other.parent, childUrl(a.child.id, "/club-requests"), {
      clubId: club.id,
    });
    expect(res.status).toBe(404);
  });

  it("a teacher cannot ask on a family's behalf", async () => {
    const club = await createClub();
    const res = await post(teacherA, childUrl(a.child.id, "/club-requests"), { clubId: club.id });
    expect(res.status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    const club = await createClub();
    const res = await post(parentB, childUrl(a.child.id, "/club-requests"), { clubId: club.id });
    expect(res.status).toBe(404);
  });

  it("teacher from another group cannot decide it", async () => {
    const club = await createClub();
    const req = await requestClub(club.id);
    const res = await post(other.teacher, groupUrl(a.group.id, `/club-requests/${req.id}/approve`));
    expect(res.status).toBe(404);
    // Nor through their own group's path.
    const own = await post(
      other.teacher,
      groupUrl(other.groupId, `/club-requests/${req.id}/approve`),
    );
    expect(own.status).toBe(404);
  });

  it("the director cannot decide it", async () => {
    const club = await createClub();
    const req = await requestClub(club.id);
    const res = await post(adminA, groupUrl(a.group.id, `/club-requests/${req.id}/approve`));
    expect(res.status).toBe(404);
  });
});
