import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { StorageService } from "../src/storage/storage.service";

/**
 * Artwork development comparison — RFP §5.3.
 *
 * The behaviour worth pinning is the ordering: a teacher sends two ids and no
 * labels, and the **service** decides which work came first. Storing the
 * caller's order would let a comparison read as development running backwards,
 * with the sentence "хожим нь илүү нарийн" sitting under the earlier drawing.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;

const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp();
  if (!(await app.get(StorageService).isReachable())) {
    console.error("\n⚠ MinIO unreachable — artwork tests will FAIL.\n");
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

async function artworkBytes(colour = "orange"): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();
}

/** Uploads one artwork photograph with a date, and returns its media id. */
async function uploadArtwork(childId: string, takenAt: string, session = teacherA) {
  const res = await authed(request(server()).post(`/v1/children/${childId}/media`), session)
    .field("category", "ARTWORK")
    .field("takenAt", takenAt)
    .attach("file", await artworkBytes(), "зураг.jpg");

  expect(res.status).toBe(201);
  return res.body.items[0].id as string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  it("a teacher from another kindergarten gets 404 on the timeline", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/artwork`), teacherB);
    expect(res.status).toBe(404);
  });

  it("a guardian of another child gets 404", async () => {
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/artwork`), parentB);
    expect(res.status).toBe(404);
  });

  /**
   * ★ A family reads the timeline — watching the drawings improve is the point
   * of keeping them — but the conclusion is a teacher's professional judgement
   * and appears in the report under their name.
   */
  it("a guardian reads the timeline but cannot write a conclusion", async () => {
    const first = await uploadArtwork(a.child.id, "2025-01-10");
    const second = await uploadArtwork(a.child.id, "2025-06-10");

    expect(
      (await authed(request(server()).get(`/v1/children/${a.child.id}/artwork`), parentA)).status,
    ).toBe(200);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/artwork/comparisons`),
      parentA,
    ).send({ mediaIdA: first, mediaIdB: second, conclusion: "Сайжирсан" });

    expect(res.status).toBe(404);
    expect(await db.artworkComparison.count()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The timeline — RFP §5.3's "хугацааны дарааллаар"
// ═══════════════════════════════════════════════════════════════════════════

describe("the timeline", () => {
  /**
   * ★ Ordered by when the work was *made*, not when it was filed.
   *
   * The gallery leads with the hand-arranged `order` column, which is right
   * there and wrong here: a development sequence read in upload order tells you
   * about the teacher's filing, not about the child. So these are uploaded in
   * reverse date order deliberately.
   */
  it("returns artwork oldest first, by the date the work was made", async () => {
    const later = await uploadArtwork(a.child.id, "2025-06-10");
    const earlier = await uploadArtwork(a.child.id, "2025-01-10");

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/artwork`), teacherA);
    const ids = (res.body.artwork as { id: string }[]).map((m) => m.id);

    expect(ids).toEqual([earlier, later]);
  });

  it("shows only artwork, not every photograph of the child", async () => {
    await uploadArtwork(a.child.id, "2025-01-10");
    await authed(request(server()).post(`/v1/children/${a.child.id}/media`), teacherA)
      .field("category", "PORTRAIT")
      .attach("file", await artworkBytes("blue"), "хөрөг.jpg");

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/artwork`), teacherA);
    expect(res.body.artwork).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Comparing
// ═══════════════════════════════════════════════════════════════════════════

describe("comparing two works", () => {
  it("stores the pair and the conclusion", async () => {
    const earlier = await uploadArtwork(a.child.id, "2025-01-10");
    const later = await uploadArtwork(a.child.id, "2025-06-10");

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/artwork/comparisons`),
      teacherA,
    ).send({
      mediaIdA: earlier,
      mediaIdB: later,
      conclusion: "Хожим нь хүнийг зурахдаа гар, хөлийг тусад нь зурсан.",
    });

    expect(res.status).toBe(201);
    expect(res.body.earlierMedia.id).toBe(earlier);
    expect(res.body.laterMedia.id).toBe(later);
    expect(res.body.author.id).toBe(a.teacherUser.id);
  });

  /**
   * ★★ The order is the service's decision, and this is the assertion that
   * pins it. Sent backwards on purpose: without the sort, the stored row would
   * put the June drawing first and the conclusion about improvement would sit
   * under the January one.
   */
  it("orders the pair by date even when the caller sends them backwards", async () => {
    const earlier = await uploadArtwork(a.child.id, "2025-01-10");
    const later = await uploadArtwork(a.child.id, "2025-06-10");

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/artwork/comparisons`),
      teacherA,
    ).send({ mediaIdA: later, mediaIdB: earlier, conclusion: "Ахисан." });

    expect(res.status).toBe(201);
    expect(res.body.earlierMedia.id).toBe(earlier);
    expect(res.body.laterMedia.id).toBe(later);
  });

  it("refuses a comparison of a work with itself", async () => {
    const only = await uploadArtwork(a.child.id, "2025-01-10");
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/artwork/comparisons`),
      teacherA,
    ).send({ mediaIdA: only, mediaIdB: only, conclusion: "Ахисан." });
    expect(res.status).toBe(400);
  });

  /**
   * ★★★ A valid id from another child must not pair into this child's record.
   */
  it("refuses a work belonging to another child", async () => {
    const mine = await uploadArtwork(a.child.id, "2025-01-10");
    const teacherB = await login(app, b.teacherUser.username);
    const theirs = await uploadArtwork(b.child.id, "2025-06-10", teacherB);

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/artwork/comparisons`),
      teacherA,
    ).send({ mediaIdA: mine, mediaIdB: theirs, conclusion: "Ахисан." });

    expect(res.status).toBe(400);
    expect(await db.artworkComparison.count()).toBe(0);
  });

  it("refuses an empty conclusion — the sentence is the feature", async () => {
    const earlier = await uploadArtwork(a.child.id, "2025-01-10");
    const later = await uploadArtwork(a.child.id, "2025-06-10");

    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/artwork/comparisons`),
      teacherA,
    ).send({ mediaIdA: earlier, mediaIdB: later, conclusion: "   " });
    expect(res.status).toBe(400);
  });

  it("the family reads the comparison once it exists", async () => {
    const earlier = await uploadArtwork(a.child.id, "2025-01-10");
    const later = await uploadArtwork(a.child.id, "2025-06-10");
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/artwork/comparisons`),
      teacherA,
    ).send({ mediaIdA: earlier, mediaIdB: later, conclusion: "Ахисан." });

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/artwork`), parentA);
    expect(res.body.comparisons).toHaveLength(1);
    expect(res.body.comparisons[0].conclusion).toBe("Ахисан.");
  });

  it("soft-deletes rather than removing the row", async () => {
    const earlier = await uploadArtwork(a.child.id, "2025-01-10");
    const later = await uploadArtwork(a.child.id, "2025-06-10");
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/artwork/comparisons`),
      teacherA,
    ).send({ mediaIdA: earlier, mediaIdB: later, conclusion: "Ахисан." });

    await authed(request(server()).delete(`/v1/artwork-comparisons/${created.body.id}`), teacherA);

    const row = await db.artworkComparison.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.deletedAt).not.toBeNull();
  });
});
