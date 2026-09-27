import type { INestApplication } from "@nestjs/common";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * "Багшийн судалгаа" — a survey a teacher fills in for each child of their
 * own group. Client, 2026-09-21.
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

async function publishTeacherSurvey(session: AuthSession, groupId: string | null = a.group.id) {
  const created = await authed(
    request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
    session,
  ).send({
    title: "Гарааны үнэлгээ",
    scope: "CHILD",
    respondent: "TEACHER",
    period: "BASELINE",
    groupId,
  });
  expect(created.status).toBe(201);
  expect(created.body.respondent).toBe("TEACHER");

  await authed(request(server()).put(`/v1/surveys/${created.body.id}/questions`), session).send({
    questions: [
      { order: 0, type: "RATING", prompt: "Хэл ярианы хөгжил" },
      { order: 1, type: "YES_NO", prompt: "Бие даан хувцасладаг уу?" },
    ],
  });
  const published = await authed(
    request(server()).post(`/v1/surveys/${created.body.id}/publish`),
    session,
  );
  expect(published.status).toBe(201);

  const row = await db.survey.findUniqueOrThrow({
    where: { id: created.body.id },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  return { surveyId: row.id, questionIds: row.questions.map((q) => q.id) };
}

function answer(session: AuthSession, surveyId: string, childId: string, questionIds: string[]) {
  return authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), session).send({
    childId,
    answers: [
      { questionId: questionIds[0], value: 4 },
      { questionId: questionIds[1], value: true },
    ],
  });
}

function saveSheet(
  session: AuthSession,
  surveyId: string,
  responses: { childId: string; answers: { questionId: string | undefined; value: unknown }[] }[],
) {
  return authed(request(server()).put(`/v1/surveys/${surveyId}/teacher-sheet`), session).send({
    responses,
  });
}

describe("creating a teacher survey", () => {
  it("refuses a shape that cannot be filled in per child", async () => {
    const url = `/v1/kindergartens/${a.kindergarten.id}/surveys`;
    for (const body of [
      { scope: "KINDERGARTEN" },
      { scope: "CHILD", kind: "POLL" },
      { scope: "CHILD", isAnonymous: true },
      { scope: "CHILD", allowMultipleResponses: true },
    ]) {
      const res = await authed(request(server()).post(url), teacherA).send({
        title: "Үнэлгээ",
        respondent: "TEACHER",
        groupId: a.group.id,
        ...body,
      });
      expect(res.status).toBe(400);
    }
  });

  it("defaults every survey to a family's", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({ title: "Хоолны судалгаа", scope: "CHILD", groupId: a.group.id });
    expect(res.status).toBe(201);
    expect(res.body.respondent).toBe("GUARDIAN");
  });
});

