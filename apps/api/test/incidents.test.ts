import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Safety incidents — RFP Module 2.1.
 *
 * The two behaviours worth pinning: a family **reads their child's incidents
 * before the formal notice is sent** — `reportedAt` records whether they were
 * told, not whether they may know — and **reporting sends a notice addressed to
 * that child alone**, never to the class board.
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
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

const FALL = {
  kind: "FALL",
  occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  location: "Тоглоомын талбай",
  bodyPart: "Зүүн өвдөг",
  description: "Гулгуураас буухдаа унаж өвдгөө маажсан.",
  firstAid: "Угааж, ариутгаад наалт наасан.",
  isHighPriority: false,
};

async function createIncident(session: AuthSession, childId: string, body = FALL) {
  return authed(request(server()).post(`/v1/children/${childId}/incidents`), session).send(body);
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  it("a teacher from another kindergarten gets 404", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/incidents`),
      teacherB,
    );
    expect(res.status).toBe(404);
  });

  it("a guardian of another child gets 404", async () => {
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/incidents`),
      parentB,
    );
    expect(res.status).toBe(404);
  });

  it("a guardian cannot record one — this is the kindergarten's account", async () => {
    const res = await createIncident(parentA, a.child.id);
    expect(res.status).toBe(404);
    expect(await db.safetyIncident.count({ where: { childId: a.child.id } })).toBe(0);
  });

  it("a teacher from another kindergarten cannot read the log", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/incidents`),
      teacherB,
    );
    expect(res.status).toBe(404);
  });

  it("a guardian cannot read the kindergarten's log", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/incidents`),
      parentA,
    );
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recording — RFP Module 2.1
// ═══════════════════════════════════════════════════════════════════════════

