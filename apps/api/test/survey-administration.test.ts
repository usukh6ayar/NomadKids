import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
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
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * "Удирдлагын судалгаа" — the administration's surveys, read by a teacher.
 * Client, 2026-09-17.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let teacherB: AuthSession;

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
});

const server = () => app.getHttpServer();

async function publishSurvey(
  session: AuthSession,
  body: { title: string; groupId?: string | null },
  publish = true,
) {
  const created = await authed(
    request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
    session,
  ).send({ scope: "CHILD", ...body });
  expect(created.status).toBe(201);

  await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), session).send({
    questions: [
      { order: 0, type: "RATING", prompt: "Хоолны чанар ямар байна?" },
      { order: 1, type: "YES_NO", prompt: "Хүүхэд тань дуртай юу?" },
    ],
  });

  if (publish) {
    await authed(request(server()).post(`/v1/surveys/${created.body.id}/publish`), session);
  }

  const row = await db.survey.findUniqueOrThrow({
    where: { id: created.body.id },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  return { surveyId: row.id, questionIds: row.questions.map((q) => q.id) };
}

const listUrl = () => `/v1/kindergartens/${a.kindergarten.id}/surveys/administration`;
const countUrl = () => `${listUrl()}/unread-count`;

describe("the administration's surveys, as a teacher reads them", () => {
  it("lists an administrator's survey with its questions, its count and the office as author", async () => {
    const { surveyId, questionIds } = await publishSurvey(adminA, { title: "Хоолны судалгаа" });

    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), parentA).send({
      childId: a.child.id,
      answers: [{ questionId: questionIds[0], value: "4" }],
    });

    const res = await authed(request(server()).get(listUrl()), teacherA);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const [item] = res.body.items;
    expect(item.id).toBe(surveyId);
    expect(item.title).toBe("Хоолны судалгаа");
    expect(item.questions.map((q: { prompt: string }) => q.prompt)).toEqual([
      "Хоолны чанар ямар байна?",
      "Хүүхэд тань дуртай юу?",
    ]);
    expect(item.respondedCount).toBe(1);
    expect(item.expectedCount).toBe(1);
    expect(item.isRead).toBe(false);
    expect(item).not.toHaveProperty("createdById");
  });

  it("counts it unread until the teacher opens it, and only for that teacher", async () => {
    const { surveyId } = await publishSurvey(adminA, { title: "Хоолны судалгаа" });

    const secondTeacher = await createUser({ username: `teacher-a2-${Date.now()}` });
    const membership = await createMembership(secondTeacher.id, a.kindergarten.id, "TEACHER");
    await assignTeacher(a.kindergarten.id, a.group.id, membership.id);
    const teacherA2 = await login(app, secondTeacher.username);

    expect((await authed(request(server()).get(countUrl()), teacherA)).body).toEqual({
      count: 1,
      total: 1,
    });

    const seen = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/administration/seen`),
      teacherA,
    );
    expect(seen.status).toBe(201);
    // Twice is the same as once.
    await authed(request(server()).post(`/v1/surveys/${surveyId}/administration/seen`), teacherA);

    // Opened: nothing new, but it is still one survey the administration asked.
    expect((await authed(request(server()).get(countUrl()), teacherA)).body).toEqual({
      count: 0,
      total: 1,
    });
    expect((await authed(request(server()).get(countUrl()), teacherA2)).body.count).toBe(1);

    const detail = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/administration`),
      teacherA,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.isRead).toBe(true);
  });

  it("leaves out drafts and the teacher's own surveys", async () => {
    await publishSurvey(adminA, { title: "Ноорог" }, false);
    await publishSurvey(teacherA, { title: "Багшийн өөрийн", groupId: a.group.id });

    const res = await authed(request(server()).get(listUrl()), teacherA);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect((await authed(request(server()).get(countUrl()), teacherA)).body.count).toBe(0);
  });

  it("does not show an administrator the survey they published themselves", async () => {
    await publishSurvey(adminA, { title: "Хоолны судалгаа" });
    const res = await authed(request(server()).get(listUrl()), adminA);
    expect(res.body.total).toBe(0);
  });
});

describe("authorization", () => {
  it("teacher from another group gets 404", async () => {
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id);
    const { surveyId } = await publishSurvey(adminA, {
      title: "Нөгөө бүлгийн",
      groupId: otherGroup.id,
    });

    const list = await authed(request(server()).get(listUrl()), teacherA);
    expect(list.body.total).toBe(0);

    const detail = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/administration`),
      teacherA,
    );
    expect(detail.status).toBe(404);

    const seen = await authed(
      request(server()).post(`/v1/surveys/${surveyId}/administration/seen`),
      teacherA,
    );
    expect(seen.status).toBe(404);
  });

  it("guardian of another child gets 404", async () => {
    const { surveyId } = await publishSurvey(adminA, { title: "Хоолны судалгаа" });

    expect((await authed(request(server()).get(listUrl()), parentA)).status).toBe(404);
    expect((await authed(request(server()).get(countUrl()), parentA)).status).toBe(404);
    expect(
      (await authed(request(server()).get(`/v1/surveys/${surveyId}/administration`), parentA))
        .status,
    ).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    const { surveyId } = await publishSurvey(adminA, { title: "Хоолны судалгаа" });

    expect((await authed(request(server()).get(listUrl()), teacherB)).status).toBe(404);
    expect((await authed(request(server()).get(countUrl()), teacherB)).status).toBe(404);
    expect(
      (await authed(request(server()).get(`/v1/surveys/${surveyId}/administration`), teacherB))
        .status,
    ).toBe(404);
    expect(
      (
        await authed(
          request(server()).post(`/v1/surveys/${surveyId}/administration/seen`),
          teacherB,
        )
      ).status,
    ).toBe(404);
    expect(await db.surveyStaffRead.count()).toBe(0);
  });
});
