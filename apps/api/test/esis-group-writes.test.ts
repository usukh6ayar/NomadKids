import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { EsisService } from "../src/integrations/esis/esis.service";
import { EsisWriteSender } from "../src/integrations/esis/esis-write.sender";
import { EsisWriteRequestService } from "../src/integrations/esis/esis-write.service";
import { EsisWriteQueue } from "../src/integrations/esis/esis-write.worker";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";

/*
 * Spec №3б — the three group writes behind prepare → approve → send.
 *
 * ★ **What this file cannot prove.** `test/setup.ts` deletes `ESIS_TOKEN`, so
 * every ESIS route here runs against a stub: nothing below says anything about
 * what the ministry does with a payload. What it does prove is the harness —
 * that the bytes shown are the bytes stored, that approving enqueues once, that
 * a sent row is never sent twice, and that no caller reaches another
 * kindergarten's group. The live half is `scripts/esis-probe.ts` and the
 * ordered exercise in the plan's Task 15.
 */

let app: INestApplication;
let scenario: Scenario;
let admin: AuthSession;

const INSTITUTION = "42778";

function url(kindergartenId: string, suffix = "") {
  return `/v1/kindergartens/${kindergartenId}/esis/group-writes${suffix}`;
}

/** A stubbed ESIS answer in the shape `EsisService.send` returns. */
function esisAnswer(data: Record<string, unknown>) {
  return { data, source: "LIVE" as const, durationMs: 1 } as never;
}

/*
 * ★ One of api-40's four rows for institution 42778, captured 2026-09-18 and
 * trimmed to what a write sends. `prepare` reads the ministry's groups live —
 * a create copies eight ids this database does not hold — so the suite has to
 * answer that read, and it answers with the ministry's own values rather than
 * invented ones.
 */
const MINISTRY_GROUPS = [
  {
    studentGroupId: "100006351517832",
    studentGroupName: "ахлах бүлэг",
    academicLevel: "17",
    academicLevelName: "Ахлах",
    programOfStudyId: "100000287145352",
    programStageId: "100000287145361",
    programPlanId: "100000287145358",
    groupTypeCode: "STREAM",
    groupShiftId: "108004001",
    groupClassificationId: "1",
    groupCategoryCode: "MAIN_STUDENT_GROUP",
    academicGroupId: "42778",
    academicYear: "2026",
  },
];

/** Answers prepare's live group read. */
function stubMinistryGroups(rows: Record<string, unknown>[] = MINISTRY_GROUPS) {
  app.get(EsisService).read = (async () => ({
    data: rows,
    source: "LIVE",
    durationMs: 1,
  })) as never;
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();
  scenario = await createScenario("write");
  admin = await login(app, scenario.adminUser.username);
  await testDb().kindergarten.update({
    where: { id: scenario.kindergarten.id },
    data: { esisInstitutionId: INSTITUTION, esisMappedAt: new Date() },
  });
  /*
   * The fixture group is the ministry's Ахлах level, and its name is shortened
   * to five characters — 150's own rule, learned live on 2026-09-18: "Анги
   * бүлгийн нэрийг 5 буюу түүнээс багаар өгнө үү!". `createScenario` names
   * groups longer than that, which is realistic and is exactly why the refusal
   * has its own tests rather than being left to surprise a director.
   */
  await testDb().group.update({
    where: { id: scenario.group.id },
    data: { ageBand: "MIDDLE", name: "ЗЗЗ01" },
  });
  scenario.group.name = "ЗЗЗ01";
  stubMinistryGroups();
});

