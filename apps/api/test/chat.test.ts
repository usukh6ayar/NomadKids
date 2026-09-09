import type { INestApplication } from "@nestjs/common";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { StorageService } from "../src/storage/storage.service";

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
  await app.get(RateLimitService).resetAll();
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

// ═══════════════════════════════════════════════════════════════════════════
// Photographs — 2026-09-09
//
// ★ The client asked for images and video, then withdrew video the same day:
// "бичлэг ороохыг болиулъя. зураг оруулдаг байхад болно."
//
// ★★ The §4.1 three are repeated here **on the image**, not only on the
// message, and that repetition is the point of this block. A chat photograph
// is authorised by the ROOM, through `ChatAccessService`, because the tempting
// shortcut — adding `CHAT_MESSAGE` to `TENANT_IMAGE_PURPOSES` — would make it
// readable by anyone holding a membership in the kindergarten. A guardian
// whose child is in group A holds one. These cases are what fails if somebody
// later moves the purpose into that set.
// ═══════════════════════════════════════════════════════════════════════════

/** A real JPEG, small. Content is what the validator reads, never the name. */
async function chatPhoto(colour = "red", size = 48): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();
}

/** Posts a message with one photograph and returns its media id. */
async function sendPhoto(session: AuthSession, room: string, body = "зураг"): Promise<string> {
  const res = await authed(request(server()).post(`/v1/chat/rooms/${room}/messages`), session)
    .field("body", body)
    .attach("images", await chatPhoto(), "зураг.jpg");

  expect(res.status).toBe(201);
  expect(res.body.media).toHaveLength(1);
  return res.body.media[0].id as string;
}

