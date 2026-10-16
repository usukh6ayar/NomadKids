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

  it("loses the child's card once the child moves to a group they are not assigned to", async () => {
    // ★ D2 reversed (2026-10-16): the group the child attends, not every group
    // they ever did.
    const moved = await authed(
      request(server()).post(`/v1/children/${a.child.id}/enrollments`),
      adminA,
    ).send({ groupId: otherGroupId });
    expect(moved.status).toBe(201);

    expect((await get(`/v1/children/${a.child.id}`, pe)).status).toBe(404);
    const roster = await get("/v1/children?page=1&pageSize=50", pe);
    expect(roster.body.items.map((c: { id: string }) => c.id)).not.toContain(a.child.id);
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

/**
 * Follow-ups from the ultra review of #231 (2026-10-16).
 */
describe("follow-ups: role change, files, staff file, roster headline", () => {
  async function file(data: Record<string, unknown>) {
    return db.mediaFile.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        purpose: "CHILD_PHOTO",
        storageKey: `test/${uniq("f")}.jpg`,
        originalName: "a.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1,
        ...data,
      } as never,
    });
  }

  async function staffNote(session: AuthSession) {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/observations`),
      session,
    ).send({ typeId, observedOn: "2026-02-10", situation: "Тоглоомын буланд" });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  const open = (id: string, session: AuthSession) => get(`/v1/media/${id}`, session);

  it("a role changed away and back does not hand the old groups back", async () => {
    for (const role of ["TEACHER", "PE_TEACHER"]) {
      const changed = await authed(
        request(server()).patch(`/v1/memberships/${peMembershipId}`),
        adminA,
      ).send({ role });
      expect(changed.status).toBe(200);
    }
    const again = await login(
      app,
      (
        await db.membership.findUniqueOrThrow({
          where: { id: peMembershipId },
          select: { user: { select: { username: true } } },
        })
      ).user.username!,
    );

    expect((await get(`/v1/children/${a.child.id}`, again)).status).toBe(404);
  });

  it("the card's readers open the profile photo, never the album", async () => {
    const profile = await file({});
    await db.child.update({ where: { id: a.child.id }, data: { photoMediaFileId: profile.id } });
    const album = await file({});

    for (const session of [pe, doctor]) {
      expect((await open(profile.id, session)).status).toBe(302);
      expect((await open(album.id, session)).status).toBe(404);
    }
  });

  it("a group's PE teacher opens observation photos; the doctor does not", async () => {
    const photo = await file({ purpose: "OBSERVATION", observationId: await staffNote(teacherA) });

    expect((await open(photo.id, pe)).status).toBe(302);
    expect((await open(photo.id, doctor)).status).toBe(404);
  });

  it("a teacher the child has left opens the photos on their own notes only", async () => {
    const own = await file({ purpose: "OBSERVATION", observationId: await staffNote(teacherA) });
    const others = await file({ purpose: "OBSERVATION", observationId: await staffNote(adminA) });
    const moved = await authed(
      request(server()).post(`/v1/children/${a.child.id}/enrollments`),
      adminA,
    ).send({ groupId: otherGroupId });
    expect(moved.status).toBe(201);

    expect((await open(own.id, teacherA)).status).toBe(302);
    expect((await open(others.id, teacherA)).status).toBe(404);
  });

  it("teacher from another kindergarten gets 404 for the profile photo", async () => {
    const profile = await file({});
    await db.child.update({ where: { id: a.child.id }, data: { photoMediaFileId: profile.id } });
    expect((await open(profile.id, await login(app, b.teacherUser.username))).status).toBe(404);
  });

  it("the director files a doctor's staff record", async () => {
    const doctorMembership = await db.membership.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id, role: "DOCTOR" },
    });
    const res = await authed(
      request(server()).post(
        `/v1/kindergartens/${a.kindergarten.id}/staff/${doctorMembership.userId}/records`,
      ),
      adminA,
    ).send({
      kind: "CERTIFICATE",
      title: "Хүүхдийн эмчийн гэрчилгээ",
      issuer: "ЭМЯ",
      startedOn: "2024-03-01",
    });
    expect(res.status).toBe(201);
  });

  it("the roster headline counts the children the doctor's list shows", async () => {
    const list = await get("/v1/children?pageSize=100", doctor);
    const summary = await get("/v1/children/summary", doctor);
    expect(summary.status).toBe(200);
    expect(summary.body.total).toBe(list.body.total);
    expect(summary.body.total).toBeGreaterThan(0);
  });

  it("a specialist assignment is dated", async () => {
    const row = await db.groupSpecialist.findUniqueOrThrow({ where: { id: peAssignmentId } });
    expect(row.startedOn).not.toBeNull();
  });
});
