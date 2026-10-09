import type { INestApplication } from "@nestjs/common";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ChatMediaRetentionService } from "../src/chat/chat-media-retention.service";
import { ChatVideoProcessor } from "../src/chat/chat-video.processor";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { StorageService } from "../src/storage/storage.service";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";

/**
 * Chat video and the seven-day life of chat attachments — the user,
 * 2026-10-09: "video upload hiihed jijigruuldeg … tegeed automataar ustah".
 *
 * One case per rule: the room authorises the video (§4.1's three), the type
 * comes from the content (§1.6), the raw original is never served and the
 * stored one carries no location (§1.6), and attachments expire while the
 * message stays.
 */

let app: INestApplication;
const db = testDb();
let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let parentA: AuthSession;
let teacherB: AuthSession;
let parentB: AuthSession;

const server = () => app.getHttpServer();
const groupRoom = (s: Scenario) => `group:${s.group.id}`;
const DAY = 24 * 60 * 60 * 1000;

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** A one-second QuickTime file with a GPS tag, as a phone would send it. */
let phoneVideo: Buffer = Buffer.alloc(0);
const GPS_MARKER = "+47.9184+106.9177";

beforeAll(async () => {
  app = await createTestApp();
  if (hasFfmpeg) {
    const dir = mkdtempSync(join(tmpdir(), "chat-video-test-"));
    const file = join(dir, "phone.mov");
    execFileSync("ffmpeg", [
      ...["-hide_banner", "-loglevel", "error", "-y"],
      ...["-f", "lavfi", "-i", "testsrc=size=640x360:rate=30"],
      ...["-f", "lavfi", "-i", "sine=frequency=440"],
      ...["-t", "1", "-metadata", `location=${GPS_MARKER}/`],
      ...["-c:v", "libx264", "-c:a", "aac", "-f", "mov", file],
    ]);
    phoneVideo = readFileSync(file);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData(db);
  await app.get(RateLimitService).resetAll();
  a = await createScenario("a");
  b = await createScenario("b");
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  teacherB = await login(app, b.teacherUser.username);
  parentB = await login(app, b.parentUser.username);
});

async function sendVideo(session: AuthSession, room: string, bytes: Buffer, name = "phone.mov") {
  return authed(request(server()).post(`/v1/chat/rooms/${room}/videos`), session)
    .field("body", "өнөөдрийн бүжиг")
    .attach("video", bytes, name);
}

describe.skipIf(!hasFfmpeg)("chat video", () => {
  it("holds the raw upload back, then serves a stripped 720p MP4", async () => {
    const res = await sendVideo(teacherA, groupRoom(a), phoneVideo);
    expect(res.status).toBe(201);
    expect(res.body.media).toEqual([expect.objectContaining({ status: "PROCESSING" })]);
    const mediaId = res.body.media[0].id as string;

    // The phone's original, location and all, is never served.
    await authed(request(server()).get(`/v1/media/${mediaId}`), parentA).expect(404);

    expect(await app.get(ChatVideoProcessor).run(mediaId)).toBe("ready");

    const stored = await db.mediaFile.findUniqueOrThrow({ where: { id: mediaId } });
    expect(stored).toMatchObject({ status: "READY", mimeType: "video/mp4", durationSec: 1 });
    const bytes = await app.get(StorageService).get(stored.storageKey);
    expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(bytes.includes(Buffer.from(GPS_MARKER))).toBe(false);

    const asParent = await authed(request(server()).get(`/v1/media/${mediaId}`), parentA);
    expect(asParent.status).toBe(302);
  });

  it("teacher from another kindergarten gets 404 sending to the room", async () => {
    const res = await sendVideo(teacherB, groupRoom(a), phoneVideo);
    expect(res.status).toBe(404);
    expect(await db.mediaFile.count({ where: { purpose: "CHAT_MESSAGE" } })).toBe(0);
  });

  it("guardian of another child and a user of another kindergarten get 404 on the video", async () => {
    const res = await sendVideo(teacherA, groupRoom(a), phoneVideo);
    const mediaId = res.body.media[0].id as string;
    await app.get(ChatVideoProcessor).run(mediaId);

    await authed(request(server()).get(`/v1/media/${mediaId}`), parentB).expect(404);
    await authed(request(server()).get(`/v1/media/${mediaId}`), teacherB).expect(404);
  });
});

describe("chat video type", () => {
  it("refuses a document renamed .mp4", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512)]);
    const res = await sendVideo(teacherA, groupRoom(a), pdf, "бүжиг.mp4");
    expect(res.status).toBe(400);
    expect(await db.mediaFile.count({ where: { purpose: "CHAT_MESSAGE" } })).toBe(0);
  });
});

describe("chat attachment retention", () => {
  it("removes a photograph after seven days and keeps the message", async () => {
    const photo = await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } })
      .jpeg()
      .toBuffer();
    const sent = async () => {
      const res = await authed(
        request(server()).post(`/v1/chat/rooms/${groupRoom(a)}/messages`),
        teacherA,
      )
        .field("body", "зурагтай мессеж")
        .attach("images", photo, "зураг.jpg");
      expect(res.status).toBe(201);
      return res.body.media[0].id as string;
    };
    const old = await sent();
    const recent = await sent();
    await db.mediaFile.update({
      where: { id: old },
      data: { createdAt: new Date(Date.now() - 8 * DAY) },
    });
    await db.mediaFile.update({
      where: { id: recent },
      data: { createdAt: new Date(Date.now() - 6 * DAY) },
    });
    const oldKey = (await db.mediaFile.findUniqueOrThrow({ where: { id: old } })).storageKey;

    expect((await app.get(ChatMediaRetentionService).sweep()).expired).toBe(1);

    await expect(app.get(StorageService).get(oldKey)).rejects.toThrow();
    await authed(request(server()).get(`/v1/media/${old}`), parentA).expect(404);
    await authed(request(server()).get(`/v1/media/${recent}`), parentA).expect(302);

    const history = await authed(
      request(server()).get(`/v1/chat/rooms/${groupRoom(a)}/messages`),
      parentA,
    );
    const byExpired = history.body.items.map((m: { expiredMedia: number; media: unknown[] }) => [
      m.expiredMedia,
      m.media.length,
    ]);
    expect(byExpired.sort()).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(history.body.items.every((m: { body: string }) => m.body === "зурагтай мессеж")).toBe(
      true,
    );
  });
});