describe("chat photographs", () => {
  it("carries a photograph on a message, and gives it back with the history", async () => {
    const mediaId = await sendPhoto(teacherA, groupRoom(a), "өнөөдрийн хичээл");

    const res = await authed(
      request(server()).get(`/v1/chat/rooms/${groupRoom(a)}/messages`),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body.items[0].body).toBe("өнөөдрийн хичээл");
    expect(res.body.items[0].media).toEqual([
      { id: mediaId, width: expect.any(Number), height: expect.any(Number) },
    ]);
  });

  it("lets a photograph travel with no text at all", async () => {
    const res = await authed(
      request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`),
      teacherA,
    ).attach("images", await chatPhoto(), "ганц.jpg");

    expect(res.status).toBe(201);
    expect(res.body.body).toBe("");
    expect(res.body.media).toHaveLength(1);
  });

  it("still refuses a message with neither text nor a photograph", async () => {
    await authed(request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`), teacherA)
      .field("body", "   ")
      .expect(400);
  });

  it("accepts four photographs in attachment order, and refuses a fifth", async () => {
    const four = authed(
      request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`),
      teacherA,
    );
    for (const name of ["нэг", "хоёр", "гурав", "дөрөв"]) {
      four.attach("images", await chatPhoto(), `${name}.jpg`);
    }
    const ok = await four;
    expect(ok.status).toBe(201);
    expect(ok.body.media).toHaveLength(4);

    const five = authed(
      request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`),
      teacherA,
    );
    for (const name of ["1", "2", "3", "4", "5"]) {
      five.attach("images", await chatPhoto(), `${name}.jpg`);
    }
    const tooMany = await five;
    expect(tooMany.status).toBeGreaterThanOrEqual(400);
  });

  /*
   * ★ The type comes from the CONTENT (§1.6). A Mach-O executable named
   * `.jpg` is the same probe `media.test.ts` uses, and it must be refused here
   * for the same reason — a browser asked to render it may do something other
   * than display a picture.
   */
  it("refuses a renamed executable", async () => {
    const machO = Buffer.concat([
      Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]),
      Buffer.alloc(512),
    ]);

    const res = await authed(
      request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`),
      teacherA,
    ).attach("images", machO, "гэмгүй.jpg");

    expect(res.status).toBe(400);
  });

  /*
   * ★ "зураг нь гэхдээ бага хэмжээтэй" — the client. A chat photograph is
   * bounded at 1280px, not the album's 2000px, so this asserts the *chat*
   * number rather than that some resize happened.
   */
  it("stores a large photograph at the chat's own smaller size", async () => {
    const res = await authed(
      request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`),
      teacherA,
    ).attach("images", await chatPhoto("blue", 2400), "том.jpg");

    expect(res.status).toBe(201);
    expect(res.body.media[0].width).toBe(1280);

    const stored = await db.mediaFile.findFirstOrThrow({
      where: { id: res.body.media[0].id as string },
    });
    expect(stored.purpose).toBe("CHAT_MESSAGE");
    // Small enough to be worth sending over mobile data.
    expect(stored.sizeBytes).toBeLessThan(400_000);
  });

  /*
   * ★ The EXIF strip, asserted on the STORED BYTES — §1.6.
   *
   * This is the property that matters most and is the easiest to lose. A
   * classroom photograph off a phone carries the kindergarten's GPS
   * coordinates and the moment it was taken; a chat is the one place in this
   * product where a parent can forward that on. The strip is not a step of its
   * own — it is a consequence of re-encoding through sharp — which is exactly
   * why it needs a test: a future "skip the re-encode when the image is
   * already small enough" optimisation would silently undo it.
   */
  it("strips EXIF from a photograph before storing it", async () => {
    const withExif = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "green" },
    })
      .withExif({ IFD0: { Make: "NOMADKIDS-CAMERA", Software: "SECRET-LOCATION" } })
      .jpeg()
      .toBuffer();

    // The marker really is in the bytes we are about to send.
    expect(withExif.includes(Buffer.from("NOMADKIDS-CAMERA"))).toBe(true);

    const res = await authed(
      request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`),
      teacherA,
    ).attach("images", withExif, "gps.jpg");

    expect(res.status).toBe(201);

    const stored = await db.mediaFile.findFirstOrThrow({
      where: { id: res.body.media[0].id as string },
    });
    const bytes = await app.get(StorageService).get(stored.storageKey);

    expect(bytes.includes(Buffer.from("NOMADKIDS-CAMERA"))).toBe(false);
    expect(bytes.includes(Buffer.from("SECRET-LOCATION"))).toBe(false);
  });

  // ── The §4.1 three, on the image ──────────────────────────────────────────

  it("teacher from another kindergarten gets 404 on the photograph", async () => {
    const mediaId = await sendPhoto(teacherA, groupRoom(a));

    const res = await authed(request(server()).get(`/v1/media/${mediaId}`), teacherB);
    expect(res.status).toBe(404);
  });

  it("guardian of another child gets 404 on the photograph", async () => {
    const mediaId = await sendPhoto(teacherA, groupRoom(a));

    const res = await authed(request(server()).get(`/v1/media/${mediaId}`), parentB);
    expect(res.status).toBe(404);
  });

  /*
   * ★ The case the tenant-image shortcut would have broken. This guardian is
   * in the SAME kindergarten as the photograph and holds a live membership —
   * `assertMember` would pass. They are not in the staff room, so they must
   * still get 404.
   */
  it("guardian of this kindergarten gets 404 on a staff-room photograph", async () => {
    const mediaId = await sendPhoto(teacherA, staffRoom(a));

    const res = await authed(request(server()).get(`/v1/media/${mediaId}`), parentA);
    expect(res.status).toBe(404);
  });

  it("a member of the room is redirected to the file", async () => {
    const mediaId = await sendPhoto(teacherA, groupRoom(a));

    const res = await authed(request(server()).get(`/v1/media/${mediaId}`), parentA);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("http");
  });

  /*
   * A soft-deleted message takes its photographs out of reach. Nothing in the
   * product deletes a chat message yet, which is exactly why this is asserted
   * now rather than discovered later.
   */
  it("stops serving a photograph whose message was deleted", async () => {
    const mediaId = await sendPhoto(teacherA, groupRoom(a));

    await db.chatMessage.updateMany({ where: {}, data: { deletedAt: new Date() } });

    const res = await authed(request(server()).get(`/v1/media/${mediaId}`), parentA);
    expect(res.status).toBe(404);
  });
});
