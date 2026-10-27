import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { A79_LEVELS, a79CriterionPrompt } from "@kinder/contracts";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  assignTeacher,
  authed,
  createChild,
  createGroup,
  createMembership,
  createScenario,
  createUser,
  enrollChild,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * «Гарааны үнэлгээ» started from its own page — 2026-10-27, the user: the
 * teacher picks each child's level (suggested from age), a survey per level
 * is made for the group, and each level's sheet holds only its own children.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let teacherB: AuthSession;
/** A teacher in kindergarten A, assigned to a different group. */
let otherGroupTeacher: AuthSession;
/** A second child of A's group, three years old. */
let younger: { id: string };

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

  younger = await createChild(a.kindergarten.id, {
    firstName: "Намуун",
    dateOfBirth: new Date(Date.now() - 3.5 * 365.25 * 24 * 3600 * 1000),
  });
  await enrollChild(a.kindergarten.id, younger.id, a.group.id, a.schoolYear.id);

  const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, "Нарны бүлэг");
  const other = await createUser({ username: `teacher-a-other-${Date.now()}` });
  const membership = await createMembership(other.id, a.kindergarten.id, "TEACHER");
  await assignTeacher(a.kindergarten.id, otherGroup.id, membership.id);

  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  teacherB = await login(app, b.teacherUser.username);
  otherGroupTeacher = await login(app, other.username);
});

const server = () => app.getHttpServer();

function setup(session: AuthSession, groupId = a.group.id) {
  return authed(request(server()).get(`/v1/groups/${groupId}/a79-baseline`), session);
}

function start(
  session: AuthSession,
  levels: { level: string; childIds: string[] }[],
  groupId = a.group.id,
) {
  return authed(request(server()).post(`/v1/groups/${groupId}/a79-baseline`), session).send({
    levels,
  });
}

/** A level's teacher sheet. */
async function sheetOf(session: AuthSession, surveyId: string) {
  return authed(request(server()).get(`/v1/surveys/${surveyId}/teacher-sheet`), session);
}

describe("starting the group's baseline", () => {
  it("suggests each child's level from their age, before anything is made", async () => {
    const res = await setup(teacherA);
    expect(res.status).toBe(200);
    expect(res.body.surveys).toEqual([]);
    const byId = new Map(
      (
        res.body.roster as { childId: string; suggestedLevel: string; surveyId: string | null }[]
      ).map((row) => [row.childId, row]),
    );
    // Born 2021-04-12 — five or more today; the younger one is three.
    expect(byId.get(a.child.id)).toMatchObject({ suggestedLevel: "IV", surveyId: null });
    expect(byId.get(younger.id)).toMatchObject({ suggestedLevel: "II", surveyId: null });
  });

  it("makes one published survey per level, of that level's criteria, for its own children", async () => {
    const res = await start(teacherA, [
      { level: "IV", childIds: [a.child.id] },
      // The teacher's choice, not the age's: the three-year-old on III.
      { level: "III", childIds: [younger.id] },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.surveys).toHaveLength(2);

    const surveys = await db.survey.findMany({
      where: { groupId: a.group.id, a79Level: { not: null } },
      include: { questions: { orderBy: { order: "asc" } }, children: true },
    });
    for (const survey of surveys) {
      const level = A79_LEVELS.find((l) => l.key === survey.a79Level)!;
      expect(survey).toMatchObject({
        status: "PUBLISHED",
        respondent: "TEACHER",
        scope: "CHILD",
        period: "BASELINE",
        title: `А/79 Гарааны үнэлгээ — ${level.key} түвшин`,
      });
      expect(survey.questions.map((q) => q.prompt)).toEqual(level.criteria.map(a79CriterionPrompt));
      expect(survey.questions.every((q) => q.type === "SINGLE_CHOICE")).toBe(true);
      expect(survey.questions[0]!.options).toEqual(["0", "1"]);
    }
    const iv = surveys.find((s) => s.a79Level === "IV")!;
    const iii = surveys.find((s) => s.a79Level === "III")!;
    expect(iv.questions).toHaveLength(49);
    expect(iv.children.map((c) => c.childId)).toEqual([a.child.id]);
    expect(iii.children.map((c) => c.childId)).toEqual([younger.id]);

    // Each level's sheet holds its own children and nobody else.
    const ivSheet = await sheetOf(teacherA, iv.id);
    expect(ivSheet.status).toBe(200);
    expect(ivSheet.body.rows.map((r: { child: { id: string } }) => r.child.id)).toEqual([
      a.child.id,
    ]);
    const iiiSheet = await sheetOf(teacherA, iii.id);
    expect(iiiSheet.body.rows.map((r: { child: { id: string } }) => r.child.id)).toEqual([
      younger.id,
    ]);

    const after = await setup(teacherA);
    const surveyOf = new Map(
      (after.body.roster as { childId: string; surveyId: string }[]).map((r) => [
        r.childId,
        r.surveyId,
      ]),
    );
    expect(surveyOf.get(a.child.id)).toBe(iv.id);
    expect(surveyOf.get(younger.id)).toBe(iii.id);
  });

  it("adds a child to the level's survey already made, and refuses one already on a baseline", async () => {
    await start(teacherA, [{ level: "IV", childIds: [a.child.id] }]);

    const added = await start(teacherA, [{ level: "IV", childIds: [younger.id] }]);
    expect(added.status).toBe(201);
    const surveys = await db.survey.findMany({
      where: { groupId: a.group.id, a79Level: "IV" },
      include: { children: true },
    });
    expect(surveys).toHaveLength(1);
    expect(surveys[0]!.children.map((c) => c.childId).sort()).toEqual(
      [a.child.id, younger.id].sort(),
    );

    const twice = await start(teacherA, [{ level: "III", childIds: [a.child.id] }]);
    expect(twice.status).toBe(400);
  });

  it("refuses one child on two levels in one request", async () => {
    const res = await start(teacherA, [
      { level: "IV", childIds: [a.child.id] },
      { level: "III", childIds: [a.child.id] },
    ]);
    expect(res.status).toBe(400);
  });

  it("a child outside the group gets 404", async () => {
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id);
    const child = await createChild(a.kindergarten.id, { firstName: "Сарнай" });
    await enrollChild(a.kindergarten.id, child.id, otherGroup.id, a.schoolYear.id);

    const res = await start(teacherA, [{ level: "IV", childIds: [child.id] }]);
    expect(res.status).toBe(404);
    expect(await db.survey.count({ where: { a79Level: { not: null } } })).toBe(0);
  });

  it("the group's administrator may start it too", async () => {
    const res = await start(adminA, [{ level: "IV", childIds: [a.child.id] }]);
    expect(res.status).toBe(201);
  });

  it("carries its level on the staff list — what keeps it off «Судалгаа»", async () => {
    await start(teacherA, [{ level: "IV", childIds: [a.child.id] }]);
    const list = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    );
    expect(list.status).toBe(200);
    // Listed with its level, which is what keeps it off the survey screens.
    expect(list.body).toHaveLength(1);
    expect(list.body[0].a79Level).toBe("IV");
  });
});