describe("filling in a teacher survey", () => {
  it("lets the child's teacher assess them once, and reads it back", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(teacherA);

    const first = await answer(teacherA, surveyId, a.child.id, questionIds);
    expect(first.status).toBe(201);

    const again = await answer(adminA, surveyId, a.child.id, questionIds);
    expect(again.status).toBe(400);

    const sheet = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/teacher-sheet`),
      teacherA,
    );
    expect(sheet.status).toBe(200);
    expect(sheet.body.survey.questions).toHaveLength(2);
    const [row] = sheet.body.rows;
    expect(row.child.id).toBe(a.child.id);
    expect(row.response.respondent.id).toBe(a.teacherUser.id);
    expect(row.response.answers).toEqual(
      expect.arrayContaining([
        { questionId: questionIds[0], value: 4 },
        { questionId: questionIds[1], value: true },
      ]),
    );
  });

  it("counts the assessment towards the survey's progress", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(teacherA);
    await answer(teacherA, surveyId, a.child.id, questionIds);

    const participation = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/participation`),
      teacherA,
    );
    expect(participation.status).toBe(200);
    expect(participation.body.answeredCount).toBe(1);
    expect(participation.body.pending).toHaveLength(0);
  });

  it("refuses a child outside the survey's group", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(adminA);
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id);
    const child = await createChild(a.kindergarten.id, { firstName: "Сарнай" });
    await enrollChild(a.kindergarten.id, child.id, otherGroup.id, a.schoolYear.id);

    const res = await answer(adminA, surveyId, child.id, questionIds);
    expect(res.status).toBe(400);
  });

  it("teacher from another group gets 404", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(adminA);

    const submit = await answer(otherGroupTeacher, surveyId, a.child.id, questionIds);
    expect(submit.status).toBe(404);

    const read = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/teacher-sheet`),
      otherGroupTeacher,
    );
    expect(read.status).toBe(404);

    const save = await saveSheet(otherGroupTeacher, surveyId, [
      { childId: a.child.id, answers: [{ questionId: questionIds[0], value: 2 }] },
    ]);
    expect(save.status).toBe(404);
  });

  it("guardian gets 404 — even for their own child", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(teacherA);

    const submit = await answer(parentA, surveyId, a.child.id, questionIds);
    expect(submit.status).toBe(404);

    const read = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/teacher-sheet`),
      parentA,
    );
    expect(read.status).toBe(404);

    const save = await saveSheet(parentA, surveyId, [
      { childId: a.child.id, answers: [{ questionId: questionIds[0], value: 2 }] },
    ]);
    expect(save.status).toBe(404);
  });

  it("user from another kindergarten gets 404", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(teacherA);

    const submit = await answer(teacherB, surveyId, a.child.id, questionIds);
    expect(submit.status).toBe(404);

    const read = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/teacher-sheet`),
      teacherB,
    );
    expect(read.status).toBe(404);

    const save = await saveSheet(teacherB, surveyId, [
      { childId: a.child.id, answers: [{ questionId: questionIds[0], value: 2 }] },
    ]);
    expect(save.status).toBe(404);

    // Nor may B's teacher assess their own child against A's survey.
    const cross = await answer(teacherB, surveyId, b.child.id, questionIds);
    expect(cross.status).toBe(404);
  });

  it("a family survey has no teacher sheet", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({ title: "Хоолны судалгаа", scope: "CHILD", groupId: a.group.id });

    const res = await authed(
      request(server()).get(`/v1/surveys/${created.body.id}/teacher-sheet`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });
});

describe("the sheet — every child in one table", () => {
  it("saves several children at once, and a correction replaces the row", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(teacherA);
    const second = await createChild(a.kindergarten.id, { firstName: "Номин" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    const first = await saveSheet(teacherA, surveyId, [
      {
        childId: a.child.id,
        answers: [
          { questionId: questionIds[0], value: 1 },
          { questionId: questionIds[1], value: false },
        ],
      },
      {
        childId: second.id,
        answers: [
          { questionId: questionIds[0], value: 5 },
          { questionId: questionIds[1], value: true },
        ],
      },
    ]);
    expect(first.status).toBe(200);
    expect(first.body.saved).toBe(2);

    const corrected = await saveSheet(teacherA, surveyId, [
      {
        childId: a.child.id,
        answers: [
          { questionId: questionIds[0], value: 3 },
          { questionId: questionIds[1], value: true },
        ],
      },
    ]);
    expect(corrected.status).toBe(200);

    const sheet = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/teacher-sheet`),
      teacherA,
    );
    const row = sheet.body.rows.find((r: { child: { id: string } }) => r.child.id === a.child.id);
    expect(row.response.answers).toEqual(
      expect.arrayContaining([{ questionId: questionIds[0], value: 3 }]),
    );

    // The first answer is soft-deleted, not overwritten, and counted once.
    expect(await db.surveyResponse.count({ where: { surveyId } })).toBe(3);
    expect(await db.surveyResponse.count({ where: { surveyId, deletedAt: null } })).toBe(2);
    const participation = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/participation`),
      teacherA,
    );
    expect(participation.body.answeredCount).toBe(2);
  });

  it("refuses an answer the question cannot hold", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(teacherA);
    const res = await saveSheet(teacherA, surveyId, [
      { childId: a.child.id, answers: [{ questionId: questionIds[0], value: [1, 2] }] },
    ]);
    expect(res.status).toBe(400);
  });

  it("refuses a closed survey", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(teacherA);
    await authed(request(server()).post(`/v1/surveys/${surveyId}/close`), teacherA);
    const res = await saveSheet(teacherA, surveyId, [
      { childId: a.child.id, answers: [{ questionId: questionIds[0], value: 2 }] },
    ]);
    expect(res.status).toBe(400);
  });

  it("shows a teacher only their own groups on a kindergarten-wide survey", async () => {
    const { surveyId } = await publishTeacherSurvey(adminA, null);
    const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id);
    const stranger = await createChild(a.kindergarten.id, { firstName: "Ану" });
    await enrollChild(a.kindergarten.id, stranger.id, otherGroup.id, a.schoolYear.id);

    const asTeacher = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/teacher-sheet`),
      teacherA,
    );
    expect(asTeacher.body.rows.map((r: { child: { id: string } }) => r.child.id)).toEqual([
      a.child.id,
    ]);

    const asAdmin = await authed(
      request(server()).get(`/v1/surveys/${surveyId}/teacher-sheet`),
      adminA,
    );
    expect(asAdmin.body.rows).toHaveLength(2);

    const save = await saveSheet(teacherA, surveyId, [
      {
        childId: stranger.id,
        answers: [{ questionId: asAdmin.body.survey.questions[0].id, value: 2 }],
      },
    ]);
    expect(save.status).toBe(404);
  });
});

