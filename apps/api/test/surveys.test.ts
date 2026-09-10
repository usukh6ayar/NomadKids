import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import ExcelJS from "exceljs";
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

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;

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
  parentB = await login(app, b.parentUser.username);
});

const server = () => app.getHttpServer();

/**
 * A DRAFT CHILD-scope survey with one RATING question, published.
 *
 * ★ Addressed to the teacher's own group since 2026-09-10.
 *
 * A survey with no `groupId` is the whole kindergarten, which is now the
 * administrator's to send (client: "Удирдлага л бүх цэцэрлэг ... судалгаа
 * ... оруулж болно"). The author stays the teacher, because that is what most
 * of this file is about; only the audience narrowed, and `a.group` is the one
 * `a.child` is enrolled in, so every roster assertion below reads the same.
 */
async function publishedChildSurvey(session = teacherA) {
  const created = await authed(
    request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
    session,
  ).send({ title: "Хичээлийн жилийн эхэн", scope: "CHILD", groupId: a.group.id });

  await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), session).send({
    questions: [{ order: 0, type: "RATING", prompt: "Нийгэмшихүй ямар түвшинд байна?" }],
  });

  await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), session);

  const withQuestions = await db.survey.findUniqueOrThrow({
    where: { id: created.body.id },
    include: { questions: true },
  });
  return { surveyId: created.body.id as string, questionId: withQuestions.questions[0]!.id };
}

describe("who answered and who has not", () => {
  /*
   * ★ Names, not a percentage. `results` already says how many replied; what a
   * teacher does with this panel is ring the families who have not, and a
   * count cannot be rung.
   */
  it("lists the roster split by whether they answered", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: "4" }],
    });

    const res = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/participation`),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body.answered.map((r: { child: { id: string } }) => r.child.id)).toEqual([
      a.child.id,
    ]);
    expect(res.body.answered[0].respondent).toBeTruthy();
    expect(res.body.answered[0].submittedAt).toBeTruthy();
    expect(res.body.roster).toBe(1);
  });

  /*
   * ★ The half the panel exists for. A list built from the responses can only
   * show who replied; the roster is what surfaces the ones to chase.
   */
  it("names the children nobody has answered for", async () => {
    const { surveyId } = await publishedChildSurvey();

    const res = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/participation`),
      teacherA,
    );

    expect(res.body.answered).toEqual([]);
    expect(res.body.pending.map((r: { child: { id: string } }) => r.child.id)).toEqual([
      a.child.id,
    ]);
  });

  it("a teacher from another kindergarten gets 404", async () => {
    const { surveyId } = await publishedChildSurvey();
    const teacherB = await login(app, b.teacherUser.username);

    expect(
      (await authed(request(server()).get(`/v1/surveys/${surveyId}/participation`), teacherB))
        .status,
    ).toBe(404);
  });

  it("a guardian cannot read it", async () => {
    const { surveyId } = await publishedChildSurvey();

    expect(
      (await authed(request(server()).get(`/v1/surveys/${surveyId}/participation`), parentA))
        .status,
    ).toBe(404);
  });
});

describe("withdrawing a survey", () => {
  /*
   * ★ Soft, and the answers stay — §3.2.
   *
   * A family answered in good faith, and a teacher taking the survey off their
   * own screen is not a reason to destroy what was said. The audit row names
   * who withdrew it, which is the fact somebody asks about later.
   */
  it("takes it out of the list without deleting the answers", async () => {
    const { surveyId } = await publishedChildSurvey();

    const res = await authed(request(server()).delete(`/v1/surveys/${surveyId}`), teacherA);
    expect(res.status).toBe(200);

    const row = await db.survey.findUniqueOrThrow({ where: { id: surveyId } });
    expect(row.deletedAt).not.toBeNull();

    const list = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    );
    expect(list.body.map((s: { id: string }) => s.id)).not.toContain(surveyId);
  });

  it("a teacher from another kindergarten gets 404", async () => {
    const { surveyId } = await publishedChildSurvey();
    const teacherB = await login(app, b.teacherUser.username);

    expect(
      (await authed(request(server()).delete(`/v1/surveys/${surveyId}`), teacherB)).status,
    ).toBe(404);
  });

  /** 404, not 403 — the guard answers before the route does. */
  it("a guardian cannot withdraw one", async () => {
    const { surveyId } = await publishedChildSurvey();

    expect(
      (await authed(request(server()).delete(`/v1/surveys/${surveyId}`), parentA)).status,
    ).toBe(404);
  });
});

