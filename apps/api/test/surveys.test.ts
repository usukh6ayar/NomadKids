import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
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
  app.get(RateLimitService).resetAll();

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