describe("filling in a level's sheet", () => {
  async function started() {
    await start(teacherA, [
      { level: "IV", childIds: [a.child.id] },
      { level: "III", childIds: [younger.id] },
    ]);
    const iv = await db.survey.findFirstOrThrow({
      where: { groupId: a.group.id, a79Level: "IV" },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    return {
      surveyId: iv.id,
      answers: iv.questions.map((q, i) => ({ questionId: q.id, value: i < 10 ? "1" : "0" })),
    };
  }

  it("saves the child's row whole, and a half-done row as a draft", async () => {
    const { surveyId, answers } = await started();

    const draft = await authed(
      request(server()).put(`/v1/surveys/${surveyId}/teacher-sheet/drafts`),
      teacherA,
    ).send({ drafts: [{ childId: a.child.id, answers: answers.slice(0, 8) }] });
    expect(draft.status).toBe(200);

    const whole = await authed(
      request(server()).put(`/v1/surveys/${surveyId}/teacher-sheet`),
      teacherA,
    ).send({ responses: [{ childId: a.child.id, answers }] });
    expect(whole.status).toBe(200);

    const sheet = await sheetOf(teacherA, surveyId);
    expect(sheet.body.rows[0].response.answers).toHaveLength(49);
    expect(sheet.body.rows[0].draft).toBeNull();
  });

  it("a child of the group on another level's survey gets 404 on this one", async () => {
    const { surveyId, answers } = await started();

    const whole = await authed(
      request(server()).put(`/v1/surveys/${surveyId}/teacher-sheet`),
      teacherA,
    ).send({ responses: [{ childId: younger.id, answers }] });
    expect(whole.status).toBe(404);

    const draft = await authed(
      request(server()).put(`/v1/surveys/${surveyId}/teacher-sheet/drafts`),
      teacherA,
    ).send({ drafts: [{ childId: younger.id, answers: answers.slice(0, 3) }] });
    expect(draft.status).toBe(404);

    const single = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      teacherA,
    ).send({ childId: younger.id, answers });
    expect(single.status).toBe(404);
  });
});

describe("who reaches it", () => {
  it("teacher from another group gets 404", async () => {
    expect((await setup(otherGroupTeacher)).status).toBe(404);
    expect((await start(otherGroupTeacher, [{ level: "IV", childIds: [a.child.id] }])).status).toBe(
      404,
    );
  });

  it("guardian gets 404 — even for their own child's group", async () => {
    expect((await setup(parentA)).status).toBe(404);
    expect((await start(parentA, [{ level: "IV", childIds: [a.child.id] }])).status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    expect((await setup(teacherB)).status).toBe(404);
    expect((await start(teacherB, [{ level: "IV", childIds: [a.child.id] }])).status).toBe(404);
    // Nor may B's teacher put their own child on A's group.
    expect((await start(teacherB, [{ level: "IV", childIds: [b.child.id] }])).status).toBe(404);
    expect(await db.survey.count({ where: { a79Level: { not: null } } })).toBe(0);
  });

  it("another group's teacher cannot read the level's sheet", async () => {
    await start(teacherA, [{ level: "IV", childIds: [a.child.id] }]);
    const iv = await db.survey.findFirstOrThrow({ where: { a79Level: "IV" } });
    expect((await sheetOf(otherGroupTeacher, iv.id)).status).toBe(404);
    expect((await sheetOf(teacherB, iv.id)).status).toBe(404);
  });
});