describe("management — staff only", () => {
  it("creates a draft, adds questions, and publishes", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      adminA,
    ).send({ title: "Судалгаа", scope: "KINDERGARTEN" });

    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");

    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
      questions: [{ order: 0, type: "YES_NO", prompt: "Сэтгэл ханамжтай байна уу?" }],
    });

    const published = await authed(
      request(server()).post(`/v1/surveys/${created.body.id}/publish`),
      teacherA,
    );

    expect(published.status).toBe(201);
    expect(published.body.status).toBe("PUBLISHED");
  });

  it("refuses to publish a survey with no questions", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      adminA,
    ).send({ title: "Хоосон", scope: "KINDERGARTEN" });

    const res = await authed(
      request(server()).post(`/v1/surveys/${created.body.id}/publish`),
      teacherA,
    );
    expect(res.status).toBe(400);
  });

  /**
   * A CHECKBOX question with no options has no control a guardian can answer
   * it with, and `unanswered` on the response screen gates the *whole*
   * survey's submit button on every question having a value — so one
   * unanswerable question silently blocks every family from submitting
   * anything at all, with no error explaining why.
   */
  it("refuses a CHECKBOX question with no options", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      adminA,
    ).send({ title: "Судалгаа", scope: "KINDERGARTEN" });

    const res = await authed(
      request(server()).put(`/v1/surveys/${created.body.id}/questions`),
      teacherA,
    ).send({ questions: [{ order: 0, type: "CHECKBOX", prompt: "Аль нь тохирох вэ?" }] });

    expect(res.status).toBe(400);
  });

  it("refuses to change questions once published", async () => {
    const { surveyId } = await publishedChildSurvey();

    const res = await authed(
      request(server()).put(`/v1/surveys/${surveyId}/questions`),
      teacherA,
    ).send({
      questions: [{ order: 0, type: "TEXT", prompt: "Өөр асуулт" }],
    });

    expect(res.status).toBe(400);
  });

  it("a parent cannot create a survey", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      parentA,
    ).send({ title: "x", scope: "KINDERGARTEN" });

    // The coarse @Roles("TEACHER", "ADMIN") gate — 404, never 403.
    expect(res.status).toBe(404);
  });
});

/**
 * The client's 2026-08-31 additions: an optional deadline, and a question type
 * that takes exactly one of its own options.
 */
describe("the closing date", () => {
  /** Publishes a CHILD-scope survey whose deadline is already in the past. */
  async function expiredSurvey() {
    const { surveyId, questionId } = await publishedChildSurvey();
    await db.survey.update({
      where: { id: surveyId },
      data: { closesAt: new Date(Date.now() - 60_000) },
    });
    return { surveyId, questionId };
  }

  it("refuses a response after the closing date", async () => {
    const { surveyId, questionId } = await expiredSurvey();

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ childId: a.child.id, answers: [{ questionId, value: 4 }] });

    expect(res.status).toBe(400);
  });

  /*
   * The deadline is an intention, not a state — nothing sweeps it — so a survey
   * that has stopped accepting answers is still PUBLISHED. Asserted because the
   * alternative implementation (a job that flips the status) would pass the
   * test above while behaving differently for every reader of the list.
   */
  it("leaves the survey PUBLISHED rather than closing it", async () => {
    const { surveyId, questionId } = await expiredSurvey();

    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: 4 }],
    });

    const row = await db.survey.findUniqueOrThrow({ where: { id: surveyId } });
    expect(row.status).toBe("PUBLISHED");
    expect(row.closedAt).toBeNull();
  });

  it("accepts a response when no closing date is set", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ childId: a.child.id, answers: [{ questionId, value: 4 }] });

    expect(res.status).toBe(201);
  });

  it("accepts a response before the closing date", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();
    await db.survey.update({
      where: { id: surveyId },
      data: { closesAt: new Date(Date.now() + 86_400_000) },
    });

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ childId: a.child.id, answers: [{ questionId, value: 4 }] });

    expect(res.status).toBe(201);
  });
});

describe("SINGLE_CHOICE questions", () => {
  /** A published CHILD-scope survey with one single-choice question. */
  async function singleChoiceSurvey() {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({ title: "Аялалд оролцох эсэх", scope: "CHILD", kind: "POLL", groupId: a.group.id });

    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
      questions: [
        {
          order: 0,
          type: "SINGLE_CHOICE",
          prompt: "Оролцох уу?",
          options: ["Тийм", "Үгүй"],
        },
      ],
    });

    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), teacherA);

    const withQuestions = await db.survey.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { questions: true },
    });
    return { surveyId: created.body.id as string, questionId: withQuestions.questions[0]!.id };
  }

  it("refuses a question with no options, as CHECKBOX does", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      adminA,
    ).send({ title: "Судалгаа", scope: "KINDERGARTEN" });

    const res = await authed(
      request(server()).put(`/v1/surveys/${created.body.id}/questions`),
      teacherA,
    ).send({ questions: [{ order: 0, type: "SINGLE_CHOICE", prompt: "Аль нь вэ?" }] });

    expect(res.status).toBe(400);
  });

  it("accepts one of the offered options", async () => {
    const { surveyId, questionId } = await singleChoiceSurvey();

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ childId: a.child.id, answers: [{ questionId, value: "Тийм" }] });

    expect(res.status).toBe(201);
  });

  it("refuses an answer that is not one of the options", async () => {
    const { surveyId, questionId } = await singleChoiceSurvey();

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ childId: a.child.id, answers: [{ questionId, value: "Магадгүй" }] });

    expect(res.status).toBe(400);
  });

  /*
   * The case the validation exists for: an array would store cleanly and then
   * appear in the results chart as a bucket named "Тийм,Үгүй" that no option
   * produces — a question that looks answered and reads as nonsense.
   */
  it("refuses an array, which would make it a CHECKBOX", async () => {
    const { surveyId, questionId } = await singleChoiceSurvey();

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ childId: a.child.id, answers: [{ questionId, value: ["Тийм", "Үгүй"] }] });

    expect(res.status).toBe(400);
  });
});

