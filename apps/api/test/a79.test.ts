import type { INestApplication } from "@nestjs/common";
import { A79_LEVELS } from "@kinder/contracts";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  assignTeacher,
  authed,
  createGroup,
  createMembership,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";

/**
 * А/79 in the progress record — the backend the web has called since
 * 2026-10-08. Three routes, each authorised through its own resource: the
 * note (PUT links), the child (progress), the group (summary).
 *
 * The scenario's child was born 2021-04-12, so on the last day of the
 * scenario's school year (2026-06-01) they are five — level IV.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let teacherB: AuthSession;
let otherGroupTeacher: AuthSession;
let typeId: string;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");
  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  teacherB = await login(app, b.teacherUser.username);

  // A teacher of another group in the same kindergarten.
  const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
  const user = await createUser({ username: uniq("otherteacher") });
  const membership = await createMembership(user.id, a.kindergarten.id, "TEACHER");
  await assignTeacher(a.kindergarten.id, other.id, membership.id);
  otherGroupTeacher = await login(app, user.username);

  typeId = (await db.observationType.findFirstOrThrow({ where: { code: "daily" } })).id;
});

const server = () => app.getHttpServer();

async function note(observedOn = "2026-02-10", childDid = "Цамхаг барив") {
  const res = await authed(
    request(server()).post(`/v1/children/${a.child.id}/observations`),
    teacherA,
  ).send({ typeId, observedOn, situation: "Барилгын буланд", childDid });
  if (res.status !== 201) throw new Error(`note failed: ${res.status} ${res.text}`);
  return res.body.id as string;
}

const link = (number: number, status = "INDEPENDENT", level = "IV") => ({
  level,
  number,
  status,
});

const putLinks = (session: AuthSession, observationId: string, links: unknown[]) =>
  authed(request(server()).put(`/v1/observations/${observationId}/a79-links`), session).send({
    links,
  });

const progress = (session: AuthSession, level = "IV") =>
  authed(request(server()).get(`/v1/children/${a.child.id}/a79-progress?level=${level}`), session);

const summary = (session: AuthSession, query = "") =>
  authed(request(server()).get(`/v1/groups/${a.group.id}/a79-summary${query}`), session);

describe("PUT /observations/:id/a79-links", () => {
  it("links a note to criteria and answers with the live set", async () => {
    const id = await note();
    const res = await putLinks(teacherA, id, [
      link(3),
      { ...link(12, "SUPPORTED"), note: "Сануулгатай" },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.links).toEqual([
      { level: "IV", number: 3, status: "INDEPENDENT", note: null },
      { level: "IV", number: 12, status: "SUPPORTED", note: "Сануулгатай" },
    ]);
  });

  it("replaces the set — the old rows are soft-deleted, never overwritten", async () => {
    const id = await note();
    await putLinks(teacherA, id, [link(3), link(4)]);
    const res = await putLinks(teacherA, id, [link(5)]);

    expect(res.body.links.map((l: { number: number }) => l.number)).toEqual([5]);
    expect(await db.observationA79Link.count({ where: { observationId: id } })).toBe(3);
    expect(
      await db.observationA79Link.count({ where: { observationId: id, deletedAt: null } }),
    ).toBe(1);
  });

  it("refuses a criterion the level does not have, and one criterion twice", async () => {
    const id = await note();
    expect((await putLinks(teacherA, id, [link(50)])).status).toBe(400);
    expect((await putLinks(teacherA, id, [link(3), link(3, "SUPPORTED")])).status).toBe(400);
  });

  it("two saves of one note at once leave one live set, not a 500", async () => {
    const id = await note();
    const [first, second] = await Promise.all([
      putLinks(teacherA, id, [link(3), link(4)]),
      putLinks(teacherA, id, [link(3), link(4)]),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(
      await db.observationA79Link.count({ where: { observationId: id, deletedAt: null } }),
    ).toBe(2);
  });

  it("an administrator may link a note", async () => {
    const id = await note();
    expect((await putLinks(adminA, id, [link(1)])).status).toBe(200);
  });

  it("teacher from another group gets 404", async () => {
    const id = await note();
    expect((await putLinks(otherGroupTeacher, id, [link(1)])).status).toBe(404);
  });

  it("guardian of the child gets 404", async () => {
    const id = await note();
    expect((await putLinks(parentA, id, [link(1)])).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    const id = await note();
    expect((await putLinks(teacherB, id, [link(1)])).status).toBe(404);
  });

  it("an archived note cannot be linked", async () => {
    const id = await note();
    await db.observation.update({ where: { id }, data: { deletedAt: new Date() } });
    expect((await putLinks(teacherA, id, [link(1)])).status).toBe(404);
  });
});

describe("GET /observations/:id/a79-links", () => {
  const getLinks = (session: AuthSession, observationId: string) =>
    authed(request(server()).get(`/v1/observations/${observationId}/a79-links`), session);

  it("gives the note's live set, for editing it", async () => {
    const id = await note();
    await putLinks(teacherA, id, [link(3), link(4)]);
    await putLinks(teacherA, id, [{ ...link(12, "SUPPORTED"), note: "Сануулгатай" }]);

    const res = await getLinks(teacherA, id);
    expect(res.status).toBe(200);
    expect(res.body.links).toEqual([
      { level: "IV", number: 12, status: "SUPPORTED", note: "Сануулгатай" },
    ]);
    expect((await getLinks(teacherA, await note())).body.links).toEqual([]);
  });

  it("teacher from another group gets 404", async () => {
    const id = await note();
    expect((await getLinks(otherGroupTeacher, id)).status).toBe(404);
  });

  it("guardian of the child gets 404", async () => {
    const id = await note();
    expect((await getLinks(parentA, id)).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    const id = await note();
    expect((await getLinks(teacherB, id)).status).toBe(404);
  });
});

describe("GET /children/:id/a79-progress", () => {
  it("gives each criterion the latest note's status and every note, newest first", async () => {
    const older = await note("2026-01-10", "Эхний тэмдэглэл");
    const newer = await note("2026-02-10", "Дараагийн тэмдэглэл");
    await putLinks(teacherA, older, [link(3, "SUPPORTED"), link(7)]);
    await putLinks(teacherA, newer, [link(3)]);

    const res = await progress(teacherA);

    expect(res.status).toBe(200);
    expect(res.body.level).toBe("IV");
    const three = res.body.criteria.find((c: { number: number }) => c.number === 3);
    expect(three.status).toBe("INDEPENDENT");
    expect(three.evidence.map((e: { observationId: string }) => e.observationId)).toEqual([
      newer,
      older,
    ]);
    expect(three.evidence[1]).toMatchObject({ observedOn: "2026-01-10", status: "SUPPORTED" });
    // No «Тайлбар» on the link, so the note's own opening stands in.
    expect(three.evidence[1].note).toBe("Барилгын буланд");
    // A criterion nobody linked is absent, not NOT_YET.
    expect(res.body.criteria.map((c: { number: number }) => c.number)).toEqual([3, 7]);
  });

  it("a blank situation falls through to what the child did", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      teacherA,
    ).send({ typeId, observedOn: "2026-02-10", situation: "  ", childDid: "Цамхаг барив" });
    expect(res.status).toBe(201);
    await putLinks(teacherA, res.body.id, [link(3)]);

    const three = (await progress(teacherA)).body.criteria[0];
    expect(three.evidence[0].note).toBe("Цамхаг барив");
  });

  it("drops the evidence of an archived note", async () => {
    const id = await note();
    await putLinks(teacherA, id, [link(3)]);
    await db.observation.update({ where: { id }, data: { deletedAt: new Date() } });

    expect((await progress(teacherA)).body.criteria).toEqual([]);
  });

  it("refuses a level outside I…IV", async () => {
    expect((await progress(teacherA, "V")).status).toBe(400);
  });

  it("teacher from another group gets 404", async () => {
    expect((await progress(otherGroupTeacher)).status).toBe(404);
  });

  it("guardian of the child gets 404", async () => {
    expect((await progress(parentA)).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    expect((await progress(teacherB)).status).toBe(404);
  });
});

describe("GET /groups/:id/a79-summary", () => {
  const LEVEL_IV = A79_LEVELS[3]!.criteria;
  const inDomain = (domain: string) => LEVEL_IV.filter((c) => c.domain === domain).length;

  it("counts met criteria per child — only «Бие даан», only the latest", async () => {
    const older = await note("2026-01-10");
    const newer = await note("2026-02-10");
    // Criterion 1 met; 2 «Дэмжлэгтэй» only; 3 met once, then the latest says
    // «Хөгжиж байна» — not met.
    await putLinks(teacherA, older, [link(1), link(2, "SUPPORTED"), link(3)]);
    await putLinks(teacherA, newer, [link(3, "DEVELOPING")]);

    const res = await summary(adminA);

    expect(res.status).toBe(200);
    expect(res.body.children).toHaveLength(1);
    const row = res.body.children[0];
    // Three criteria carry a note: assessed, whatever their status (2026-10-27).
    expect(row).toMatchObject({
      childId: a.child.id,
      level: "IV",
      achieved: 1,
      total: 49,
      assessed: 3,
    });
    expect(row.byDomain).toEqual([
      { domain: "Мэдлэг", achieved: 1, total: inDomain("Мэдлэг") },
      { domain: "Чадвар", achieved: 0, total: inDomain("Чадвар") },
      { domain: "Төлөвшил", achieved: 0, total: inDomain("Төлөвшил") },
    ]);
  });

  it("lists every child of the group, with nothing met as zero", async () => {
    const res = await summary(teacherA);
    expect(res.status).toBe(200);
    expect(res.body.children).toEqual([
      // No note linked: not assessed — never «Хөгжиж байна» (2026-10-27).
      expect.objectContaining({ childId: a.child.id, achieved: 0, total: 49, assessed: 0 }),
    ]);
  });

  it("reads only notes observed within the span", async () => {
    const id = await note("2026-05-10");
    await putLinks(teacherA, id, [link(1)]);

    // Both spans end after the fifth birthday (12 April), so both read level IV.
    const inside = await summary(adminA, "?from=2026-05-01&to=2026-05-31");
    const outside = await summary(adminA, "?from=2026-04-20&to=2026-04-30");

    expect(inside.body.children[0].achieved).toBe(1);
    expect(outside.body.children[0].achieved).toBe(0);
  });

  it("puts the child on the level of their age on the span's last day", async () => {
    // Four until 12 April 2026 — level III before it, IV after.
    const before = await summary(adminA, "?from=2026-02-01&to=2026-02-28");
    const after = await summary(adminA, "?from=2026-05-01&to=2026-05-31");
    expect(before.body.children[0]).toMatchObject({ level: "III", total: 46 });
    expect(after.body.children[0]).toMatchObject({ level: "IV", total: 49 });
  });

  it("refuses half a range", async () => {
    expect((await summary(adminA, "?from=2026-02-01")).status).toBe(400);
  });

  it("teacher from another group gets 404", async () => {
    expect((await summary(otherGroupTeacher)).status).toBe(404);
  });

  it("guardian of a child in the group gets 404", async () => {
    expect((await summary(parentA)).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    expect((await summary(teacherB)).status).toBe(404);
  });
});