describe("preparing a group write", () => {
  it("stores the payload it showed, and shows the payload it stored", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    expect(res.status).toBe(201);
    expect(res.body.state).toBe("PREPARED");
    expect(res.body.payload).toMatchObject({
      institutionId: Number(INSTITUTION),
      event: "create",
      academicYear: "2026",
      studentGroupName: scenario.group.name,
      // Copied from the ministry's Ахлах row, never computed.
      academicLevel: "17",
      programStageId: "100000287145361",
    });

    const row = await testDb().esisWriteRequest.findFirstOrThrow({ where: { id: res.body.id } });
    expect(row.payload).toEqual(res.body.payload);
    expect(row.sentAt).toBeNull();
    expect(row.apiId).toBe(150);
  });

  /*
   * ★ ESIS honours no idempotency header, so this collision is ours to make.
   * Two directors pressing the same button must not produce two groups.
   */
  it("returns the first row when the same write is prepared twice", async () => {
    const body = { service: "groupCreate", groupId: scenario.group.id };

    const first = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send(body);
    const second = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send(body);

    expect(second.body.id).toBe(first.body.id);
    expect(await testDb().esisWriteRequest.count()).toBe(1);
  });

  /*
   * ★ The ministry's own name rule, met where a director can act on it. 150
   * answers "Анги бүлгийн нэрийг 5 буюу түүнээс багаар өгнө үү!" and nothing
   * else in this product limits `Group.name`, so an ordinary "Дэлбээ" is six
   * characters and would have failed after approval.
   */
  it("refuses a group whose name ESIS will not accept", async () => {
    await testDb().group.update({
      where: { id: scenario.group.id },
      data: { name: "Дэлбээ" },
    });

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    expect(res.status).toBe(400);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  it("refuses an update for a group ESIS has never seen", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({ service: "groupUpdate", groupId: scenario.group.id });

    expect(res.status).toBe(400);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  /*
   * ★ The refusal the roster forces. `User.esisPersonId` is filled only when a
   * teacher registers themselves against `EsisStaffRoster`, so a teacher an
   * administrator created by hand has none — and a director must learn that
   * before approving, not from a job that fails afterwards.
   */
  it("refuses an instructor write for a teacher with no ESIS person id", async () => {
    await testDb().group.update({
      where: { id: scenario.group.id },
      data: { esisGroupId: "100006351517832" },
    });

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({ service: "groupInstructor", groupId: scenario.group.id });

    expect(res.status).toBe(400);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  /*
   * ★★ 162 assigns the group's teacher, with the five fields the ministry
   * documents and `event: "CREATE"` — assigning is a create, and `UPDATE`
   * changes only a role. The id and the role are read together from the same
   * `GroupTeacher` row, so a group's lead cannot be sent under the assistant's
   * role.
   */
  it("assigns the group's teacher, with the role in the words our screens use", async () => {
    await testDb().group.update({
      where: { id: scenario.group.id },
      data: { esisGroupId: "100006351517832" },
    });
    await testDb().user.update({
      where: { id: scenario.teacherUser.id },
      data: { esisPersonId: "5512" },
    });

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({ service: "groupInstructor", groupId: scenario.group.id });

    expect(res.status).toBe(201);
    expect(res.body.apiId).toBe(162);
    expect(res.body.payload).toEqual({
      event: "CREATE",
      institutionId: Number(INSTITUTION),
      studentGroupId: 100006351517832,
      instructorId: 5512,
      instructorRole: "Үндсэн",
    });
  });
});

describe("approving a group write", () => {
  async function prepared() {
    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("moves to APPROVED and enqueues exactly one job", async () => {
    const id = await prepared();

    const added: string[] = [];
    app.get(EsisWriteQueue).add = async (writeRequestId: string) => {
      added.push(writeRequestId);
    };

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id, `/${id}/approve`)),
      admin,
    ).send({});

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("APPROVED");
    expect(added).toEqual([id]);

    const row = await testDb().esisWriteRequest.findFirstOrThrow({ where: { id } });
    expect(row.approvedById).toBe(scenario.adminUser.id);
    // Approving is not sending. The worker does that, and only once.
    expect(row.sentAt).toBeNull();
  });

  it("refuses to approve a write that has already been sent", async () => {
    const id = await prepared();
    await testDb().esisWriteRequest.update({
      where: { id },
      data: { state: "SENT", sentAt: new Date() },
    });

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id, `/${id}/approve`)),
      admin,
    ).send({});

    expect(res.status).toBe(409);
  });

  /*
   * ★★ The gate, still enforced and still worth a test even though it is open.
   *
   * It stood shut for a day and paid for itself: the payload this branch
   * shipped on the morning of 2026-09-18 was wrong in structure, and the gate
   * is what kept it out of the ministry's register until the live probe found
   * out. If a future service's contract comes into doubt, closing it again must
   * still stop an approval dead — so that is asserted here rather than assumed
   * from a constant nobody exercises.
   */
  it("refuses to approve anything while the contract is unproven", async () => {
    const id = await prepared();
    app.get(EsisWriteRequestService).contractProven = () => false;

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id, `/${id}/approve`)),
      admin,
    ).send({});

    expect(res.status).toBe(409);
    const row = await testDb().esisWriteRequest.findFirstOrThrow({ where: { id } });
    expect(row.state).toBe("PREPARED");
    expect(row.approvedById).toBeNull();
  });

  it("cancels a prepared write without sending anything", async () => {
    const id = await prepared();

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id, `/${id}/cancel`)),
      admin,
    ).send({});

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("CANCELLED");
  });
});

