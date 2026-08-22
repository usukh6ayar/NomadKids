import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createUser,
  linkGuardian,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { StorageService } from "../src/storage/storage.service";

/**
 * Media — private R2, authorization before the signed URL, and the rule that a
 * photo attached to a private observation is as private as the observation.
 *
 * Runs against real MinIO. A mocked storage layer would prove the mock works
 * while leaving the actual presigning and the private-bucket assumption
 * untested.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;
let typeId: string;
let storageAvailable = true;

beforeAll(async () => {
  app = await createTestApp();
  storageAvailable = await app.get(StorageService).isReachable();
  if (!storageAvailable) {
    // Loud rather than silently green: a skipped media suite is exactly the
    // kind of thing that hides a real regression.
    console.error(
      "\n⚠ MinIO unreachable — media tests will FAIL.\n  docker compose up -d storage\n",
    );
  }
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

  typeId = (await db.observationType.findFirstOrThrow({ where: { code: "daily" } })).id;
});

const server = () => app.getHttpServer();

async function photoBytes(colour = "red"): Promise<Buffer> {
  return sharp({ create: { width: 48, height: 36, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();
}

/** Uploads a photo for child A and returns the created media id. */
async function upload(
  session = teacherA,
  childId = a.child.id,
  fields: Record<string, string> = {},
) {
  const req = authed(request(server()).post(`/v1/children/${childId}/media`), session).attach(
    "file",
    await photoBytes(),
    "зураг.jpg",
  );
  for (const [key, value] of Object.entries(fields)) void req.field(key, value);

  const res = await req;
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${res.text}`);
  // The endpoint takes a batch and always answers with one, so a single-file
  // upload is a batch of one rather than a special case.
  if (res.body.items.length !== 1) {
    throw new Error(`upload rejected: ${JSON.stringify(res.body.failed)}`);
  }
  return res.body.items[0].id as string;
}

async function teacherObservation(visibleToParents: boolean) {
  const res = await authed(
    request(server()).post(`/v1/children/${a.child.id}/observations`),
    teacherA,
  ).send({ typeId, observedOn: "2026-02-10", situation: "Тэмдэглэл", visibleToParents });
  return res.body.id as string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Upload
// ═══════════════════════════════════════════════════════════════════════════

describe("upload", () => {
  it("accepts a photo and stores metadata, not the bytes", async () => {
    const id = await upload();
    const row = await db.mediaFile.findUniqueOrThrow({ where: { id } });

    expect(row.mimeType).toBe("image/jpeg");
    expect(row.width).toBe(48);
    expect(row.sizeBytes).toBeGreaterThan(0);
    expect(row.childId).toBe(a.child.id);
  });

  it("★ generates a RANDOM storage key containing nothing about the file", async () => {
    const id = await upload();
    const row = await db.mediaFile.findUniqueOrThrow({ where: { id } });

    expect(row.storageKey).toMatch(/^children\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    // The uploaded filename must never appear in the key — a predictable key
    // is a public bucket with extra steps, and the name can identify a child.
    expect(row.storageKey).not.toContain("зураг");
    expect(row.storageKey).not.toContain(".jpg");
  });

  it("keeps the real filename for display only", async () => {
    const id = await upload();
    const row = await db.mediaFile.findUniqueOrThrow({ where: { id } });
    expect(row.originalName).toBe("зураг.jpg");
  });

  it("★ never exposes the storage key in a response", async () => {
    const id = await upload();
    const res = await request(server()).get(`/v1/media/${id}/meta`).set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("children/");
    expect(res.body).not.toHaveProperty("storageKey");
  });

  it("rejects a renamed executable", async () => {
    const machO = Buffer.concat([
      Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]),
      Buffer.alloc(512),
    ]);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/media`),
      teacherA,
    ).attach("file", machO, "innocent.jpg");

    expect(res.status).toBe(400);
  });

  it("rejects a request with no file", async () => {
    const res = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), teacherA);
    expect(res.status).toBe(400);
  });

  it("attaches to an observation about the SAME child only", async () => {
    const observationId = await teacherObservation(false);

    const ok = await upload(teacherA, a.child.id, { observationId });
    expect(await db.mediaFile.findUniqueOrThrow({ where: { id: ok } })).toMatchObject({
      observationId,
    });

    // A valid observation id belonging to another child must not attach.
    const teacherB = await login(app, b.teacherUser.username);
    const foreign = await authed(
      request(server()).post(`/v1/children/${b.child.id}/observations`),
      teacherB,
    ).send({ typeId, observedOn: "2026-02-10", situation: "B" });

    const res = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), teacherA)
      .attach("file", await photoBytes(), "x.jpg")
      .field("observationId", foreign.body.id);

    expect(res.status).toBe(400);
  });

  it("a GUARDIAN cannot upload to the gallery", async () => {
    // Record access is required; a family contributes through their own
    // observation, not straight into the child's photo album.
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/media`),
      parentA,
    ).attach("file", await photoBytes(), "гэрийн.jpg");

    expect(res.status).toBe(404);
  });

  it("cross-kindergarten upload gets 404", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${b.child.id}/media`),
      teacherA,
    ).attach("file", await photoBytes(), "x.jpg");

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Download — the ordering that matters
// ═══════════════════════════════════════════════════════════════════════════

