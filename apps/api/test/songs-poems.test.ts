import type { INestApplication } from "@nestjs/common";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
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
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Дуу, шүлэг — a group's library by month (#195, 2026-10-11).
 *
 * What is pinned: the group's teacher writes and the director reads; a family
 * reads the library of their child's group and its files; another group, its
 * families and another kindergarten get 404 (CLAUDE.md §1.7, §4.1); a file is
 * judged by its bytes; an edit keeps the parts it did not replace.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let teacherA: AuthSession;
let adminA: AuthSession;
let parentA: AuthSession;
let teacherB: AuthSession;
let parentB: AuthSession;
let other: { groupId: string; childId: string; teacher: AuthSession; parent: AuthSession };

let COVER: Buffer;
const MP3 = Buffer.concat([Buffer.from("ID3\x04\x00", "latin1"), Buffer.alloc(256)]);

const server = () => app.getHttpServer();
const groupUrl = (groupId: string, rest = "") => `/v1/groups/${groupId}/songs-poems${rest}`;

beforeAll(async () => {
  app = await createTestApp();
  COVER = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#fc0" } })
    .png()
    .toBuffer();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  const b = await createScenario("b");

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

const get = (session: AuthSession, url: string) =>
  authed(request(server()).get(url), session).redirects(0);

function send(
  method: "post" | "put",
  url: string,
  session: AuthSession,
  parts: { title?: string; cover?: Buffer; file?: [Buffer, string] } = {},
) {
  let req = authed(request(server())[method](url), session)
    .field("month", "10")
    .field("type", "song")
    .field("title", parts.title ?? "Алтан намар")
    .field("description", "Навчны өнгийг хөдөлгөөнөөр дүрслэн дуулна.");
  if (parts.cover) req = req.attach("cover", parts.cover, "намар.png");
  if (parts.file) req = req.attach("file", parts.file[0], parts.file[1]);
  return req;
}

async function createSong(groupId = a.group.id, session = teacherA) {
  const res = await send("post", groupUrl(groupId), session, {
    cover: COVER,
    file: [MP3, "алтан-намар.mp3"],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; coverUrl: string; fileUrl: string };
}

describe("the group's library", () => {
  it("the teacher adds a song with a cover and its audio; files are API paths", async () => {
    const song = await createSong();
    expect(song).toMatchObject({
      month: "10",
      type: "song",
      title: "Алтан намар",
      coverUrl: `/songs-poems/${song.id}/cover`,
      fileUrl: `/songs-poems/${song.id}/file`,
      fileName: "алтан-намар.mp3",
      fileType: "audio/mpeg",
    });

    const library = await get(adminA, groupUrl(a.group.id));
    expect(library.status).toBe(200);
    expect(library.body.group).toEqual({ id: a.group.id, name: a.group.name });
    expect(library.body.items).toHaveLength(1);
  });

  it("the teacher renames a month's book", async () => {
    const res = await authed(
      request(server()).put(groupUrl(a.group.id, "/months/10")),
      teacherA,
    ).send({ label: "Намар", subtitle: "Шар навч" });
    expect(res.status).toBe(200);
    const library = await get(teacherA, groupUrl(a.group.id));
    expect(library.body.months).toEqual([{ month: "10", label: "Намар", subtitle: "Шар навч" }]);
  });

  // ★ №21 (2026-10-16): the director writes to a group's library too.
  it("the director writes to a group's library", async () => {
    expect((await send("post", groupUrl(a.group.id), adminA)).status).toBe(201);
    expect(await db.songPoem.count()).toBe(1);
  });

  it("keeps a song's web link, and refuses one that is not http(s) — №21", async () => {
    const ok = await send("post", groupUrl(a.group.id), teacherA).field(
      "linkUrl",
      "https://www.youtube.com/watch?v=abc",
    );
    expect(ok.status).toBe(201);
    expect(ok.body.linkUrl).toBe("https://www.youtube.com/watch?v=abc");

    const bad = await send("post", groupUrl(a.group.id), teacherA).field(
      "linkUrl",
      "javascript:alert(1)",
    );
    expect(bad.status).toBe(400);

    // The form is a full replace: an edit without the link clears it.
    const edited = await send("put", `${groupUrl(a.group.id)}/${ok.body.id}`, teacherA);
    expect(edited.status).toBe(200);
    expect(edited.body.linkUrl).toBeNull();
  });

  it("teacher from another group gets 404, reading or writing", async () => {
    expect((await get(other.teacher, groupUrl(a.group.id))).status).toBe(404);
    expect((await send("post", groupUrl(a.group.id), other.teacher)).status).toBe(404);
    expect(await db.songPoem.count()).toBe(0);
  });

  it("user from another kindergarten gets 404", async () => {
    expect((await get(teacherB, groupUrl(a.group.id))).status).toBe(404);
  });

  it("judges an attachment by its bytes", async () => {
    const elf = Buffer.concat([Buffer.from("\x7fELF", "latin1"), Buffer.alloc(64)]);
    const res = await send("post", groupUrl(a.group.id), teacherA, { file: [elf, "дуу.mp3"] });
    expect(res.status).toBe(400);
    expect(await db.songPoem.count()).toBe(0);
  });

  it("an edit without files keeps them; a new file replaces the old", async () => {
    const song = await createSong();
    const before = await db.songPoem.findUniqueOrThrow({ where: { id: song.id } });

    const edit = await send("put", groupUrl(a.group.id, `/${song.id}`), teacherA, {
      title: "Шинэ нэр",
    });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ title: "Шинэ нэр", fileName: "алтан-намар.mp3" });
    const kept = await db.songPoem.findUniqueOrThrow({ where: { id: song.id } });
    expect(kept.coverKey).toBe(before.coverKey);
    expect(kept.fileKey).toBe(before.fileKey);

    const pdf = Buffer.from("%PDF-1.7\n", "latin1");
    const replaced = await send("put", groupUrl(a.group.id, `/${song.id}`), teacherA, {
      file: [pdf, "үг.pdf"],
    });
    expect(replaced.body).toMatchObject({ fileName: "үг.pdf", fileType: "application/pdf" });
    expect(replaced.body.coverUrl).not.toBeNull();
  });

  it("a removed item leaves the library, and its files with it", async () => {
    const song = await createSong();
    const res = await authed(
      request(server()).delete(groupUrl(a.group.id, `/${song.id}`)),
      teacherA,
    );
    expect(res.status).toBe(204);
    expect((await get(teacherA, groupUrl(a.group.id))).body.items).toEqual([]);
    expect((await get(parentA, `/v1${song.fileUrl}`)).status).toBe(404);
    expect(
      (await db.songPoem.findUniqueOrThrow({ where: { id: song.id } })).deletedAt,
    ).not.toBeNull();
  });
});

describe("GET /children/:id/songs-poems", () => {
  it("the family reads their child's group library", async () => {
    await createSong();
    await createSong(other.groupId, other.teacher);
    const res = await get(parentA, `/v1/children/${a.child.id}/songs-poems`);
    expect(res.status).toBe(200);
    expect(res.body.group.id).toBe(a.group.id);
    expect(res.body.items).toHaveLength(1);
  });

  it("guardian of another child gets 404", async () => {
    expect((await get(other.parent, `/v1/children/${a.child.id}/songs-poems`)).status).toBe(404);
  });

  it("teacher from another group gets 404", async () => {
    expect((await get(other.teacher, `/v1/children/${a.child.id}/songs-poems`)).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    expect((await get(parentB, `/v1/children/${a.child.id}/songs-poems`)).status).toBe(404);
  });
});

describe("covers and files", () => {
  it("open to the group's staff and its families, as a redirect", async () => {
    const song = await createSong();
    for (const session of [teacherA, adminA, parentA]) {
      const res = await get(session, `/v1${song.coverUrl}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("X-Amz-Signature");
    }
    expect((await get(parentA, `/v1${song.fileUrl}`)).status).toBe(302);
  });

  it("closed to another group's family and teacher, and to another kindergarten", async () => {
    const song = await createSong();
    for (const session of [other.parent, other.teacher, parentB, teacherB]) {
      expect((await get(session, `/v1${song.fileUrl}`)).status).toBe(404);
    }
  });
});