/*
 * ★★ The one failure this design cannot recover from. A retried `150` creates a
 * second group in the ministry's register and nothing here can remove it, so
 * the guard gets tests of its own rather than being trusted because it is
 * short.
 */
describe("the sender's one guarantee", () => {
  async function preparedId() {
    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });
    return res.body.id as string;
  }

  it("sends nothing for a row that already has sentAt", async () => {
    const id = await preparedId();
    await testDb().esisWriteRequest.update({
      where: { id },
      data: { state: "APPROVED", sentAt: new Date(), response: { ok: true } },
    });

    let calls = 0;
    app.get(EsisService).sendGroupCreate = async () => {
      calls += 1;
      return esisAnswer({});
    };

    await app.get(EsisWriteSender).send(id);

    expect(calls).toBe(0);
  });

  it("sends nothing for a row nobody approved", async () => {
    const id = await preparedId();

    let calls = 0;
    app.get(EsisService).sendGroupCreate = async () => {
      calls += 1;
      return esisAnswer({});
    };

    await app.get(EsisWriteSender).send(id);

    expect(calls).toBe(0);
    const row = await testDb().esisWriteRequest.findFirstOrThrow({ where: { id } });
    expect(row.state).toBe("PREPARED");
  });

  /*
   * ★ A create's answer is an input, not just a record: it is the only moment
   * the ministry's own group id is ever sent to us, and an update or a delete
   * cannot be built without it.
   */
  it("stamps the ministry's group id onto our group when a create succeeds", async () => {
    const id = await preparedId();
    await testDb().esisWriteRequest.update({
      where: { id },
      data: { state: "APPROVED", approvedById: scenario.adminUser.id },
    });

    app.get(EsisService).sendGroupCreate = async () =>
      esisAnswer({ studentGroupId: "100006351517832" });

    await app.get(EsisWriteSender).send(id);

    const row = await testDb().esisWriteRequest.findFirstOrThrow({ where: { id } });
    expect(row.state).toBe("SENT");
    expect(row.sentAt).not.toBeNull();

    const group = await testDb().group.findFirstOrThrow({ where: { id: scenario.group.id } });
    expect(group.esisGroupId).toBe("100006351517832");
  });

  it("records a failure without pretending it was sent", async () => {
    const id = await preparedId();
    await testDb().esisWriteRequest.update({
      where: { id },
      data: { state: "APPROVED", approvedById: scenario.adminUser.id },
    });

    app.get(EsisService).sendGroupCreate = async () => {
      throw new Error("boom");
    };

    await app.get(EsisWriteSender).send(id);

    const row = await testDb().esisWriteRequest.findFirstOrThrow({ where: { id } });
    expect(row.state).toBe("FAILED");
    expect(row.sentAt).toBeNull();
    expect(row.errorCode).toBeTruthy();
  });
});

