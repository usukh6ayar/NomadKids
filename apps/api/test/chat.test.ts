import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Chat — RFP Phase IV, in scope from 2026-08-29 (CLAUDE.md §7).
 *
 * ★ These are the §4.1 cases, through HTTP against the real routes.
 *
 * The rule names three: a teacher from another group, a guardian of another
 * child, and a user from another kindergarten must each get **404**. All three
 * are below, plus the one this feature adds — a guardian must not reach the
 * staff room, which is the room where teachers discuss the children *to* those
 * guardians.
 *
 * ★★ 404 and never 403 (§1.7). A room key is `group:` plus a uuid, which is
 * trivial to construct; 403 would turn the endpoint into an oracle for "is this
 * a real group somewhere in the system".
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

const server = () => app.getHttpServer();

const groupRoom = (s: Scenario) => `group:${s.group.id}`;
const staffRoom = (s: Scenario) => `staff:${s.kindergarten.id}`;

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData(db);
  /*
    Five logins per test against a login limiter that counts by identifier —
    fifteen tests is seventy-five attempts and the last third of the file was
    failing with 429 before this line. `artwork.test.ts` resets the same way
    and for the same reason: the limiter is real behaviour worth keeping in
    production and worth clearing between tests that are not about it.
  */
  app.get(RateLimitService).resetAll();
  a = await createScenario("a");
  b = await createScenario("b");
  teacherA = await login(app, a.teacherUser.username);
  adminA = await login(app, a.adminUser.username);
  parentA = await login(app, a.parentUser.username);
  teacherB = await login(app, b.teacherUser.username);
  parentB = await login(app, b.parentUser.username);
});

// ═══════════════════════════════════════════════════════════════════════════
// Which rooms exist for whom
// ═══════════════════════════════════════════════════════════════════════════