describe("running a teacher survey again and comparing", () => {
  it("names every question itself, so a clone pairs with its source", async () => {
    const { surveyId } = await publishTeacherSurvey(teacherA);
    const questions = await db.surveyQuestion.findMany({ where: { surveyId } });
    expect(questions.every((q) => q.indicatorKey?.startsWith("q_"))).toBe(true);
  });

  it("compares the clone with the first wave, per child and by name", async () => {
    // A 0/1 scale written as a single choice — the client's own table.
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({
      title: "Өнгө ялгах",
      scope: "CHILD",
      respondent: "TEACHER",
      period: "BASELINE",
      groupId: a.group.id,
    });
    const first = created.body.id as string;
    await authed(request(server()).put(`/v1/surveys/${first}/questions`), teacherA).send({
      questions: [
        { order: 0, type: "SINGLE_CHOICE", prompt: "Өнгө ялгадаг уу?", options: ["0", "1"] },
      ],
    });
    await authed(request(server()).post(`/v1/surveys/${first}/publish`), teacherA);
    const [q1] = await db.surveyQuestion.findMany({ where: { surveyId: first } });
    await saveSheet(teacherA, first, [
      { childId: a.child.id, answers: [{ questionId: q1!.id, value: "0" }] },
    ]);

    const clone = await authed(request(server()).post(`/v1/surveys/${first}/clone`), teacherA).send(
      {
        period: "ENDLINE",
      },
    );
    expect(clone.status).toBe(201);
    expect(clone.body.respondent).toBe("TEACHER");
    const second = clone.body.id as string;
    await authed(request(server()).post(`/v1/surveys/${second}/publish`), teacherA);
    const [q2] = await db.surveyQuestion.findMany({ where: { surveyId: second } });
    expect(q2!.indicatorKey).toBe(q1!.indicatorKey);
    await saveSheet(teacherA, second, [
      { childId: a.child.id, answers: [{ questionId: q2!.id, value: "1" }] },
    ]);

    const res = await authed(request(server()).get(`/v1/surveys/${second}/comparison`), teacherA);
    expect(res.status).toBe(200);
    expect(res.body.baseline.id).toBe(first);
    expect(res.body.indicators).toHaveLength(1);
    expect(res.body.indicators[0]).toMatchObject({
      baselineMean: 0,
      endlineMean: 1,
      maxScore: 1,
      deltaPercent: 100,
    });
    expect(res.body.children).toHaveLength(1);
    expect(res.body.children[0].child).toMatchObject({
      id: a.child.id,
      firstName: a.child.firstName,
    });
  });

  it("takes the А/79 fourth level — 49 criteria, one 0/1 question each", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/surveys`),
      teacherA,
    ).send({ title: "А/79 IV", scope: "CHILD", respondent: "TEACHER", groupId: a.group.id });
    const surveyId = created.body.id as string;
    const questions = Array.from({ length: 49 }, (_, order) => ({
      order,
      type: "SINGLE_CHOICE",
      prompt: `Шалгуур ${order + 1}`,
      options: ["0", "1"],
    }));
    const saved = await authed(
      request(server()).put(`/v1/surveys/${surveyId}/questions`),
      teacherA,
    ).send({ questions });
    expect(saved.status).toBe(200);
    await authed(request(server()).post(`/v1/surveys/${surveyId}/publish`), teacherA);

    const rows = await db.surveyQuestion.findMany({
      where: { surveyId },
      orderBy: { order: "asc" },
    });
    const res = await saveSheet(teacherA, surveyId, [
      {
        childId: a.child.id,
        answers: rows.map((q, i) => ({ questionId: q.id, value: i % 2 ? "1" : "0" })),
      },
    ]);
    expect(res.status).toBe(200);
    expect(await db.surveyAnswer.count({ where: { response: { surveyId } } })).toBe(49);
  });

  it("another kindergarten's teacher gets 404 on the comparison", async () => {
    const { surveyId } = await publishTeacherSurvey(teacherA);
    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/comparison`), teacherB);
    expect(res.status).toBe(404);
  });
});