describe("download", () => {
  it("redirects to a presigned URL", async () => {
    const id = await upload();
    const res = await request(server()).get(`/v1/media/${id}`).set("Cookie", teacherA.cookies);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("X-Amz-Signature");
    // Short-lived: the URL is a bearer credential.
    expect(res.headers.location).toContain("X-Amz-Expires=300");
  });

  it("★ the permission check runs BEFORE any URL is generated", async () => {
    // A presigned URL for an unauthorized caller has already leaked the object,
    // even if the response is then discarded. The reference suite names this
    // case explicitly.
    const id = await upload();
    const res = await request(server()).get(`/v1/media/${id}`).set("Cookie", parentB.cookies);

    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).not.toContain("X-Amz-Signature");
  });

  it("an ARCHIVED file is no longer served", async () => {
    const id = await upload();
    await authed(request(server()).delete(`/v1/media/${id}`), teacherA);

    expect(
      (await request(server()).get(`/v1/media/${id}`).set("Cookie", teacherA.cookies)).status,
    ).toBe(404);
  });

  it("an unknown id is indistinguishable from a forbidden one", async () => {
    const forbidden = await request(server())
      .get(`/v1/media/${await upload()}`)
      .set("Cookie", parentB.cookies);
    const missing = await request(server())
      .get("/v1/media/00000000-0000-4000-8000-000000000000")
      .set("Cookie", parentB.cookies);

    expect(forbidden.status).toBe(missing.status);
  });

  it("requires authentication", async () => {
    expect((await request(server()).get(`/v1/media/${await upload()}`)).status).toBe(401);
  });

  it("records a DOWNLOAD audit entry", async () => {
    const id = await upload();
    await request(server()).get(`/v1/media/${id}`).set("Cookie", teacherA.cookies);

    const entry = await db.auditLog.findFirst({ where: { action: "DOWNLOAD", objectId: id } });
    expect(entry?.actorUserId).toBe(a.teacherUser.id);
    expect(entry?.childId).toBe(a.child.id);
  });

  it("the presigned URL actually fetches the object", async () => {
    // Proves the whole path end to end: private bucket, real credentials, real
    // signature. A test that only checks the URL's shape would pass against a
    // bucket that rejects every read.
    const id = await upload();
    const res = await request(server()).get(`/v1/media/${id}`).set("Cookie", teacherA.cookies);

    const fetched = await fetch(res.headers.location as string);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toContain("image/jpeg");
  });

  it("★ the object is NOT reachable without a signature", async () => {
    // The private-bucket assumption, verified rather than assumed.
    const id = await upload();
    const row = await db.mediaFile.findUniqueOrThrow({ where: { id } });

    const direct = await fetch(
      `${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_BUCKET}/${row.storageKey}`,
    );
    expect(direct.status).toBeGreaterThanOrEqual(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A photo inherits its observation's visibility
// ═══════════════════════════════════════════════════════════════════════════

describe("observation photos inherit visibility", () => {
  it("★ a guardian CANNOT fetch a photo on a private observation", async () => {
    // The note stays hidden while its pictures do not is the more embarrassing
    // half of the same leak.
    const observationId = await teacherObservation(false);
    const mediaId = await upload(teacherA, a.child.id, { observationId });

    const res = await request(server()).get(`/v1/media/${mediaId}`).set("Cookie", parentA.cookies);
    expect(res.status).toBe(404);
  });

  it("a guardian CAN fetch a photo on a published observation", async () => {
    const observationId = await teacherObservation(true);
    const mediaId = await upload(teacherA, a.child.id, { observationId });

    const res = await request(server()).get(`/v1/media/${mediaId}`).set("Cookie", parentA.cookies);
    expect(res.status).toBe(302);
  });

  it("the guardian's gallery omits private observation photos", async () => {
    const privateObs = await teacherObservation(false);
    await upload(teacherA, a.child.id, { observationId: privateObs });

    const publicObs = await teacherObservation(true);
    const visibleId = await upload(teacherA, a.child.id, { observationId: publicObs });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/media`)
      .set("Cookie", parentA.cookies);

    expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([visibleId]);
  });

  it("a teacher's gallery shows everything", async () => {
    const privateObs = await teacherObservation(false);
    await upload(teacherA, a.child.id, { observationId: privateObs });
    await upload();

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/media`)
      .set("Cookie", teacherA.cookies);

    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it("metadata is refused for a photo the guardian may not see", async () => {
    // The metadata route must apply the same filter as the download route,
    // or a caption leaks what the photo was about.
    const observationId = await teacherObservation(false);
    const mediaId = await upload(teacherA, a.child.id, { observationId });

    expect(
      (await request(server()).get(`/v1/media/${mediaId}/meta`).set("Cookie", parentA.cookies))
        .status,
    ).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("lifecycle", () => {
  it("a guardian cannot delete a photo", async () => {
    const id = await upload();
    expect((await authed(request(server()).delete(`/v1/media/${id}`), parentA)).status).toBe(404);
  });

  it("archiving is soft — the row survives for recovery", async () => {
    const id = await upload();
    await authed(request(server()).delete(`/v1/media/${id}`), teacherA);

    const row = await db.mediaFile.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("ARCHIVED");
    expect(row.deletedAt).not.toBeNull();
  });

  it("a caption can be set and cleared", async () => {
    const id = await upload();

    await authed(request(server()).patch(`/v1/media/${id}`), teacherA).send({
      caption: "Барилгын буланд",
    });
    const cleared = await authed(request(server()).patch(`/v1/media/${id}`), teacherA).send({
      caption: null,
    });

    expect(cleared.body.caption).toBeNull();
  });

  it("sets a child's profile photo", async () => {
    const id = await upload();
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/media/profile-photo`),
      teacherA,
    ).send({ mediaId: id });

    expect(res.status).toBe(201);
    const child = await db.child.findUniqueOrThrow({ where: { id: a.child.id } });
    expect(child.photoMediaFileId).toBe(id);
  });

  it("refuses another child's photo as a profile photo", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const foreignId = await upload(teacherB, b.child.id);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/media/profile-photo`),
      teacherA,
    ).send({ mediaId: foreignId });

    expect(res.status).toBe(404);
  });

  it("requires CSRF on upload", async () => {
    const res = await request(server())
      .post(`/v1/children/${a.child.id}/media`)
      .set("Cookie", teacherA.cookies)
      .attach("file", await photoBytes(), "x.jpg");

    expect(res.status).toBe(403);
  });
});

describe("revoked access", () => {
  it("a revoked guardian cannot fetch a previously visible photo", async () => {
    const observationId = await teacherObservation(true);
    const mediaId = await upload(teacherA, a.child.id, { observationId });

    expect(
      (await request(server()).get(`/v1/media/${mediaId}`).set("Cookie", parentA.cookies)).status,
    ).toBe(302);

    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: false,
    });

    expect(
      (await request(server()).get(`/v1/media/${mediaId}`).set("Cookie", parentA.cookies)).status,
    ).toBe(404);
  });

  it("a revoked teacher loses access", async () => {
    const mediaId = await upload();
    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    expect(
      (await request(server()).get(`/v1/media/${mediaId}`).set("Cookie", teacherA.cookies)).status,
    ).toBe(404);
  });

  it("a second guardian sees a published photo independently", async () => {
    const father = await createUser({ username: uniq("father") });
    await createMembership(father.id, a.kindergarten.id, "PARENT");
    await linkGuardian(a.kindergarten.id, a.child.id, father.id);
    const fatherSession = await login(app, father.username);

    const observationId = await teacherObservation(true);
    const mediaId = await upload(teacherA, a.child.id, { observationId });

    expect(
      (await request(server()).get(`/v1/media/${mediaId}`).set("Cookie", fatherSession.cookies))
        .status,
    ).toBe(302);
  });
});

/**
 * Batch upload.
 *
 * ★ The reason is the rate limit, not the number of clicks.
 *
 * The browser could already pick a dozen photographs; it sent a dozen requests.
 * At 60 uploads an hour per user, one class-board announcement with twenty
 * photographs spent a third of a teacher's daily budget. One request is one
 * unit.
 */
describe("uploading several photos at once", () => {
  it("stores every file in one request", async () => {
    const res = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), teacherA)
      .attach("file", await photoBytes(), "нэг.jpg")
      .attach("file", await photoBytes(), "хоёр.jpg")
      .attach("file", await photoBytes(), "гурав.jpg");

    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.failed).toHaveLength(0);

    // And they are all really there, not merely acknowledged.
    const list = await authed(request(server()).get(`/v1/children/${a.child.id}/media`), teacherA);
    expect(list.body.items).toHaveLength(3);
  });

  /**
   * ★ One bad file must not discard the good ones.
   *
   * Rolling back would delete photographs a teacher watched upload; failing
   * the whole request would ask them to find the bad one by bisection.
   */
  it("keeps the good files and names the ones it refused", async () => {
    const machO = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(64, 0x41)]);

    const res = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), teacherA)
      .attach("file", await photoBytes(), "сайн.jpg")
      .attach("file", machO, "хортой.jpg")
      .attach("file", await photoBytes(), "бас сайн.jpg");

    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].name).toContain("хортой");
    expect(res.body.failed[0].reason).toBeTruthy();

    const list = await authed(request(server()).get(`/v1/children/${a.child.id}/media`), teacherA);
    expect(list.body.items).toHaveLength(2);
  });

  /** A batch where nothing survived is a failed request, not a 201 with notes. */
  it("answers 400 when every file was refused", async () => {
    const machO = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(64, 0x41)]);

    const res = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), teacherA)
      .attach("file", machO, "нэг.jpg")
      .attach("file", machO, "хоёр.jpg");

    expect(res.status).toBe(400);

    const list = await authed(request(server()).get(`/v1/children/${a.child.id}/media`), teacherA);
    expect(list.body.items).toHaveLength(0);
  });

  /** Authorization is decided once, for the child, before any file is read. */
  it("refuses the whole batch for a teacher from another kindergarten", async () => {
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), teacherB)
      .attach("file", await photoBytes(), "нэг.jpg")
      .attach("file", await photoBytes(), "хоёр.jpg");

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Pagination — CLAUDE.md §3.4
//
// `GET /children/:id/media` was the one list in the API that returned an
// unbounded set. A child with six hundred photographs returned six hundred rows
// and six hundred signed-URL redirects on one screen.
// ═══════════════════════════════════════════════════════════════════════════

