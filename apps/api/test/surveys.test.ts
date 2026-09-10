import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createChild,
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

/** Creates a DRAFT CHILD-scope survey with one RATING question and publishes it. */
async function publishedChildSurvey(session = teacherA) {
  const created = await authed(
    request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
    session,
  ).send({ title: "Хичээлийн жилийн эхэн", scope: "CHILD" });

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
      teacherA,
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
      teacherA,
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
      teacherA,
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
    ).send({ title: "Аялалд оролцох эсэх", scope: "CHILD", kind: "POLL" });

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
      teacherA,
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
      teacherA,
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
      teacherA,
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
    ).send({ title: "Хоёр асуулттай", scope: "CHILD" });

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