describe("responding — CHILD scope", () => {
  it("a guardian submits a response for their own child", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ childId: a.child.id, answers: [{ questionId, value: 4 }] });

    expect(res.status).toBe(201);

    const answer = await db.surveyAnswer.findFirstOrThrow({ where: { responseId: res.body.id } });
    expect(answer.value).toBe(4);
  });

  it("rejects a second submission for the same child", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: 4 }],
    });

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({
      childId: a.child.id,
      answers: [{ questionId, value: 5 }],
    });

    expect(res.status).toBe(400);
  });

  it("a guardian of another child gets 404", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentB,
    ).send({ childId: a.child.id, answers: [{ questionId, value: 3 }] });

    expect(res.status).toBe(404);
  });

  it("requires a childId for a CHILD-scope survey", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ answers: [{ questionId, value: 3 }] });

    expect(res.status).toBe(400);
  });
});

describe("responding — KINDERGARTEN scope", () => {
  it("any member answers once, with no child attached", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      adminA,
    ).send({ title: "Ерөнхий санал асуулга", scope: "KINDERGARTEN" });
    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
      questions: [{ order: 0, type: "TEXT", prompt: "Санал хүсэлт" }],
    });
    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), teacherA);

    const withQuestions = await db.survey.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { questions: true },
    });
    const questionId = withQuestions.questions[0]!.id;

    const res = await authed(
      request(server()).post(`/v1/surveys/${created.body.id}/responses`),
      parentA,
    ).send({ answers: [{ questionId, value: "Сайн байна" }] });

    expect(res.status).toBe(201);
  });

  it("a member of another kindergarten gets 404", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      adminA,
    ).send({ title: "x", scope: "KINDERGARTEN" });
    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
      questions: [{ order: 0, type: "TEXT", prompt: "y" }],
    });
    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), teacherA);

    const withQuestions = await db.survey.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { questions: true },
    });

    const res = await authed(
      request(server()).post(`/v1/surveys/${created.body.id}/responses`),
      parentB,
    ).send({ answers: [{ questionId: withQuestions.questions[0]!.id, value: "z" }] });

    expect(res.status).toBe(404);
  });
});