describe("gallery pagination", () => {
  it("bounds the page and reports the true total", async () => {
    for (let i = 0; i < 3; i += 1) await upload();

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/media?pageSize=2`),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.totalPages).toBe(2);
  });

  it("refuses a page size above the ceiling", async () => {
    // Without the ceiling `?pageSize=100000` turns the gallery back into the
    // bulk export it just stopped being.
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/media?pageSize=100000`),
      teacherA,
    );
    expect(res.status).toBe(400);
  });

  /**
   * ★★ The regression this whole split exists to prevent.
   *
   * `getDownloadUrl` used to decide whether a guardian may read one file by
   * loading their entire visible set and searching it. Paginating that method
   * would have silently capped the check at one page: a guardian would still
   * SEE photo twenty-six on page two of the gallery, and get a 404 the moment
   * they clicked it. The list and the check now compose the same `where`
   * fragment in the repository, so they cannot disagree.
   */
  it("a guardian can open a visible photo that falls beyond the first page", async () => {
    const observationId = await teacherObservation(true);

    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push(await upload(teacherA, a.child.id, { observationId }));
    }

    // Prove it really is off page one at this size.
    const firstPage = await authed(
      request(server()).get(`/v1/children/${a.child.id}/media?pageSize=2`),
      parentA,
    );
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.total).toBe(4);

    const beyond = ids.filter(
      (id) => !firstPage.body.items.some((m: { id: string }) => m.id === id),
    );
    expect(beyond.length).toBeGreaterThan(0);

    const res = await request(server())
      .get(`/v1/media/${beyond[0]}`)
      .set("Cookie", parentA.cookies);

    expect(res.status).toBe(302);
  });

  /** The visibility rule still holds when the list is paged. */
  it("a guardian still cannot open a private photo on any page", async () => {
    const privateObs = await teacherObservation(false);
    const hidden = await upload(teacherA, a.child.id, { observationId: privateObs });

    expect(
      (await request(server()).get(`/v1/media/${hidden}`).set("Cookie", parentA.cookies)).status,
    ).toBe(404);
  });

  /**
   * ★ `?observationId=` exists because the screen that shows one observation's
   * photos used to fetch the child's whole OBSERVATION set and filter in the
   * browser. Page one of twenty-five may contain none of the ones it wants.
   */
  it("filters to a single observation", async () => {
    const first = await teacherObservation(true);
    const second = await teacherObservation(true);

    const wanted = await upload(teacherA, a.child.id, { observationId: first });
    await upload(teacherA, a.child.id, { observationId: second });
    await upload();

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/media?observationId=${first}`),
      teacherA,
    );

    expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([wanted]);
    expect(res.body.total).toBe(1);
  });

  it("teacher from another group gets 404", async () => {
    const outsider = await login(app, b.teacherUser.username);
    expect(
      (await authed(request(server()).get(`/v1/children/${a.child.id}/media?pageSize=5`), outsider))
        .status,
    ).toBe(404);
  });

  it("guardian of another child gets 404", async () => {
    expect(
      (await authed(request(server()).get(`/v1/children/${a.child.id}/media?pageSize=5`), parentB))
        .status,
    ).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Album metadata — RFP §4.4
// ═══════════════════════════════════════════════════════════════════════════

describe("album metadata", () => {
  it("records who uploaded and attributes by their role", async () => {
    const id = await upload();
    const row = await db.mediaFile.findUniqueOrThrow({ where: { id } });

    expect(row.uploadedById).toBe(a.teacherUser.id);
    expect(row.attribution).toBe("TEACHER");
  });

  /**
   * ★ What the upload schema accepts, the upload must store.
   *
   * These fields were validated by `uploadOptionsSchema` and then dropped on
   * the way to the service: a client could send `takenAt`, receive a 201, and
   * find the column empty. Validation that silently discards what it just
   * approved is worse than not accepting the field at all, and nothing about
   * the response would have revealed it.
   */
  it("stores metadata sent with the upload itself", async () => {
    const id = await upload(teacherA, a.child.id, {
      takenAt: "2026-05-04",
      age: "5",
      category: "EVENT",
      attribution: "PARENT",
    });

    const row = await db.mediaFile.findUniqueOrThrow({ where: { id } });
    expect(row.age).toBe(5);
    expect(row.category).toBe("EVENT");
    expect(row.attribution).toBe("PARENT");
    expect(row.takenAt?.toISOString()).toContain("2026-05-04");
  });

  it("takes the date the photograph was taken, the age and the category", async () => {
    const id = await upload();

    const res = await authed(request(server()).patch(`/v1/media/${id}`), teacherA).send({
      takenAt: "2026-03-01",
      age: 4,
      category: "ARTWORK",
      attribution: "JOINT",
    });

    expect(res.status).toBe(200);
    expect(res.body.age).toBe(4);
    expect(res.body.category).toBe("ARTWORK");
    expect(res.body.attribution).toBe("JOINT");
    expect(String(res.body.takenAt)).toContain("2026-03-01");
  });

  /**
   * ★ A PATCH naming only the caption must not blank the rest.
   *
   * `undefined` leaves a field alone and `null` clears it. Collapsing the two
   * would make every caption edit quietly erase the date a photograph was
   * taken — a data loss nobody would report, because nothing tells them.
   */
  it("editing the caption leaves the other metadata alone", async () => {
    const id = await upload();
    await authed(request(server()).patch(`/v1/media/${id}`), teacherA).send({
      takenAt: "2026-03-01",
      category: "ARTWORK",
    });

    const res = await authed(request(server()).patch(`/v1/media/${id}`), teacherA).send({
      caption: "Шинэ тэмдэглэл",
    });

    expect(res.body.caption).toBe("Шинэ тэмдэглэл");
    expect(res.body.category).toBe("ARTWORK");
    expect(String(res.body.takenAt)).toContain("2026-03-01");
  });

  it("refuses a category outside the vocabulary", async () => {
    const id = await upload();
    const res = await authed(request(server()).patch(`/v1/media/${id}`), teacherA).send({
      category: "WHATEVER",
    });
    expect(res.status).toBe(400);
  });

  it("a guardian cannot retitle or re-date the gallery", async () => {
    const id = await upload();
    expect(
      (await authed(request(server()).patch(`/v1/media/${id}`), parentA).send({ age: 3 })).status,
    ).toBe(404);
  });
});