describe("Эксэл татах — a teacher survey as a workbook", () => {
  it("downloads the sheet, naming the teacher as the respondent", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(teacherA);
    await answer(teacherA, surveyId, a.child.id, questionIds);

    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/export`), teacherA)
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
    expect(text).toContain(a.child.firstName);
    expect(text).toContain("Багш");
  });

  it("puts every question in one table, answered or not, and opens on it", async () => {
    const { surveyId, questionIds } = await publishTeacherSurvey(teacherA);
    // Only the first of the two questions is answered.
    await authed(request(server()).post(`/v1/surveys/${surveyId}/responses`), teacherA).send({
      childId: a.child.id,
      answers: [{ questionId: questionIds[0], value: 4 }],
    });

    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/export`), teacherA)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);

    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      "Нэгтгэл",
      "Түүхий өгөгдөл",
      "Хүүхдийн харьцуулалт",
      "Бүлгийн харьцуулалт",
      "Жилийн харьцуулалт",
      "Асуулт, хариулт",
    ]);
    expect(book.views[0]?.activeTab).toBe(5);

    const table = book.getWorksheet("Асуулт, хариулт")!;
    const header = (table.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([
      "№",
      "Бүлэг",
      "Хүүхдийн нэр",
      "Бөглөсөн",
      "Огноо",
      "1. Хэл ярианы хөгжил",
      "2. Бие даан хувцасладаг уу?",
    ]);
    const row = (table.getRow(2).values as unknown[]).slice(1);
    expect(row[2]).toBe(`${a.child.lastName} ${a.child.firstName}`);
    expect(row.slice(5)).toEqual(["4", "—"]);

    const summary: string[] = [];
    book.getWorksheet("Нэгтгэл")!.eachRow((r) => summary.push(r.values?.toString() ?? ""));
    expect(summary.join("\n")).toContain("2. Бие даан хувцасладаг уу?".slice(3));
  });

  it("another kindergarten's teacher gets 404", async () => {
    const { surveyId } = await publishTeacherSurvey(teacherA);
    const res = await authed(request(server()).get(`/v1/surveys/${surveyId}/export`), teacherB);
    expect(res.status).toBe(404);
  });
});

describe("what a family is shown", () => {
  it("never lists a teacher survey on the child's surveys", async () => {
    const { surveyId } = await publishTeacherSurvey(teacherA);

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/surveys`), parentA);
    expect(res.status).toBe(200);
    expect(res.body.map((s: { id: string }) => s.id)).not.toContain(surveyId);
  });

  it("does not count an administrator's teacher survey as the administration asking families", async () => {
    await publishTeacherSurvey(adminA);

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/surveys/administration`),
      teacherA,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});