describe("the room list", () => {
  it("gives a teacher their group and the staff room, and nothing else", async () => {
    const res = await authed(request(server()).get("/v1/chat/rooms"), teacherA);

    expect(res.status).toBe(200);
    const keys = res.body.map((r: { key: string }) => r.key).sort();
    expect(keys).toEqual([groupRoom(a), staffRoom(a)].sort());
  });

  /**
   * ★ The rule this whole feature turns on.
   *
   * A guardian is in their child's group room and in no staff room — that is
   * where teachers talk about the children *to* the families, and a parent
   * reading it is the disclosure this feature could most easily have shipped.
   */
  it("gives a guardian their child's group room and no staff room", async () => {
    const res = await authed(request(server()).get("/v1/chat/rooms"), parentA);

    expect(res.status).toBe(200);
    expect(res.body.map((r: { key: string }) => r.key)).toEqual([groupRoom(a)]);
    expect(res.body.every((r: { kind: string }) => r.kind !== "STAFF")).toBe(true);
  });

  it("gives an admin the staff room", async () => {
    const res = await authed(request(server()).get("/v1/chat/rooms"), adminA);

    expect(res.status).toBe(200);
    expect(res.body.map((r: { key: string }) => r.key)).toContain(staffRoom(a));
  });

  /** No kindergarten's rooms leak into another's list. */
  it("never names another kindergarten's rooms", async () => {
    const res = await authed(request(server()).get("/v1/chat/rooms"), teacherA);

    const keys = res.body.map((r: { key: string }) => r.key);
    expect(keys).not.toContain(groupRoom(b));
    expect(keys).not.toContain(staffRoom(b));
  });

  it("counts the people who can see a room", async () => {
    const res = await authed(request(server()).get("/v1/chat/rooms"), teacherA);

    const group = res.body.find((r: { key: string }) => r.key === groupRoom(a));
    // One assigned teacher plus the enrolled child's one guardian.
    expect(group.memberCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §4.1 — the mandatory three, plus the staff room
// ═══════════════════════════════════════════════════════════════════════════

describe("a room the actor is not in", () => {
  /** Every route that takes a room key, so none of them can be forgotten. */
  const routes = (room: string) => [
    { method: "get" as const, path: `/v1/chat/rooms/${room}/messages`, body: undefined },
    { method: "post" as const, path: `/v1/chat/rooms/${room}/messages`, body: { body: "сайн уу" } },
    { method: "post" as const, path: `/v1/chat/rooms/${room}/read`, body: undefined },
  ];

  it("teacher from another kindergarten gets 404", async () => {
    for (const route of routes(groupRoom(a))) {
      const req = authed(request(server())[route.method](route.path), teacherB);
      const res = route.body ? await req.send(route.body) : await req;
      expect(res.status, `${route.method} ${route.path}`).toBe(404);
    }
  });

  it("guardian of another child gets 404", async () => {
    for (const route of routes(groupRoom(a))) {
      const req = authed(request(server())[route.method](route.path), parentB);
      const res = route.body ? await req.send(route.body) : await req;
      expect(res.status, `${route.method} ${route.path}`).toBe(404);
    }
  });

  it("user from another kindergarten gets 404 on the staff room", async () => {
    for (const route of routes(staffRoom(a))) {
      const req = authed(request(server())[route.method](route.path), teacherB);
      const res = route.body ? await req.send(route.body) : await req;
      expect(res.status, `${route.method} ${route.path}`).toBe(404);
    }
  });

  /**
   * ★ The one this feature adds to the standard three.
   *
   * `parentA` is a legitimate member of the kindergarten and of the group room
   * — so this is not "an outsider is refused", it is "an insider is refused the
   * room that is not theirs". A membership check alone would have passed it.
   */
  it("a guardian of this kindergarten still gets 404 on the staff room", async () => {
    for (const route of routes(staffRoom(a))) {
      const req = authed(request(server())[route.method](route.path), parentA);
      const res = route.body ? await req.send(route.body) : await req;
      expect(res.status, `${route.method} ${route.path}`).toBe(404);
    }
  });

  /** A key naming nothing is the same 404 as a key naming somebody else's room. */
  it("an invented room key gets 404, not a hint", async () => {
    const res = await authed(
      request(server()).get("/v1/chat/rooms/group:00000000-0000-4000-8000-000000000000/messages"),
      teacherA,
    );

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sending, reading, and the unread cursor
// ═══════════════════════════════════════════════════════════════════════════

describe("messages", () => {
  it("a teacher and a guardian can talk in the group room", async () => {
    await authed(request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`), teacherA)
      .send({ body: "Маргааш аялалтай шүү." })
      .expect(201);
    await authed(request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`), parentA)
      .send({ body: "Ойлголоо." })
      .expect(201);

    const res = await authed(
      request(server()).get(`/v1/chat/rooms/${groupRoom(a)}/messages`),
      parentA,
    );

    expect(res.status).toBe(200);
    // Newest first — the order the client renders bottom-up from.
    expect(res.body.items.map((m: { body: string }) => m.body)).toEqual([
      "Ойлголоо.",
      "Маргааш аялалтай шүү.",
    ]);
    // `mine` is per reader, not a property of the row.
    expect(res.body.items[0].mine).toBe(true);
    expect(res.body.items[1].mine).toBe(false);
  });

  it("refuses an empty or oversized body", async () => {
    await authed(request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`), teacherA)
      .send({ body: "   " })
      .expect(400);
    await authed(request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`), teacherA)
      .send({ body: "a".repeat(2001) })
      .expect(400);
  });

  /**
   * ★ Sending is reading.
   *
   * The author has by definition seen everything up to their own message, so a
   * cursor left behind would show them an unread badge for what they just
   * typed — the most obviously wrong thing this feature could do.
   */
  it("does not count the sender's own message as unread for them", async () => {
    await authed(request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`), teacherA)
      .send({ body: "сайн уу" })
      .expect(201);

    const mine = await authed(request(server()).get("/v1/chat/unread-count"), teacherA);
    expect(mine.body.count).toBe(0);

    // …while the other side of the room does see it.
    const theirs = await authed(request(server()).get("/v1/chat/unread-count"), parentA);
    expect(theirs.body.count).toBe(1);
  });

  it("clears the count when the room is opened", async () => {
    await authed(request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`), teacherA)
      .send({ body: "сайн уу" })
      .expect(201);

    await authed(request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/read`), parentA).expect(
      204,
    );

    const after = await authed(request(server()).get("/v1/chat/unread-count"), parentA);
    expect(after.body.count).toBe(0);
  });

  /**
   * A room nobody has ever opened counts its whole history — the cursor is
   * absent, not zero, and treating the two the same would hide every message
   * sent before a person first pressed the button.
   */
  it("counts the whole history of a room that has never been opened", async () => {
    for (const body of ["нэг", "хоёр", "гурав"]) {
      await authed(request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`), teacherA)
        .send({ body })
        .expect(201);
    }

    const res = await authed(request(server()).get("/v1/chat/rooms"), parentA);
    expect(res.body[0].unreadCount).toBe(3);
    expect(res.body[0].lastMessage.body).toBe("гурав");
  });
});
