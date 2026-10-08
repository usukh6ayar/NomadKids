import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
  createScenario,
  enrollChild,
  linkGuardian,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Санал хүсэлт — a family's feedback to the administration.
 *
 * What is pinned: the inbox is the administration's alone; a family writes
 * only for their own child; **anonymous means anonymous to the
 * administration** — in the response, under the group filter and in the audit
 * trail; the state only moves forward; and each side's removal leaves the
 * other side's copy alone.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let adminB: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;

const server = () => app.getHttpServer();
const inbox = (kgId: string, query = "") => `/v1/kindergartens/${kgId}/feedback${query}`;

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

  adminA = await login(app, a.adminUser.username);
  adminB = await login(app, b.adminUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

const SOAP = {
  category: "HYGIENE",
  body: "Бүлгийн угаалгын өрөөнд саван байхгүй байна.",
  relation: "FATHER",
};

async function send(session: AuthSession, childId: string, extra: Record<string, unknown> = {}) {
  return authed(request(server()).post("/v1/me/feedback"), session).send({
    childId,
    ...SOAP,
    ...extra,
  });
}

async function sendOk(session: AuthSession, childId: string, extra: Record<string, unknown> = {}) {
  const res = await send(session, childId, extra);
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  it("an admin of another kindergarten gets 404 on every inbox route", async () => {
    const { id } = await sendOk(parentA, a.child.id);
    const base = inbox(a.kindergarten.id);

    const responses = await Promise.all([
      authed(request(server()).get(base), adminB),
      authed(request(server()).post(`${base}/${id}/acknowledge`), adminB),
      authed(request(server()).post(`${base}/${id}/reply`), adminB).send({ body: "Хариу" }),
      authed(request(server()).delete(`${base}/${id}`), adminB),
      // Their own kindergarten's URL with A's item id is no better.
      authed(request(server()).post(`${inbox(b.kindergarten.id)}/${id}/acknowledge`), adminB),
    ]);

    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    const row = await db.feedback.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("NEW");
    expect(row.adminDeletedAt).toBeNull();
  });

  it("a teacher cannot read the inbox — a complaint about them is not theirs to read", async () => {
    const teacherA = await login(app, a.teacherUser.username);
    const res = await authed(request(server()).get(inbox(a.kindergarten.id)), teacherA);
    expect(res.status).toBe(404);
  });

  it("a parent cannot write on behalf of another family's child", async () => {
    const res = await send(parentA, b.child.id);
    expect(res.status).toBe(404);
    expect(await db.feedback.count()).toBe(0);
  });

  it("a parent cannot remove another parent's item", async () => {
    const { id } = await sendOk(parentA, a.child.id);
    const res = await authed(request(server()).delete(`/v1/me/feedback/${id}`), parentB);
    expect(res.status).toBe(404);
    expect((await db.feedback.findUniqueOrThrow({ where: { id } })).authorDeletedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Writing
// ═══════════════════════════════════════════════════════════════════════════

describe("writing", () => {
  it("stamps the kindergarten and group from the enrollment, and keeps the group after a transfer", async () => {
    const { id } = await sendOk(parentA, a.child.id);

    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Наран бүлэг");
    await db.enrollment.update({ where: { id: a.enrollment.id }, data: { groupId: other.id } });

    const row = await db.feedback.findUniqueOrThrow({ where: { id } });
    expect(row.kindergartenId).toBe(a.kindergarten.id);
    expect(row.groupId).toBe(a.group.id);
  });

  it("returns names and the group's lead as text to the family", async () => {
    const res = await send(parentA, a.child.id);

    expect(res.body).toMatchObject({
      category: "HYGIENE",
      anonymous: false,
      author: { firstName: "Нэр", lastName: "Овог" },
      childName: "Батбаяр",
      relation: "аав",
      groupId: a.group.id,
      groupName: a.group.name,
      teacherName: "О.Нэр",
      status: "NEW",
      acknowledgedAt: null,
      reply: null,
    });
  });

  it("allows ten a day and refuses the eleventh", async () => {
    for (let i = 0; i < 10; i++) await sendOk(parentA, a.child.id);
    const res = await send(parentA, a.child.id);
    expect(res.status).toBe(429);
    expect(await db.feedback.count()).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Anonymity — anonymous to the administration
// ═══════════════════════════════════════════════════════════════════════════

describe("anonymity", () => {
  it("hides the author, child, relation, group and teacher from the admin", async () => {
    await sendOk(parentA, a.child.id, { anonymous: true });

    const res = await authed(request(server()).get(inbox(a.kindergarten.id)), adminA);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      anonymous: true,
      body: SOAP.body,
      author: null,
      childName: null,
      relation: null,
      groupId: null,
      groupName: null,
      teacherName: null,
    });
    // The relation the family sent is not kept at all.
    expect((await db.feedback.findFirstOrThrow()).relation).toBeNull();
  });

  it("never appears under a group filter, which would name the family's group", async () => {
    await sendOk(parentA, a.child.id, { anonymous: true });
    const named = await sendOk(parentA, a.child.id);

    const res = await authed(
      request(server()).get(inbox(a.kindergarten.id, `?groupId=${a.group.id}`)),
      adminA,
    );
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([named.id]);
    expect(res.body.total).toBe(1);
  });

  it("cannot be replied to — 409", async () => {
    const { id } = await sendOk(parentA, a.child.id, { anonymous: true });
    const res = await authed(
      request(server()).post(`${inbox(a.kindergarten.id)}/${id}/reply`),
      adminA,
    ).send({ body: "Хариу" });
    expect(res.status).toBe(409);
  });

  it("leaves the sender out of the audit trail, even when they remove it themselves", async () => {
    const { id } = await sendOk(parentA, a.child.id, { anonymous: true });
    await authed(request(server()).post(`${inbox(a.kindergarten.id)}/${id}/acknowledge`), adminA);
    await authed(request(server()).delete(`/v1/me/feedback/${id}`), parentA);

    const rows = await db.auditLog.findMany({ where: { objectId: id } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.childId).toBeNull();
      expect(row.actorUserId).not.toBe(a.parentUser.id);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The workflow
// ═══════════════════════════════════════════════════════════════════════════

describe("workflow", () => {
  it("acknowledge moves NEW forward once; again returns the current state", async () => {
    const { id } = await sendOk(parentA, a.child.id);
    const url = `${inbox(a.kindergarten.id)}/${id}/acknowledge`;

    const first = await authed(request(server()).post(url), adminA);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("ACKNOWLEDGED");
    expect(first.body.acknowledgedAt).not.toBeNull();

    const again = await authed(request(server()).post(url), adminA);
    expect(again.status).toBe(200);
    expect(again.body.acknowledgedAt).toBe(first.body.acknowledgedAt);
    expect(await db.auditLog.count({ where: { objectId: id } })).toBe(1);
  });

  it("a reply on a NEW item answers and acknowledges it; a second reply is 409", async () => {
    const { id } = await sendOk(parentA, a.child.id);
    const url = `${inbox(a.kindergarten.id)}/${id}/reply`;

    const res = await authed(request(server()).post(url), adminA).send({ body: "Саван тавилаа." });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ANSWERED");
    expect(res.body.acknowledgedAt).not.toBeNull();
    expect(res.body.reply).toMatchObject({ body: "Саван тавилаа.", signature: null });

    const again = await authed(request(server()).post(url), adminA).send({ body: "Дахин" });
    expect(again.status).toBe(409);
    // Acknowledging an answered item does not move it back.
    const ack = await authed(
      request(server()).post(`${inbox(a.kindergarten.id)}/${id}/acknowledge`),
      adminA,
    );
    expect(ack.body.status).toBe("ANSWERED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Removal — one per side
// ═══════════════════════════════════════════════════════════════════════════

describe("removal", () => {
  it("the inbox removing an item leaves the family their reply", async () => {
    const { id } = await sendOk(parentA, a.child.id);
    await authed(request(server()).post(`${inbox(a.kindergarten.id)}/${id}/reply`), adminA).send({
      body: "Саван тавилаа.",
    });

    const del = await authed(request(server()).delete(`${inbox(a.kindergarten.id)}/${id}`), adminA);
    expect(del.status).toBe(204);

    const own = await authed(request(server()).get("/v1/me/feedback"), parentA);
    expect(own.body.items[0].reply.body).toBe("Саван тавилаа.");
    const box = await authed(request(server()).get(inbox(a.kindergarten.id)), adminA);
    expect(box.body.total).toBe(0);
  });

  it("the family removing an item leaves it in the inbox", async () => {
    const { id } = await sendOk(parentA, a.child.id);

    const del = await authed(request(server()).delete(`/v1/me/feedback/${id}`), parentA);
    expect(del.status).toBe(204);

    const own = await authed(request(server()).get("/v1/me/feedback"), parentA);
    expect(own.body.total).toBe(0);
    const box = await authed(request(server()).get(inbox(a.kindergarten.id)), adminA);
    expect(box.body.items.map((i: { id: string }) => i.id)).toEqual([id]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The inbox's filters
// ═══════════════════════════════════════════════════════════════════════════

describe("inbox filters", () => {
  it("filters by status, category and group", async () => {
    // A second child, in a second group, with the same parent.
    const sun = await createGroup(a.kindergarten.id, a.schoolYear.id, "Наран бүлэг");
    const sibling = await createChild(a.kindergarten.id, { firstName: "Тэмүүлэн" });
    await enrollChild(a.kindergarten.id, sibling.id, sun.id, a.schoolYear.id);
    await linkGuardian(a.kindergarten.id, sibling.id, a.parentUser.id);

    const food = await sendOk(parentA, a.child.id, { category: "FOOD" });
    const hygiene = await sendOk(parentA, sibling.id, { category: "HYGIENE" });
    await authed(
      request(server()).post(`${inbox(a.kindergarten.id)}/${hygiene.id}/acknowledge`),
      adminA,
    );

    const ids = async (query: string) => {
      const res = await authed(request(server()).get(inbox(a.kindergarten.id, query)), adminA);
      expect(res.status).toBe(200);
      return res.body.items.map((i: { id: string }) => i.id);
    };

    expect(await ids("?status=NEW")).toEqual([food.id]);
    expect(await ids("?status=ACKNOWLEDGED")).toEqual([hygiene.id]);
    expect(await ids("?category=FOOD")).toEqual([food.id]);
    expect(await ids(`?groupId=${sun.id}`)).toEqual([hygiene.id]);
    expect(await ids("")).toEqual([hygiene.id, food.id]);
  });
});
