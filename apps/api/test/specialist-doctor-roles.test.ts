import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
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
 * Биеийн тамирын багш, Хөгжмийн багш, Эмч — the user, 2026-10-15.
 *
 * - A PE/music teacher reaches the children of the groups the director
 *   assigns (`GroupSpecialist`): their cards, without health, ids or family
 *   contacts, and their observations. Nothing else.
 * - The doctor reaches every child's health record in the kindergarten, and
 *   nothing of the development record.
 *
 * ★ Like `staff-roles.test.ts`, most of this file is refusals. 404 throughout.
 */

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let pe: AuthSession;
let peMembershipId: string;
let peAssignmentId: string;
let doctor: AuthSession;
/** A child of kindergarten A in a group the PE teacher is NOT assigned to. */
let otherGroupChildId: string;
let otherGroupId: string;
let typeId: string;

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
  teacherA = await login(app, a.teacherUser.username);

  await db.child.update({
    where: { id: a.child.id },
    data: { healthNotes: "Астма", nationalId: "УБ21010101" },
  });

  const otherGroup = await createGroup(a.kindergarten.id, a.schoolYear.id, `Б-${uniq()}`);
  otherGroupId = otherGroup.id;
  const otherChild = await createChild(a.kindergarten.id);
  await enrollChild(a.kindergarten.id, otherChild.id, otherGroup.id, a.schoolYear.id);
  otherGroupChildId = otherChild.id;

  const peUser = await createUser({ username: uniq("pe") });
  peMembershipId = (await createMembership(peUser.id, a.kindergarten.id, "PE_TEACHER")).id;
  pe = await login(app, peUser.username);

  // Assigned through the real route — the director's own act.
  const assigned = await authed(
    request(server()).post(`/v1/groups/${a.group.id}/specialists`),
    adminA,
  ).send({ membershipId: peMembershipId });
  expect(assigned.status).toBe(201);
  peAssignmentId = assigned.body.id;

  const doctorUser = await createUser({ username: uniq("doctor") });
  await createMembership(doctorUser.id, a.kindergarten.id, "DOCTOR");
  doctor = await login(app, doctorUser.username);

  typeId = (await db.observationType.findFirstOrThrow({ where: { code: "daily" } })).id;
});

const get = (path: string, session: AuthSession) => authed(request(server()).get(path), session);

