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
 * Milestones — RFP §4.5, "Онцгой үйл явдал".
 *
 * The behaviours worth pinning: a **guardian records** (this is their memory,
 * not a teacher's record), a guardian may edit only **their own**, and a
 * milestone photograph is visible to the family that added it — which the
 * guardian visibility predicate does not do for free.
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

async function create(session: AuthSession, childId: string, body: Record<string, unknown>) {
  return authed(request(server()).post(`/v1/children/${childId}/milestones`), session).send(body);
}

const FIRST_STEP = {
  kind: "FIRST_STEP",
  occurredOn: "2024-03-15",
  description: "Гэрийн ширээнээс тавилга хүртэл гурван алхам.",
};

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  it("a teacher from another kindergarten gets 404", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/milestones`),
      teacherB,
    );
    expect(res.status).toBe(404);
  });

  it("a guardian of another child gets 404", async () => {
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/milestones`),
      parentB,
    );
    expect(res.status).toBe(404);
  });

  it("a user from another kindergarten cannot create", async () => {
    const res = await create(parentB, a.child.id, FIRST_STEP);
    expect(res.status).toBe(404);
    expect(await db.milestone.count({ where: { childId: a.child.id } })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recording — RFP §4.5
// ═══════════════════════════════════════════════════════════════════════════

describe("recording", () => {
  /**
   * ★ The feature exists for families. RFP §2.3 lists "Хүүхдийн онцгой үйл
   * явдал, milestone бүртгэх" among what a parent does, so this uses the
   * album's predicate rather than the staff-only check that governs
   * observations.
   */
  it("a guardian records one", async () => {
    const res = await create(parentA, a.child.id, FIRST_STEP);

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("FIRST_STEP");

    const row = await db.milestone.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.recordedById).toBe(a.parentUser.id);
  });

  it("a teacher records one too", async () => {
    const res = await create(teacherA, a.child.id, FIRST_STEP);
    expect(res.status).toBe(201);
  });

  /** RFP §4.5 — "хэрэглэгчийн өөрөө үүсгэсэн үйл явдал". */
  it("accepts a custom event with the family's own name for it", async () => {
    const res = await create(parentA, a.child.id, {
      kind: "CUSTOM",
      title: "Анх морь унасан",
      occurredOn: "2025-07-11",
    });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Анх морь унасан");
  });

  /**
   * ★★ A CUSTOM milestone with no title renders as the generic label and tells
   * the family nothing about their own memory.
   */
  it("refuses a custom event with no name", async () => {
    const res = await create(parentA, a.child.id, { kind: "CUSTOM", occurredOn: "2025-07-11" });
    expect(res.status).toBe(400);
  });

  it("refuses an unknown kind", async () => {
    const res = await create(parentA, a.child.id, {
      kind: "FIRST_MARATHON",
      occurredOn: "2025-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("refuses a future date", async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const res = await create(parentA, a.child.id, {
      kind: "FIRST_WORD",
      occurredOn: tomorrow.toISOString().slice(0, 10),
    });
    expect(res.status).toBe(400);
  });

  /**
   * ★★★ No unique constraint on (childId, kind), deliberately: a child has one
   * first step, but "анх тайзан дээр гарсан" happens again every year.
   */
  it("allows the same kind twice", async () => {
    await create(parentA, a.child.id, { kind: "FIRST_TIME_ON_STAGE", occurredOn: "2024-05-01" });
    const second = await create(parentA, a.child.id, {
      kind: "FIRST_TIME_ON_STAGE",
      occurredOn: "2025-05-01",
    });

    expect(second.status).toBe(201);
    expect(await db.milestone.count({ where: { childId: a.child.id, deletedAt: null } })).toBe(2);
  });

  it("lists newest first — a timeline, not an insertion order", async () => {
    await create(parentA, a.child.id, { kind: "FIRST_WORD", occurredOn: "2023-01-01" });
    await create(parentA, a.child.id, { kind: "FIRST_STEP", occurredOn: "2025-01-01" });

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/milestones`),
      parentA,
    );
    expect(res.body[0].occurredOn.slice(0, 10)).toBe("2025-01-01");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Editing — whose memory is it
// ═══════════════════════════════════════════════════════════════════════════

describe("editing", () => {
  /**
   * ★ A guardian may correct their own and not another guardian's.
   *
   * Without the author check, either parent could silently rewrite what the
   * other wrote — the sort of thing that surfaces during a custody dispute.
   * 404, not 403: which milestones exist is not something to confirm.
   */
  it("a second guardian cannot edit the first one's milestone", async () => {
    const created = await create(parentA, a.child.id, FIRST_STEP);

    const otherGuardian = await db.user.create({
      data: {
        username: `other-guardian-${Date.now()}`,
        passwordHash: a.parentUser.passwordHash,
        lastName: "Хоёр",
        firstName: "Асран",
      },
    });
    await db.membership.create({
      data: { userId: otherGuardian.id, kindergartenId: a.kindergarten.id, role: "PARENT" },
    });
    await db.guardianship.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        guardianUserId: otherGuardian.id,
        relation: "FATHER",
      },
    });

    const otherSession = await login(app, otherGuardian.username);
    const res = await authed(
      request(server()).patch(`/v1/milestones/${created.body.id}`),
      otherSession,
    ).send({ description: "Өөрчилсөн" });

    expect(res.status).toBe(404);
  });

  it("a guardian edits their own", async () => {
    const created = await create(parentA, a.child.id, FIRST_STEP);
    const res = await authed(
      request(server()).patch(`/v1/milestones/${created.body.id}`),
      parentA,
    ).send({ description: "Дөрвөн алхам байсан." });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe("Дөрвөн алхам байсан.");
  });

  /** Staff correct the kindergarten's record — that is ordinary administration. */
  it("a teacher edits a guardian's milestone", async () => {
    const created = await create(parentA, a.child.id, FIRST_STEP);
    const res = await authed(
      request(server()).patch(`/v1/milestones/${created.body.id}`),
      teacherA,
    ).send({ occurredOn: "2024-03-16" });

    expect(res.status).toBe(200);
  });

  it("a partial edit leaves the other fields alone", async () => {
    const created = await create(parentA, a.child.id, FIRST_STEP);
    await authed(request(server()).patch(`/v1/milestones/${created.body.id}`), parentA).send({
      description: "Шинэ тайлбар",
    });

    const row = await db.milestone.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.occurredOn.toISOString().slice(0, 10)).toBe("2024-03-15");
    expect(row.kind).toBe("FIRST_STEP");
  });

  it("soft-deletes rather than removing the row", async () => {
    const created = await create(parentA, a.child.id, FIRST_STEP);
    const res = await authed(
      request(server()).delete(`/v1/milestones/${created.body.id}`),
      parentA,
    );

    expect(res.status).toBe(200);
    const row = await db.milestone.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.deletedAt).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Photographs — RFP §4.5's "Зураг"
// ═══════════════════════════════════════════════════════════════════════════

describe("photographs", () => {
  async function photoBytes(): Promise<Buffer> {
    return sharp({ create: { width: 32, height: 32, channels: 3, background: "teal" } })
      .jpeg()
      .toBuffer();
  }

  it("a guardian attaches a photograph to a milestone", async () => {
    if (!(await app.get(StorageService).isReachable())) {
      throw new Error("MinIO unreachable — docker compose up -d storage");
    }

    const milestone = await create(parentA, a.child.id, FIRST_STEP);

    const upload = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), parentA)
      .field("milestoneId", milestone.body.id)
      .attach("file", await photoBytes(), "анхны-алхам.jpg");

    expect(upload.status).toBe(201);

    const listed = await authed(
      request(server()).get(`/v1/children/${a.child.id}/milestones`),
      parentA,
    );
    expect(listed.body[0].media).toHaveLength(1);
  });

  /**
   * ★ The guardian visibility predicate does not admit milestone photographs
   * for free.
   *
   * A MILESTONE row has `observationId: null` but is not `CHILD_PHOTO`, so
   * neither existing branch matched it. Without the added branch a family would
   * upload a photograph of their child's first steps, receive a 201, and never
   * see it again — while staff saw it fine. This asserts the serve path, not
   * just the list.
   */
  it("the family can fetch the photograph they attached", async () => {
    if (!(await app.get(StorageService).isReachable())) {
      throw new Error("MinIO unreachable — docker compose up -d storage");
    }

    const milestone = await create(parentA, a.child.id, FIRST_STEP);
    const upload = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), parentA)
      .field("milestoneId", milestone.body.id)
      .attach("file", await photoBytes(), "зураг.jpg");

    const mediaId = upload.body.items[0].id as string;
    const served = await authed(request(server()).get(`/v1/media/${mediaId}`), parentA);
    expect(served.status).toBe(302);

    // And still not to another family.
    const refused = await authed(request(server()).get(`/v1/media/${mediaId}`), parentB);
    expect(refused.status).toBe(404);
  });

  it("refuses a milestone belonging to another child", async () => {
    if (!(await app.get(StorageService).isReachable())) {
      throw new Error("MinIO unreachable — docker compose up -d storage");
    }

    const teacherB = await login(app, b.teacherUser.username);
    const otherMilestone = await create(teacherB, b.child.id, FIRST_STEP);

    const res = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), parentA)
      .field("milestoneId", otherMilestone.body.id)
      .attach("file", await photoBytes(), "зураг.jpg");

    expect(res.status).toBe(400);
  });

  it("refuses attaching to an observation and a milestone at once", async () => {
    const milestone = await create(parentA, a.child.id, FIRST_STEP);
    const res = await authed(request(server()).post(`/v1/children/${a.child.id}/media`), parentA)
      .field("milestoneId", milestone.body.id)
      .field("observationId", milestone.body.id)
      .attach("file", await photoBytes(), "зураг.jpg");

    expect(res.status).toBe(400);
  });
});