describe("the child-facing list", () => {
  it("marks respondedByMe once the guardian has answered", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    const before = await authed(
      request(server()).get(`/v1/children/${a.child.id}/surveys`),
      parentA,
    );
    expect(before.body[0].respondedByMe).toBe(false);

    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: 5 }],
    });

    const after = await authed(
      request(server()).get(`/v1/children/${a.child.id}/surveys`),
      parentA,
    );
    expect(after.body[0].respondedByMe).toBe(true);
  });

  it("a guardian of another child gets 404", async () => {
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/surveys`), parentB);
    expect(res.status).toBe(404);
  });
});

describe("results — staff only", () => {
  it("aggregates RATING answers into counts", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: 4 }],
    });

    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/results`), adminA);

    expect(res.status).toBe(200);
    expect(res.body.totalResponses).toBe(1);
    expect(res.body.questions[0].counts["4"]).toBe(1);
  });

  it("a parent cannot see results", async () => {
    const { surveyId } = await publishedChildSurvey();
    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/results`), parentA);
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Results, group by group — RFP Module 1.2's comparison, cut the other way
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ★ A problem in one group disappears into an average across four, and
 * disappearing is what a survey is run to stop.
 *
 * The results endpoint answered one question — "what did families say" — and
 * these cover the second: "did this group say something different". The group
 * comes from the child the answer is *about*, never from the respondent: a
 * guardian belongs to no group, and a family with two children in two groups
 * answers twice.
 */
describe("results by group", () => {
  /** A second group with a child and a guardian who can answer for them. */
  async function secondGroupChild() {
    const group = await db.group.create({
      data: {
        kindergartenId: a.kindergarten.id,
        schoolYearId: a.schoolYear.id,
        name: "Наран бүлэг",
        ageBand: "MIDDLE",
      },
    });
    const child = await createChild(a.kindergarten.id, {
      lastName: "Наран",
      firstName: "Тэмүүжин",
    });
    await enrollChild(a.kindergarten.id, child.id, group.id, a.schoolYear.id);
    await linkGuardian(a.kindergarten.id, child.id, a.parentUser.id);
    return { group, child };
  }

  async function answer(surveyId: string, questionId: string, childId: string, value: number) {
    return authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId,
      answers: [{ questionId, value }],
    });
  }

  it("splits the answers by the group the child is in", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();
    const other = await secondGroupChild();

    await answer(surveyId, questionId, a.child.id, 5);
    await answer(surveyId, questionId, other.child.id, 2);

    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/results`), teacherA);
    expect(res.status).toBe(200);

    const names = res.body.byGroup.map((g: { group: { name: string } }) => g.group.name);
    expect(names).toContain(a.group.name);
    expect(names).toContain("Наран бүлэг");

    const naran = res.body.byGroup.find(
      (g: { group: { name: string } }) => g.group.name === "Наран бүлэг",
    );
    expect(naran.responseCount).toBe(1);
    expect(naran.questions[0].counts).toEqual({ "2": 1 });
  });

  /**
   * ★ Responses, not answers.
   *
   * One response carries one answer per question, so counting answer rows would
   * report "24 хариулт" for a six-question survey four families answered.
   */
  it("counts responses rather than answer rows", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({ title: "Хоёр асуулттай", scope: "CHILD", groupId: a.group.id });

    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
      questions: [
        { order: 0, type: "RATING", prompt: "Нэг" },
        { order: 1, type: "RATING", prompt: "Хоёр" },
      ],
    });
    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), teacherA);

    const survey = await db.survey.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { questions: { orderBy: { order: "asc" } } },
    });

    await authed(request(server()).post(`/v1/surveys/${survey.id}/responses`), parentA).send({
      childId: a.child.id,
      answers: survey.questions.map((q) => ({ questionId: q.id, value: 4 })),
    });

    const res = await authed(request(server()).get(`/v1/surveys/${survey.id}/results`), teacherA);
    expect(res.body.totalResponses).toBe(1);
    expect(res.body.byGroup[0].responseCount).toBe(1);
  });

  /**
   * ★ The filter narrows the headline and leaves the breakdown whole.
   *
   * A comparison filtered to one group is a chart with one bar, so `byGroup`
   * ignores `groupId` by design.
   */
  it("narrows the totals but never the comparison", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();
    const other = await secondGroupChild();

    await answer(surveyId, questionId, a.child.id, 5);
    await answer(surveyId, questionId, other.child.id, 2);

    const res = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/results?groupId=${other.group.id}`),
      teacherA,
    );

    expect(res.body.totalResponses).toBe(1);
    expect(res.body.questions[0].counts).toEqual({ "2": 1 });
    // Both groups still on the chart.
    expect(res.body.byGroup).toHaveLength(2);
  });

  it("rejects a group id that is not a uuid", async () => {
    const { surveyId } = await publishedChildSurvey();
    const res = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/results?groupId=naran`),
      teacherA,
    );
    expect(res.status).toBe(400);
  });

  it("keeps a guardian out of the results entirely", async () => {
    const { surveyId } = await publishedChildSurvey();
    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/results`), parentA);
    expect(res.status).toBe(404);
  });
});

/**
 * The family's side of a poll — the client's 2026-09-10 request: "Авсан
 * асуулгууд фэйсбүүкийн пост шиг эцэг эх дарахаар шууд хувь үзүүлэлт нь
 * харагдана. Эцэг эх түүн дээр нэмж шинэ хариулт үүсгэж болно."
 *
 * ★ Two routes that a guardian may call against child data, so §4.1's three
 * cases are mandatory and are asserted for both.
 *
 * ★★ The write is the unusual one and gets the most attention here. It is the
 * only place in the product where a parent edits an object a teacher owns, and
 * everything that keeps that narrow is a test below: polls only, open polls
 * only, option-bearing questions only, bounded, append-only, and never a form.
 */
async function publishedPoll(options = ["Ирнэ", "Ирэхгүй"]) {
  const created = await authed(
    request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
    teacherA,
  ).send({ title: "Аялалд оролцох уу?", scope: "CHILD", kind: "POLL", groupId: a.group.id });

  await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
    questions: [{ order: 0, type: "SINGLE_CHOICE", prompt: "Аялалд оролцох уу?", options }],
  });

  await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), teacherA);

  const withQuestions = await db.survey.findUniqueOrThrow({
    where: { id: created.body.id },
    include: { questions: true },
  });
  return { surveyId: created.body.id as string, questionId: withQuestions.questions[0]!.id };
}

const tallyUrl = (childId: string, surveyId: string) =>
  `/v1/children/${childId}/surveys/${surveyId}/tally`;

const optionsUrl = (childId: string, surveyId: string, questionId: string) =>
  `/v1/children/${childId}/surveys/${surveyId}/questions/${questionId}/options`;

describe("a poll's tally, as the family sees it", () => {
  it("lists every choice with its count, including one nobody picked", async () => {
    const { surveyId, questionId } = await publishedPoll();

    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: "Ирнэ" }],
    });

    const res = await authed(request(server()).get(tallyUrl(a.child.id, surveyId)), parentA);

    expect(res.status).toBe(200);
    expect(res.body.respondedByMe).toBe(true);
    expect(res.body.questions[0].totalResponses).toBe(1);
    // "Ирэхгүй" has no votes and is still a bar — on a poll the empty choice
    // is the interesting one, and it is every choice for the first reader.
    expect(res.body.questions[0].options).toEqual([
      { label: "Ирнэ", count: 1 },
      { label: "Ирэхгүй", count: 0 },
    ]);
  });

  it("says which choice is this family's, and nobody else's", async () => {
    const { surveyId, questionId } = await publishedPoll();

    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: "Ирэхгүй" }],
    });

    const res = await authed(request(server()).get(tallyUrl(a.child.id, surveyId)), parentA);

    expect(res.body.questions[0].myAnswer).toBe("Ирэхгүй");
    // The payload carries counts and the asker's own answer. Nothing in it
    // names a respondent — a parent must not be able to work out how another
    // family voted, which is why the tally and `myAnswer` are two queries.
    expect(JSON.stringify(res.body)).not.toContain(a.parentUser.id);
  });

  it("reports nothing chosen before the family has answered", async () => {
    const { surveyId } = await publishedPoll();

    const res = await authed(request(server()).get(tallyUrl(a.child.id, surveyId)), parentA);

    expect(res.status).toBe(200);
    expect(res.body.respondedByMe).toBe(false);
    expect(res.body.questions[0].myAnswer).toBeNull();
    expect(res.body.questions[0].options).toEqual([
      { label: "Ирнэ", count: 0 },
      { label: "Ирэхгүй", count: 0 },
    ]);
  });

  /**
   * ★ A questionnaire's aggregate is not a family's to read.
   *
   * 404 rather than 403: a form the teacher has published to this very child
   * exists and is answerable, but its results belong to staff, and saying
   * "that exists and is not yours" is the confirmation §1.7 forbids.
   */
  it("gives 404 for a form rather than a form's results", async () => {
    const { surveyId } = await publishedChildSurvey();

    const res = await authed(request(server()).get(tallyUrl(a.child.id, surveyId)), parentA);

    expect(res.status).toBe(404);
  });

  it("guardian of another child gets 404", async () => {
    const { surveyId } = await publishedPoll();

    const res = await authed(request(server()).get(tallyUrl(a.child.id, surveyId)), parentB);

    expect(res.status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    const { surveyId } = await publishedPoll();
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(request(server()).get(tallyUrl(a.child.id, surveyId)), teacherB);

    expect(res.status).toBe(404);
  });

  /**
   * ★ The poll must be on *this* child's board, not merely in the kindergarten.
   *
   * A poll addressed to one group is invisible to a family in another, and the
   * tally has to answer that the same way the list does — otherwise the id
   * alone would read a poll the family cannot see on any screen.
   */
  it("gives 404 for a poll addressed to another group", async () => {
    const otherGroup = await db.group.findFirstOrThrow({ where: { id: a.group.id } });

    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({
      title: "Өөр бүлгийн асуулга",
      scope: "CHILD",
      kind: "POLL",
      groupId: a.group.id,
    });

    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
      questions: [{ order: 0, type: "SINGLE_CHOICE", prompt: "Уу?", options: ["A", "B"] }],
    });
    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), teacherA);

    // Move the child out of the poll's audience by ending their enrolment.
    await db.enrollment.updateMany({
      where: { childId: a.child.id, groupId: otherGroup.id },
      data: { status: "ENDED" },
    });
    await db.survey.update({
      where: { id: created.body.id },
      data: { groupId: otherGroup.id },
    });

    const res = await authed(request(server()).get(tallyUrl(a.child.id, created.body.id)), parentA);

    expect(res.status).toBe(404);
  });
});

describe("a family adding a choice to a poll", () => {
  it("appends the option and returns the new list", async () => {
    const { surveyId, questionId } = await publishedPoll();

    const res = await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentA,
    ).send({ label: "Хожим шийднэ" });

    expect(res.status).toBe(201);
    expect(res.body.added).toBe(true);
    expect(res.body.options).toEqual(["Ирнэ", "Ирэхгүй", "Хожим шийднэ"]);

    // And it is a real choice: the tally draws it immediately.
    const tally = await authed(request(server()).get(tallyUrl(a.child.id, surveyId)), parentA);
    expect(tally.body.questions[0].options).toContainEqual({ label: "Хожим шийднэ", count: 0 });
  });

  /**
   * ★ A duplicate is success, not an error.
   *
   * Two families type "Хожим шийднэ" within a second of each other; the second
   * one wanted that choice to exist and it does. Failing them would report a
   * race as their mistake.
   */
  it("treats a choice somebody already added as success, without duplicating it", async () => {
    const { surveyId, questionId } = await publishedPoll();

    await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentA,
    ).send({ label: "Хожим шийднэ" });

    const again = await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentA,
    ).send({ label: "хожим   шийднэ" });

    expect(again.status).toBe(201);
    expect(again.body.added).toBe(false);
    expect(again.body.options).toEqual(["Ирнэ", "Ирэхгүй", "Хожим шийднэ"]);
  });

  it("records who added it", async () => {
    const { surveyId, questionId } = await publishedPoll();

    await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentA,
    ).send({ label: "Хожим шийднэ" });

    const entry = await db.auditLog.findFirst({
      where: { objectType: "SurveyQuestion", objectId: questionId },
    });

    expect(entry?.actorUserId).toBe(a.parentUser.id);
    expect(entry?.metadata).toMatchObject({ addedOption: "Хожим шийднэ" });
  });

  /** ★ Append-only. A parent may add a choice and never remove or rewrite one. */
  it("never removes or rewrites the teacher's own choices", async () => {
    const { surveyId, questionId } = await publishedPoll();

    await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentA,
    ).send({ label: "Хожим шийднэ" });

    const question = await db.surveyQuestion.findUniqueOrThrow({ where: { id: questionId } });
    expect(question.options).toEqual(["Ирнэ", "Ирэхгүй", "Хожим шийднэ"]);
  });

  it("stops at the cap rather than growing without bound", async () => {
    const { surveyId, questionId } = await publishedPoll(
      Array.from({ length: 20 }, (_, i) => `Сонголт ${i + 1}`),
    );

    const res = await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentA,
    ).send({ label: "Нэг илүү" });

    expect(res.status).toBe(400);
  });

  it("refuses a blank label", async () => {
    const { surveyId, questionId } = await publishedPoll();

    const res = await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentA,
    ).send({ label: "   " });

    expect(res.status).toBe(400);
  });

  /** A closed poll grows no new choices — the same deadline `submitResponse` enforces. */
  it("refuses once the poll has closed", async () => {
    const { surveyId, questionId } = await publishedPoll();
    await db.survey.update({
      where: { id: surveyId },
      data: { closesAt: new Date(Date.now() - 60_000) },
    });

    const res = await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentA,
    ).send({ label: "Хожим шийднэ" });

    expect(res.status).toBe(400);
  });

  it("refuses a question that carries no option list", async () => {
    const { surveyId } = await publishedPoll();
    const question = await db.surveyQuestion.findFirstOrThrow({ where: { surveyId } });
    await db.surveyQuestion.update({ where: { id: question.id }, data: { type: "TEXT" } });

    const res = await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, question.id)),
      parentA,
    ).send({ label: "Хожим шийднэ" });

    expect(res.status).toBe(400);
  });

  it("gives 404 on a form's question rather than editing it", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    const res = await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentA,
    ).send({ label: "Хожим шийднэ" });

    expect(res.status).toBe(404);
  });

  it("guardian of another child gets 404", async () => {
    const { surveyId, questionId } = await publishedPoll();

    const res = await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      parentB,
    ).send({ label: "Хожим шийднэ" });

    expect(res.status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    const { surveyId, questionId } = await publishedPoll();
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(
      request(server()).post(optionsUrl(a.child.id, surveyId, questionId)),
      teacherB,
    ).send({ label: "Хожим шийднэ" });

    expect(res.status).toBe(404);
  });

  /** A question from another poll, named against this one — the id is the client's. */
  it("gives 404 for a question belonging to a different poll", async () => {
    const mine = await publishedPoll();
    const other = await publishedPoll(["Тийм", "Үгүй"]);

    const res = await authed(
      request(server()).post(optionsUrl(a.child.id, mine.surveyId, other.questionId)),
      parentA,
    ).send({ label: "Хожим шийднэ" });

    expect(res.status).toBe(404);
  });
});

/**
 * "23 / 35 харуулсан" on every card — the client's 2026-09-10 list design.
 *
 * ★ The point of these is the denominator, not the numerator.
 *
 * `expectedCount` is who was *asked*, and the two scopes ask different
 * populations: a CHILD survey once per enrolled child, a KINDERGARTEN one once
 * per parent however many children they have. Getting that wrong makes a
 * family of three look like three non-responders on a survey they answered,
 * and it is the kind of wrong that looks plausible on screen.
 *
 * ★★ Counted in three queries for the whole list rather than two per row —
 * §3.4. Nothing here asserts the query count (`query-counts.test.ts` is where
 * that guard lives); these assert that batching did not change the answers.
 */
describe("the staff list's participation counts", () => {
  it("counts a group's children as the audience of a group survey", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёрдугаар" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({ title: "Бүлгийн судалгаа", scope: "CHILD", groupId: a.group.id });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    );

    const row = res.body.find((s: { id: string }) => s.id === created.body.id);
    expect(row.expectedCount).toBe(2);
    expect(row.respondedCount).toBe(0);
  });

  it("counts answers as they arrive", async () => {
    const { surveyId, questionId } = await publishedChildSurvey();

    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: 4 }],
    });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    );

    const row = res.body.find((s: { id: string }) => s.id === surveyId);
    expect(row.respondedCount).toBe(1);
  });

  /**
   * ★ A parent of two children is one respondent on a kindergarten-wide survey.
   *
   * The CHILD denominator would say two, and the card would read "1 / 2" for a
   * family that has answered everything asked of them.
   */
  it("counts parents, not children, for a kindergarten-wide survey", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Дүү" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);
    await linkGuardian(a.kindergarten.id, second.id, a.parentUser.id);

    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      adminA,
    ).send({ title: "Цэцэрлэгийн судалгаа", scope: "KINDERGARTEN" });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    );

    const row = res.body.find((s: { id: string }) => s.id === created.body.id);
    // One parent in this kindergarten, guardian of two children.
    expect(row.expectedCount).toBe(1);
  });

  /** Another kindergarten's rows never reach these totals — §3.1. */
  it("never counts another kindergarten's responses", async () => {
    const { surveyId } = await publishedChildSurvey();

    const created = await authed(
      request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/surveys`),
      await login(app, b.teacherUser.username),
    ).send({ title: "Өөр цэцэрлэгийн судалгаа", scope: "CHILD" });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    );

    expect(res.body.map((s: { id: string }) => s.id)).toContain(surveyId);
    expect(res.body.map((s: { id: string }) => s.id)).not.toContain(created.body.id);
  });
});