describe("deleting a group in ESIS", () => {
  beforeEach(async () => {
    await testDb().group.update({
      where: { id: scenario.group.id },
      data: { esisGroupId: "100006351517832" },
    });
  });

  it("refuses without the group's name typed back", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({ service: "groupDelete", groupId: scenario.group.id });

    expect(res.status).toBe(400);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  /*
   * ★ Spec №3б §5. There is no undo, so 152's delete is opened only against a
   * group this system created in ESIS itself — which is what keeps the one live
   * exercise on a throwaway group rather than on a real class.
   */
  it("refuses a group this system did not create in ESIS", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({
      service: "groupDelete",
      groupId: scenario.group.id,
      confirmGroupName: scenario.group.name,
    });

    expect(res.status).toBe(400);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  it("prepares a delete for a group it created itself", async () => {
    await testDb().esisWriteRequest.create({
      data: {
        kindergartenId: scenario.kindergarten.id,
        service: "groupCreate",
        apiId: 150,
        groupId: scenario.group.id,
        payload: { institutionId: Number(INSTITUTION), event: "create" },
        idempotencyKey: "seed-create",
        preparedById: scenario.adminUser.id,
        state: "SENT",
        sentAt: new Date(),
        response: { studentGroupId: "100006351517832" },
      },
    });

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({
      service: "groupDelete",
      groupId: scenario.group.id,
      confirmGroupName: scenario.group.name,
    });

    expect(res.status).toBe(201);
    expect(res.body.payload).toEqual({
      institutionId: Number(INSTITUTION),
      event: "delete",
      academicYear: "2026",
      studentGroupId: "100006351517832",
    });
    expect(res.body.apiId).toBe(152);
  });
});

describe("who may write a group to ESIS", () => {
  it("a teacher of this kindergarten cannot prepare one", async () => {
    const teacher = await login(app, scenario.teacherUser.username);

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      teacher,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    expect([403, 404]).toContain(res.status);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  it("an administrator of another kindergarten gets 404", async () => {
    const other = await createScenario("other");
    const otherAdmin = await login(app, other.adminUser.username);

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      otherAdmin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    expect(res.status).toBe(404);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  /*
   * ★ The one that matters most. The tenant check has already passed here, so
   * this is an administrator naming somebody else's group id — and a 403 would
   * confirm it exists (CLAUDE.md §1.7).
   */
  it("a group from another kindergarten gets 404", async () => {
    const other = await createScenario("third");

    const res = await authed(
      request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
      admin,
    ).send({ service: "groupCreate", groupId: other.group.id });

    expect(res.status).toBe(404);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  it("another kindergarten's write request is 404 to approve", async () => {
    const other = await createScenario("fourth");
    await testDb().kindergarten.update({
      where: { id: other.kindergarten.id },
      data: { esisInstitutionId: "42779", esisMappedAt: new Date() },
    });
    await testDb().group.update({
      where: { id: other.group.id },
      data: { ageBand: "MIDDLE", name: "ЗЗЗ02" },
    });
    const otherAdmin = await login(app, other.adminUser.username);

    const theirs = await authed(
      request(app.getHttpServer()).post(url(other.kindergarten.id)),
      otherAdmin,
    ).send({ service: "groupCreate", groupId: other.group.id });
    expect(theirs.status).toBe(201);

    const res = await authed(
      request(app.getHttpServer()).post(
        url(scenario.kindergarten.id, `/${theirs.body.id}/approve`),
      ),
      admin,
    ).send({});

    expect(res.status).toBe(404);
  });
});

describe("the write queue", () => {
  it("lists this kindergarten's writes, newest first, paginated", async () => {
    const second = await testDb().group.create({
      data: {
        kindergartenId: scenario.kindergarten.id,
        schoolYearId: scenario.schoolYear.id,
        name: "ЗЗЗ03",
        ageBand: "MIDDLE",
      },
    });

    for (const groupId of [scenario.group.id, second.id]) {
      const res = await authed(
        request(app.getHttpServer()).post(url(scenario.kindergarten.id)),
        admin,
      ).send({ service: "groupCreate", groupId });
      expect(res.status).toBe(201);
    }

    const res = await authed(
      request(app.getHttpServer()).get(`${url(scenario.kindergarten.id)}?page=1&pageSize=1`),
      admin,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0].group.id).toBe(second.id);
  });

  it("never lists another kindergarten's writes", async () => {
    const other = await createScenario("fifth");
    await testDb().kindergarten.update({
      where: { id: other.kindergarten.id },
      data: { esisInstitutionId: "42779", esisMappedAt: new Date() },
    });
    const otherAdmin = await login(app, other.adminUser.username);
    await authed(request(app.getHttpServer()).post(url(other.kindergarten.id)), otherAdmin).send({
      service: "groupCreate",
      groupId: other.group.id,
    });

    const res = await authed(
      request(app.getHttpServer()).get(url(scenario.kindergarten.id)),
      admin,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});