describe("a PE or music teacher", () => {
  it("opens an assigned group's child card without health, ids or family contacts", async () => {
    const res = await get(`/v1/children/${a.child.id}`, pe);

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe(a.child.firstName);
    expect(res.body.healthNotes).toBeNull();
    expect(res.body.nationalId).toBeNull();
    expect(res.body.guardianships).toEqual([]);
  });

  it("lists only the assigned group's children, without their national ids", async () => {
    const res = await get("/v1/children?page=1&pageSize=50", pe);

    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([a.child.id]);
    expect(res.body.items[0].nationalId).toBeNull();
    expect(res.body.items[0].profile.health).toBe(false);
  });

  it("files an observation, edits their own, and cannot edit the class teacher's", async () => {
    const own = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      pe,
    ).send({ typeId, observedOn: "2026-10-01", situation: "Бөмбөг шидэх" });
    expect(own.status).toBe(201);

    const edit = await authed(request(server()).patch(`/v1/observations/${own.body.id}`), pe).send({
      situation: "Бөмбөг холоос шидэх",
    });
    expect(edit.status).toBe(200);

    const teachers = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      teacherA,
    ).send({ typeId, observedOn: "2026-10-01", situation: "Багшийн тэмдэглэл" });
    expect(teachers.status).toBe(201);

    const foreign = await authed(
      request(server()).patch(`/v1/observations/${teachers.body.id}`),
      pe,
    ).send({ situation: "Өөрчилсөн" });
    expect(foreign.status).toBe(404);
    const archive = await authed(
      request(server()).delete(`/v1/observations/${teachers.body.id}`),
      pe,
    );
    expect(archive.status).toBe(404);

    const list = await get(`/v1/children/${a.child.id}/observations`, pe);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
  });

  it("gets 404 for a child of another group in the same kindergarten", async () => {
    for (const path of [
      `/v1/children/${otherGroupChildId}`,
      `/v1/children/${otherGroupChildId}/observations`,
    ]) {
      expect((await get(path, pe)).status, path).toBe(404);
    }
  });

  it("gets 404 for a child of another kindergarten", async () => {
    for (const path of [`/v1/children/${b.child.id}`, `/v1/children/${b.child.id}/observations`]) {
      expect((await get(path, pe)).status, path).toBe(404);
    }
  });

  it("gets 404 on their own group's health, register, money, family and portfolio", async () => {
    for (const path of [
      `/v1/children/${a.child.id}/health`,
      `/v1/children/${a.child.id}/growth`,
      `/v1/children/${a.child.id}/finance`,
      `/v1/children/${a.child.id}/guardians`,
      `/v1/children/${a.child.id}/portfolio`,
      `/v1/children/${a.child.id}/enrollments`,
      `/v1/groups/${a.group.id}/meals`,
      `/v1/groups/${a.group.id}/assessment`,
    ]) {
      expect([400, 404], path).toContain((await get(path, pe)).status);
    }
    const allergy = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      pe,
    ).send({ kind: "FOOD", severity: "MILD", allergen: "сүү", notedOn: "2026-10-01" });
    expect(allergy.status).toBe(404);
  });

  it("is not staff: cannot post to the board", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/notifications`),
      pe,
    ).send({ title: "Мэдээ", body: "Текст" });
    expect([400, 404]).toContain(res.status);
    expect(res.status).not.toBe(201);
  });

  it("loses the group on the next request once the director ends the assignment", async () => {
    const ended = await authed(
      request(server()).delete(`/v1/group-specialists/${peAssignmentId}`),
      adminA,
    );
    expect(ended.status).toBe(200);

    expect((await get(`/v1/children/${a.child.id}`, pe)).status).toBe(404);
  });

  it("gains nothing when the role is changed to TEACHER — the assignment is not a teacher's", async () => {
    const changed = await authed(
      request(server()).patch(`/v1/memberships/${peMembershipId}`),
      adminA,
    ).send({ role: "TEACHER" });
    expect(changed.status).toBe(200);

    for (const path of [`/v1/children/${a.child.id}`, `/v1/children/${a.child.id}/health`]) {
      expect((await get(path, pe)).status, path).toBe(404);
    }
  });

  it("can only be assigned by this kindergarten's director, and only as a specialist", async () => {
    const asTeacher = await authed(
      request(server()).post(`/v1/groups/${otherGroupId}/specialists`),
      adminA,
    ).send({ membershipId: a.teacherMembership.id });
    expect(asTeacher.status).toBe(400);

    const adminB = await login(app, b.adminUser.username);
    const crossTenant = await authed(
      request(server()).post(`/v1/groups/${otherGroupId}/specialists`),
      adminB,
    ).send({ membershipId: peMembershipId });
    expect(crossTenant.status).toBe(404);

    const byTeacher = await authed(
      request(server()).post(`/v1/groups/${otherGroupId}/specialists`),
      teacherA,
    ).send({ membershipId: peMembershipId });
    expect(byTeacher.status).toBe(404);

    const listed = await get(`/v1/groups/${a.group.id}/specialists`, adminA);
    expect(listed.body.map((row: { membershipId: string }) => row.membershipId)).toEqual([
      peMembershipId,
    ]);
  });

  it("lands on its own dashboard", async () => {
    const res = await get("/v1/dashboard/primary", pe);
    expect(res.body.dashboard).toBe("specialist");
  });

  it("loses the group when deactivated, and does not get it back on reactivation", async () => {
    // ★ As with a class teacher's GroupTeacher row: left open, reactivating the
    // membership would silently restore a group nobody re-granted.
    const revoked = await authed(
      request(server()).delete(`/v1/memberships/${peMembershipId}`),
      adminA,
    );
    expect(revoked.status).toBe(204);

    const row = await db.groupSpecialist.findUniqueOrThrow({ where: { id: peAssignmentId } });
    expect(row.endedOn).not.toBeNull();
  });
});

describe("the doctor", () => {
  it("reads and writes every child's health record in the kindergarten", async () => {
    for (const childId of [a.child.id, otherGroupChildId]) {
      expect((await get(`/v1/children/${childId}/health`, doctor)).status).toBe(200);
      expect((await get(`/v1/children/${childId}/growth`, doctor)).status).toBe(200);
    }

    const allergy = await authed(
      request(server()).post(`/v1/children/${otherGroupChildId}/health/allergies`),
      doctor,
    ).send({
      kind: "FOOD",
      severity: "SEVERE",
      allergen: "самар",
      reaction: "Амьсгал давчдах",
      treatment: "Эпипен",
      notedOn: "2026-09-15",
    });
    expect(allergy.status).toBe(201);
  });

  it("sees the full card and every child in the list", async () => {
    const card = await get(`/v1/children/${a.child.id}`, doctor);
    expect(card.status).toBe(200);
    expect(card.body.healthNotes).toBe("Астма");

    const list = await get("/v1/children?page=1&pageSize=50", doctor);
    expect(list.body.items.map((c: { id: string }) => c.id).sort()).toEqual(
      [a.child.id, otherGroupChildId].sort(),
    );
  });

  it("gets 404 on the development record, the money and the family", async () => {
    for (const path of [
      `/v1/children/${a.child.id}/observations`,
      `/v1/children/${a.child.id}/portfolio`,
      `/v1/children/${a.child.id}/finance`,
      `/v1/children/${a.child.id}/guardians`,
      `/v1/groups/${a.group.id}/assessment`,
      `/v1/groups/${a.group.id}/meals`,
    ]) {
      expect([400, 404], path).toContain((await get(path, doctor)).status);
    }
  });

  it("gets 404 for a child of another kindergarten", async () => {
    for (const path of [`/v1/children/${b.child.id}`, `/v1/children/${b.child.id}/health`]) {
      expect((await get(path, doctor)).status, path).toBe(404);
    }
    const list = await get("/v1/children?page=1&pageSize=50", doctor);
    expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(b.child.id);
  });

  it("lands on its own dashboard", async () => {
    const res = await get("/v1/dashboard/primary", doctor);
    expect(res.body.dashboard).toBe("doctor");
  });
});

describe("the roles that already existed", () => {
  it("a teacher of another group still gets 404 on a child's health", async () => {
    expect((await get(`/v1/children/${otherGroupChildId}/health`, teacherA)).status).toBe(404);
  });

  it("a guardian of another child still gets 404 on the card and health", async () => {
    const parentB = await login(app, b.parentUser.username);
    for (const path of [`/v1/children/${a.child.id}`, `/v1/children/${a.child.id}/health`]) {
      expect((await get(path, parentB)).status, path).toBe(404);
    }
  });
});