/**
 * Whose audience is whose — client, 2026-09-10: "багш ... зөвхөн өөрийн
 * бүлэгтээ л судалгаа авна. Удирдлага л бүх цэцэрлэг болон бүлэг сонгон
 * судалгаа ... оруулж болно."
 *
 * ★ The same rule as the notice board's, deliberately.
 *
 * It lives once, in `TenantAccessService.assertCanAddressAudience`, and
 * `notifications.test.ts` covers its edges in depth — the mixed list, the
 * unassigned teacher, the widening edit. What is asserted here is that surveys
 * are actually wired to it, because a rule that exists and is not called is
 * the §1.1 failure in its most convincing form: the code reads correctly and
 * the endpoint checks nothing.
 */
describe("who may survey whom", () => {
  const create = (session: AuthSession, body: Record<string, unknown>) =>
    authed(request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`), session).send({
      title: "Судалгаа",
      scope: "CHILD",
      ...body,
    });

  it("lets a teacher survey a group they teach", async () => {
    expect((await create(teacherA, { groupId: a.group.id })).status).toBe(201);
  });

  /**
   * ★ Omitting `groupId` is not a smaller request than sending one.
   *
   * `Survey.groupId: null` means every group, including families who enrol
   * next month, so the field's absence asks for the widest audience the
   * product has.
   */
  it("refuses a teacher the whole kindergarten", async () => {
    expect((await create(teacherA, {})).status).toBe(404);
  });

  it("refuses a teacher a group they do not teach", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Тэдний биш бүлэг");

    expect((await create(teacherA, { groupId: other.id })).status).toBe(404);
  });

  it("lets an administrator do both", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Аль ч бүлэг");

    expect((await create(adminA, {})).status).toBe(201);
    expect((await create(adminA, { groupId: other.id })).status).toBe(201);
  });

  /**
   * ★ 404 before 400 — the order of the two checks is itself the assertion.
   *
   * A group from another kindergarten fails the tenant check with 400
   * ("Бүлэг олдсонгүй"), which for an administrator is the right answer. A
   * teacher must not reach it: the audience rule runs first and answers 404,
   * so the response cannot tell them whether that id names a real group.
   */
  it("tells a teacher nothing about a group in another kindergarten", async () => {
    expect((await create(teacherA, { groupId: b.group.id })).status).toBe(404);
    expect((await create(adminA, { groupId: b.group.id })).status).toBe(400);
  });
});

/**
 * ★ Each group's own denominator on the results breakdown — the client's
 * 2026-09-10 design, "5 / 6 (83%)".
 *
 * The bars used to be scaled against whichever group had replied most, which
 * answers "who replied most" — a question nobody asks. What a director wants
 * is how close each group is to done, and only the API can know a group's
 * roster.
 */
describe("the results breakdown's per-group denominator", () => {
  it("counts the group's own enrolled children", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёрдугаар" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    const { surveyId, questionId } = await publishedChildSurvey();
    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: 4 }],
    });

    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/results`), adminA);

    const row = res.body.byGroup.find(
      (entry: { group: { id: string } }) => entry.group.id === a.group.id,
    );
    expect(row.responseCount).toBe(1);
    expect(row.expectedChildren).toBe(2);
  });

  /**
   * ★ "Бүлэггүй" gets zero, not the kindergarten's total.
   *
   * A response with no child belongs to no group and has no roster to be a
   * share of. Reporting the kindergarten there would draw that bar against
   * everybody, which is the one reading guaranteed to be wrong.
   */
  it("gives the group-less bucket no roster at all", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      adminA,
    ).send({ title: "Ажилтнуудад", scope: "KINDERGARTEN" });

    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), adminA).send({
      questions: [{ order: 0, type: "YES_NO", prompt: "Тийм үү?" }],
    });
    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), adminA);

    const withQuestions = await db.survey.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { questions: true },
    });

    await authed(request(server()).post(`/v1/surveys/${created.body.id}/responses`), teacherA).send(
      { answers: [{ questionId: withQuestions.questions[0]!.id, value: true }] },
    );

    const res = await authed(
      request(server()).get(`/v1/surveys/${created.body.id}/results`),
      adminA,
    );

    const row = res.body.byGroup.find(
      (entry: { group: { id: string | null } }) => entry.group.id === null,
    );
    expect(row.responseCount).toBe(1);
    expect(row.expectedChildren).toBe(0);
  });
});