describe("recording", () => {
  it("a teacher records one with the time, the place and the first aid", async () => {
    const res = await createIncident(teacherA, a.child.id);

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("FALL");
    expect(res.body.bodyPart).toBe("Зүүн өвдөг");
    expect(res.body.firstAid).toContain("наалт");
    // Not yet reported — the state the queue exists to surface.
    expect(res.body.reportedAt).toBeNull();
  });

  it("refuses an incident with no description", async () => {
    const res = await createIncident(teacherA, a.child.id, { ...FALL, description: "   " });
    expect(res.status).toBe(400);
  });

  it("refuses a time in the future", async () => {
    const res = await createIncident(teacherA, a.child.id, {
      ...FALL,
      occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  /**
   * ★ A family sees their child's incident before the formal notice is sent.
   *
   * `reportedAt` tracks whether a notice was *sent*, not whether the record is
   * visible. A parent opening the app before the teacher has written the
   * message must not find their child's injury hidden — Module 2.1 is about
   * telling families quickly, not about staging what they may know.
   */
  it("a guardian reads an unreported incident about their own child", async () => {
    await createIncident(teacherA, a.child.id);

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/incidents`),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reportedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The queue — high priority first, unreported filterable
// ═══════════════════════════════════════════════════════════════════════════

describe("the kindergarten log", () => {
  it("puts high-priority incidents first", async () => {
    await createIncident(teacherA, a.child.id, {
      ...FALL,
      description: "Энгийн",
      isHighPriority: false,
    });
    await createIncident(teacherA, a.child.id, {
      ...FALL,
      kind: "ALLERGIC_REACTION",
      description: "Ноцтой",
      isHighPriority: true,
    });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/incidents`),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body.items[0].description).toBe("Ноцтой");
  });

  it("filters to the ones nobody has reported yet", async () => {
    const reported = await createIncident(teacherA, a.child.id, { ...FALL, description: "Хэлсэн" });
    await createIncident(teacherA, a.child.id, { ...FALL, description: "Хэлээгүй" });

    await authed(request(server()).post(`/v1/incidents/${reported.body.id}/report`), teacherA).send(
      { title: "Мэдэгдэл", body: "Өнөөдөр өвдгөө маажсан." },
    );

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/incidents?unreportedOnly=true`),
      teacherA,
    );

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].description).toBe("Хэлээгүй");
  });

  it("is paginated", async () => {
    for (let i = 0; i < 3; i += 1) {
      await createIncident(teacherA, a.child.id, { ...FALL, description: `Тохиолдол ${i}` });
    }

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/incidents?page=1&pageSize=2`),
      teacherA,
    );

    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(3);
  });

  it("does not show another kindergarten's incidents", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    await createIncident(teacherB, b.child.id);

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/incidents`),
      teacherA,
    );
    expect(res.body.items).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Reporting to the family — RFP Module 2.1
// ═══════════════════════════════════════════════════════════════════════════

describe("reporting", () => {
  /**
   * ★ Reporting goes through the notice machinery, which already owns
   * delivery, read receipts and the parent's unread badge. Module 2.1 asks for
   * "Илгээлтийн бүртгэл … эцэг эх хэзээ уншсан", and a second delivery path
   * beside it would mean two places deciding who sees what — with only one of
   * them getting the receipt.
   */
  it("creates a published, important notice and links it to the incident", async () => {
    const incident = await createIncident(teacherA, a.child.id);

    const res = await authed(
      request(server()).post(`/v1/incidents/${incident.body.id}/report`),
      teacherA,
    ).send({ title: "Өвдөг маажсан", body: "Тоглоомын талбайд унасан. Анхны тусламж үзүүлсэн." });

    expect(res.status).toBe(201);
    expect(res.body.reportedAt).not.toBeNull();

    const notification = await db.notification.findUniqueOrThrow({
      where: { id: res.body.notificationId },
      include: { targets: true },
    });

    // Published immediately: a safety notice sitting as a draft is the failure
    // this feature exists to prevent.
    expect(notification.status).toBe("PUBLISHED");
    expect(notification.isImportant).toBe(true);

    // ★★ Addressed to this child alone — never the class board. Naming a
    // child's injury to the whole group is the leak most of this system's
    // rules exist to prevent.
    expect(notification.targets).toHaveLength(1);
    expect(notification.targets[0]!.childId).toBe(a.child.id);
    expect(notification.targets[0]!.groupId).toBeNull();
  });

  it("the family can then read the notice", async () => {
    const incident = await createIncident(teacherA, a.child.id);
    await authed(request(server()).post(`/v1/incidents/${incident.body.id}/report`), teacherA).send(
      {
        title: "Өвдөг маажсан",
        body: "Тоглоомын талбайд унасан.",
      },
    );

    const res = await authed(request(server()).get("/v1/notifications"), parentA);
    expect(res.status).toBe(200);
    expect(res.body.items.some((n: { title: string }) => n.title === "Өвдөг маажсан")).toBe(true);
  });

  it("another family does not receive it", async () => {
    const incident = await createIncident(teacherA, a.child.id);
    await authed(request(server()).post(`/v1/incidents/${incident.body.id}/report`), teacherA).send(
      {
        title: "Өвдөг маажсан",
        body: "Тоглоомын талбайд унасан.",
      },
    );

    const res = await authed(request(server()).get("/v1/notifications"), parentB);
    expect(res.body.items.some((n: { title: string }) => n.title === "Өвдөг маажсан")).toBe(false);
  });

  /**
   * ★★★ `reportedAt` is the record that the family was told, and by which
   * notice. Overwriting it would orphan the first notice and lose the time that
   * matters. A correction is a new notice, which is a deliberate act.
   */
  it("refuses to report the same incident twice", async () => {
    const incident = await createIncident(teacherA, a.child.id);
    const message = { title: "Мэдэгдэл", body: "Тайлбар." };

    expect(
      (
        await authed(
          request(server()).post(`/v1/incidents/${incident.body.id}/report`),
          teacherA,
        ).send(message)
      ).status,
    ).toBe(201);

    const second = await authed(
      request(server()).post(`/v1/incidents/${incident.body.id}/report`),
      teacherA,
    ).send(message);
    expect(second.status).toBe(400);

    // And exactly one notice exists, not two.
    expect(await db.notification.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(1);
  });

  it("a guardian cannot report", async () => {
    const incident = await createIncident(teacherA, a.child.id);
    const res = await authed(
      request(server()).post(`/v1/incidents/${incident.body.id}/report`),
      parentA,
    ).send({ title: "Мэдэгдэл", body: "Тайлбар." });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Editing and deleting
// ═══════════════════════════════════════════════════════════════════════════

describe("editing", () => {
  it("a teacher corrects the follow-up without touching the rest", async () => {
    const incident = await createIncident(teacherA, a.child.id);

    const res = await authed(
      request(server()).patch(`/v1/incidents/${incident.body.id}`),
      teacherA,
    ).send({ followUp: "Маргааш шалгах." });

    expect(res.status).toBe(200);
    expect(res.body.followUp).toBe("Маргааш шалгах.");
    expect(res.body.bodyPart).toBe("Зүүн өвдөг");
  });

  it("soft-deletes rather than removing the row", async () => {
    const incident = await createIncident(teacherA, a.child.id);
    await authed(request(server()).delete(`/v1/incidents/${incident.body.id}`), teacherA);

    const row = await db.safetyIncident.findUniqueOrThrow({ where: { id: incident.body.id } });
    expect(row.deletedAt).not.toBeNull();
  });
});