/**
 * The wizard's settings — client, 2026-09-10.
 *
 * ★ Every one of these is tested because every one of them *does* something.
 *
 * A toggle that stores a boolean nothing reads is worse than a missing
 * feature: it tells the person who set it that they have changed the survey.
 * So each case below is written against the behaviour the setting promises,
 * not against the column.
 *
 * ★★ And each asserts its default separately, because the defaults are the
 * contract with every survey written before the fields existed.
 */
describe("a survey's schedule", () => {
  async function pollOpening(opensAt: string | null, closesAt?: string) {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({
      title: "Хугацаатай",
      scope: "CHILD",
      groupId: a.group.id,
      ...(opensAt ? { opensAt } : {}),
      ...(closesAt ? { closesAt } : {}),
    });
    if (created.status !== 201) return { status: created.status, surveyId: null, questionId: null };

    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
      questions: [{ order: 0, type: "RATING", prompt: "Хэр вэ?" }],
    });
    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), teacherA);

    const withQuestions = await db.survey.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { questions: true },
    });
    return {
      status: created.status,
      surveyId: created.body.id as string,
      questionId: withQuestions.questions[0]!.id,
    };
  }

  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();
  const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();

  it("refuses an answer before the survey has opened", async () => {
    const { surveyId, questionId } = await pollOpening(tomorrow());

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ childId: a.child.id, answers: [{ questionId, value: 4 }] });

    expect(res.status).toBe(400);
  });

  it("accepts one once it has opened", async () => {
    const { surveyId, questionId } = await pollOpening(yesterday());

    const res = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/responses`),
      parentA,
    ).send({ childId: a.child.id, answers: [{ questionId, value: 4 }] });

    expect(res.status).toBe(201);
  });

  /**
   * ★ Not offered before it opens, either.
   *
   * `submitResponse` is the rule and refuses it regardless; this is the
   * courtesy beside it. Offering a family a survey that answers "хараахан
   * эхлээгүй" the moment they finish is worse than not offering it.
   */
  it("keeps an unopened survey off the family's list", async () => {
    const { surveyId } = await pollOpening(tomorrow());

    const list = await authed(request(server()).get(`/v1/children/${a.child.id}/surveys`), parentA);

    expect(list.body.map((s: { id: string }) => s.id)).not.toContain(surveyId);
  });

  it("still offers one with no opening date at all", async () => {
    const { surveyId } = await pollOpening(null);

    const list = await authed(request(server()).get(`/v1/children/${a.child.id}/surveys`), parentA);

    expect(list.body.map((s: { id: string }) => s.id)).toContain(surveyId);
  });

  /** A window that closes before it opens is refused at the door. */
  it("refuses a window that ends before it starts", async () => {
    const { status } = await pollOpening(tomorrow(), yesterday());
    expect(status).toBe(400);
  });
});

describe("answering more than once", () => {
  async function surveyAllowing(allowMultipleResponses: boolean) {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({
      title: "Долоо хоног бүрийн асуулга",
      scope: "CHILD",
      kind: "POLL",
      groupId: a.group.id,
      allowMultipleResponses,
    });

    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
      questions: [{ order: 0, type: "YES_NO", prompt: "Ирэх үү?" }],
    });
    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), teacherA);

    const withQuestions = await db.survey.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { questions: true },
    });
    return {
      surveyId: created.body.id as string,
      questionId: withQuestions.questions[0]!.id,
    };
  }

  const answer = (surveyId: string, questionId: string, value: boolean) =>
    authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value }],
    });

  /**
   * ★ The default is what the code did unconditionally before this field.
   *
   * A family's considered answers, submitted once — right for a questionnaire,
   * and the behaviour every existing survey relies on.
   */
  it("refuses a second answer by default", async () => {
    const { surveyId, questionId } = await surveyAllowing(false);

    expect((await answer(surveyId, questionId, true)).status).toBe(201);
    expect((await answer(surveyId, questionId, false)).status).toBe(400);
  });

  it("accepts a second answer when the survey allows it", async () => {
    const { surveyId, questionId } = await surveyAllowing(true);

    expect((await answer(surveyId, questionId, true)).status).toBe(201);
    expect((await answer(surveyId, questionId, false)).status).toBe(201);

    const results = await authed(request(server()).get(`/v1/surveys/${surveyId}/results`), adminA);
    expect(results.body.totalResponses).toBe(2);
  });
});

describe("an anonymous survey", () => {
  async function anonymousSurvey(isAnonymous: boolean) {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({
      title: "Нэргүй санал",
      scope: "CHILD",
      groupId: a.group.id,
      isAnonymous,
    });

    await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), teacherA).send({
      questions: [{ order: 0, type: "RATING", prompt: "Хэр вэ?" }],
    });
    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), teacherA);

    const withQuestions = await db.survey.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { questions: true },
    });
    const questionId = withQuestions.questions[0]!.id;

    await authed(request(server()).post(`/v1/surveys/${created.body.id}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId, value: 5 }],
    });

    return created.body.id as string;
  }

  /**
   * ★ Both halves of Оролцоо go, not only the answered list.
   *
   * A roster of everyone who has *not* replied names the others by
   * subtraction, which is the same disclosure with an extra step.
   */
  it("reports counts instead of names", async () => {
    const surveyId = await anonymousSurvey(true);

    const res = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/participation`),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body.anonymous).toBe(true);
    expect(res.body.answered).toEqual([]);
    expect(res.body.pending).toEqual([]);
    expect(res.body.answeredCount).toBe(1);
    // Nobody is named anywhere in the payload.
    expect(JSON.stringify(res.body)).not.toContain(a.child.firstName);
  });

  it("still names people on a survey that is not anonymous", async () => {
    const surveyId = await anonymousSurvey(false);

    const res = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/participation`),
      teacherA,
    );

    expect(res.body.anonymous).toBe(false);
    expect(res.body.answered).toHaveLength(1);
    expect(JSON.stringify(res.body)).toContain(a.child.firstName);
  });

  /**
   * ★ The raw sheet is where the promise is kept or broken — §4.3 asks the
   * assertion to be on extracted content, not on "did it produce a file".
   *
   * Sheet 2 is one row per answer carrying the child's name, group, age, sex
   * and who submitted it: a re-identification table for a survey that told
   * families their answers were unnamed.
   */
  it("keeps names out of the workbook", async () => {
    const surveyId = await anonymousSurvey(true);

    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/export`), adminA)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);

    const text = book.worksheets
      .flatMap((sheet) => {
        const rows: string[] = [];
        sheet.eachRow((row) => rows.push(row.values?.toString() ?? ""));
        return rows;
      })
      .join("\n");

    expect(text).not.toContain(a.child.firstName);
    expect(text).not.toContain(a.parentUser.lastName);
    // The group survives: it is not identifying and it is the unit every
    // analysis of this sheet is grouped by.
    expect(text).toContain(a.group.name);
  });
});
