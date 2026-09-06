import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Хүний нөөц — Order А/261, criterion 51: a member of staff's experience,
 * certificates and grades.
 *
 * ★ The authorization question here is not the one the rest of this suite
 * asks, and that is what most of this file is about.
 *
 * Everywhere else "may this person see it" resolves to a role plus a
 * kindergarten. A personnel file adds a third term — *whose* file — and the
 * failure mode is a staff room where everybody can read everybody's grade. So
 * the cases below pin all three: an administrator reads anybody's, a teacher
 * reads their own and nobody else's, and a member of staff writes nothing at
 * all.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;

const server = () => app.getHttpServer();

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
  parentA = await login(app, a.parentUser.username);
});

const CERTIFICATE = {
  kind: "CERTIFICATE",
  title: "Бага насны хүүхдийн хөгжил — гэрчилгээ",
  issuer: "Багшийн хөгжлийн үндэсний төв",
  documentNo: "ГЭР-2024/882",
  startedOn: "2024-03-01",
  endedOn: "2029-03-01",
};

const EXPERIENCE = {
  kind: "EXPERIENCE",
  title: "Ахлах багш",
  issuer: "12-р цэцэрлэг",
  startedOn: "2019-09-01",
};

function recordsPath(kindergartenId: string, userId: string) {
  return `/v1/kindergartens/${kindergartenId}/staff/${userId}/records`;
}

async function fileRecord(session: AuthSession, userId: string, body: unknown = CERTIFICATE) {
  return authed(request(server()).post(recordsPath(a.kindergarten.id, userId)), session).send(body);
}

// ═══════════════════════════════════════════════════════════════════════════
// The record itself
// ═══════════════════════════════════════════════════════════════════════════

describe("ажилтны бүртгэл", () => {
  it("files a certificate and reads it back", async () => {
    const created = await fileRecord(adminA, a.teacherUser.id);
    expect(created.status).toBe(201);

    const list = await authed(
      request(server()).get(recordsPath(a.kindergarten.id, a.teacherUser.id)),
      adminA,
    );

    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].title).toBe(CERTIFICATE.title);
    expect(list.body[0].documentNo).toBe("ГЭР-2024/882");

    /*
     * ★ The exact string, not a sliced prefix.
     *
     * This assertion used `.slice(0, 10)` and passed while the API returned a
     * full ISO timestamp — which the client then formats in the reader's own
     * timezone, so a certificate issued on 2024-03-01 reads as 2024-02-29 for
     * anybody west of UTC. A test that trims the response to the shape it
     * expects cannot see the shape it got.
     */
    expect(list.body[0].startedOn).toBe("2024-03-01");
    expect(list.body[0].endedOn).toBe("2029-03-01");
  });

  /**
   * ★ An open-ended row is the normal case, not an edge case.
   *
   * "2019 оноос одоог хүртэл" is what a current post looks like, so `endedOn`
   * is nullable and the list has to accept a body without it. A schema that
   * required both dates would make every serving teacher unrecordable.
   */
  it("accepts a post with no end date", async () => {
    const created = await fileRecord(adminA, a.teacherUser.id, EXPERIENCE);

    expect(created.status).toBe(201);
    expect(created.body.endedOn).toBeNull();
  });

  it("refuses an end date before the start", async () => {
    const res = await fileRecord(adminA, a.teacherUser.id, {
      ...EXPERIENCE,
      endedOn: "2018-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("filters by kind", async () => {
    await fileRecord(adminA, a.teacherUser.id, CERTIFICATE);
    await fileRecord(adminA, a.teacherUser.id, EXPERIENCE);

    const certificates = await authed(
      request(server()).get(`${recordsPath(a.kindergarten.id, a.teacherUser.id)}?kind=CERTIFICATE`),
      adminA,
    );

    expect(certificates.status).toBe(200);
    expect(certificates.body).toHaveLength(1);
    expect(certificates.body[0].kind).toBe("CERTIFICATE");
  });

  /**
   * ★ Current first, then most recent.
   *
   * A reader checking whether a teacher is qualified *now* should not have to
   * scan past a post they left in 2014 to find the one they hold today.
   */
  it("lists current records before ended ones", async () => {
    await fileRecord(adminA, a.teacherUser.id, {
      kind: "EXPERIENCE",
      title: "Хуучин ажил",
      startedOn: "2014-01-01",
      endedOn: "2016-01-01",
    });
    await fileRecord(adminA, a.teacherUser.id, EXPERIENCE);

    const list = await authed(
      request(server()).get(recordsPath(a.kindergarten.id, a.teacherUser.id)),
      adminA,
    );

    expect(list.body.map((r: { title: string }) => r.title)).toEqual(["Ахлах багш", "Хуучин ажил"]);
  });

  it("edits a record and soft-deletes it", async () => {
    const created = await fileRecord(adminA, a.teacherUser.id);

    const patched = await authed(
      request(server()).patch(`/v1/staff-records/${created.body.id}`),
      adminA,
    ).send({ documentNo: "ГЭР-2024/900" });
    expect(patched.status).toBe(200);
    expect(patched.body.documentNo).toBe("ГЭР-2024/900");

    const removed = await authed(
      request(server()).delete(`/v1/staff-records/${created.body.id}`),
      adminA,
    );
    expect(removed.status).toBe(200);

    const row = await db.staffRecord.findUnique({ where: { id: created.body.id } });
    expect(row?.deletedAt).not.toBeNull();

    const list = await authed(
      request(server()).get(recordsPath(a.kindergarten.id, a.teacherUser.id)),
      adminA,
    );
    expect(list.body).toHaveLength(0);
  });

  /**
   * ★★ The subject must be one of *this* kindergarten's staff.
   *
   * `userId` arrives in the URL, so without this check an administrator could
   * file a certificate against any user id in the system — a parent's, or a
   * teacher employed elsewhere — and that person would then read it back under
   * the "your own file" branch, from a kindergarten they have nothing to do
   * with. It is a 400 rather than a 404 because the administrator is entitled
   * to be here and has simply named the wrong person.
   */
  it("refuses to file a record against someone who is not staff here", async () => {
    const outsider = await createUser({
      username: `out-${Math.random().toString(36).slice(2, 8)}`,
    });
    await createMembership(outsider.id, b.kindergarten.id, "TEACHER");

    const res = await fileRecord(adminA, outsider.id);
    expect(res.status).toBe(400);

    expect(await db.staffRecord.count({ where: { userId: outsider.id } })).toBe(0);
  });

  /**
   * ★ A parent is a member of the kindergarten and is not staff.
   *
   * ★★ This test failed on its first run and the *code* was wrong, not the
   * assertion: `isStaffMember` began life asking only whether a membership
   * existed, and a guardian has one — so "ажлын туршлага" was fileable against
   * a child's mother. The four staff roles are now named explicitly.
   */
  it("refuses to file a record against a guardian", async () => {
    const res = await fileRecord(adminA, a.parentUser.id);
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  /**
   * ★ The case this module exists to get right.
   *
   * A teacher reads their own file. A colleague's is 404 — not 403, because a
   * 403 confirms the colleague has records, which is the fact the permission
   * was protecting. §1.7 is written about child data and the reasoning is
   * identical here.
   */
  it("a teacher reads their own file but not a colleague's", async () => {
    const other = await createUser({ username: `t2-${Math.random().toString(36).slice(2, 8)}` });
    await createMembership(other.id, a.kindergarten.id, "TEACHER");

    await fileRecord(adminA, a.teacherUser.id);
    await fileRecord(adminA, other.id, EXPERIENCE);

    const own = await authed(
      request(server()).get(recordsPath(a.kindergarten.id, a.teacherUser.id)),
      teacherA,
    );
    expect(own.status).toBe(200);
    expect(own.body).toHaveLength(1);

    const colleague = await authed(
      request(server()).get(recordsPath(a.kindergarten.id, other.id)),
      teacherA,
    );
    expect(colleague.status).toBe(404);
  });

  /** Staff record, staff read — a family has no business in the staff room. */
  it("a guardian gets 404 on any staff file", async () => {
    await fileRecord(adminA, a.teacherUser.id);

    const res = await authed(
      request(server()).get(recordsPath(a.kindergarten.id, a.teacherUser.id)),
      parentA,
    );
    expect(res.status).toBe(404);
  });

  /**
   * ★ Reading your own file does not mean writing it.
   *
   * Criterion 51 is about data the kindergarten submits to the ministry, and a
   * record somebody wrote about themselves is not evidence of anything. The
   * split is `createAllergy`'s: the person is told, a member of staff records.
   */
  it("a teacher cannot write even their own record", async () => {
    const created = await fileRecord(teacherA, a.teacherUser.id);
    expect(created.status).toBe(404);

    const filed = await fileRecord(adminA, a.teacherUser.id);
    const patched = await authed(
      request(server()).patch(`/v1/staff-records/${filed.body.id}`),
      teacherA,
    ).send({ title: "Өөрөө өөрчилсөн" });
    expect(patched.status).toBe(404);

    const removed = await authed(
      request(server()).delete(`/v1/staff-records/${filed.body.id}`),
      teacherA,
    );
    expect(removed.status).toBe(404);
  });

  it("an admin from another kindergarten gets 404", async () => {
    const adminB = await login(app, b.adminUser.username);
    await fileRecord(adminA, a.teacherUser.id);

    const res = await authed(
      request(server()).get(recordsPath(a.kindergarten.id, a.teacherUser.id)),
      adminB,
    );
    expect(res.status).toBe(404);
  });

  it("an admin from another kindergarten cannot edit a record by id", async () => {
    const adminB = await login(app, b.adminUser.username);
    const created = await fileRecord(adminA, a.teacherUser.id);

    const patched = await authed(
      request(server()).patch(`/v1/staff-records/${created.body.id}`),
      adminB,
    ).send({ title: "Хулгайлсан" });
    expect(patched.status).toBe(404);

    const row = await db.staffRecord.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.title).toBe(CERTIFICATE.title);
  });

  /**
   * ★★★ Two kindergartens, one person, two files.
   *
   * A teacher may work at both, and each keeps its own record. This is what
   * `kindergartenId` on the table is for (§3.1): a query on `userId` alone
   * would hand one employer the other's file. Asserted from both sides,
   * because a leak in either direction is the same defect.
   */
  it("keeps one person's two employers' files apart", async () => {
    const shared = await createUser({ username: `both-${Math.random().toString(36).slice(2, 8)}` });
    await createMembership(shared.id, a.kindergarten.id, "TEACHER");
    await createMembership(shared.id, b.kindergarten.id, "TEACHER");

    const adminB = await login(app, b.adminUser.username);

    await authed(request(server()).post(recordsPath(a.kindergarten.id, shared.id)), adminA).send({
      ...CERTIFICATE,
      title: "А-гийн бүртгэл",
    });
    await authed(
      request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/staff/${shared.id}/records`),
      adminB,
    ).send({ ...CERTIFICATE, title: "Б-гийн бүртгэл" });

    const fromA = await authed(
      request(server()).get(recordsPath(a.kindergarten.id, shared.id)),
      adminA,
    );
    const fromB = await authed(
      request(server()).get(`/v1/kindergartens/${b.kindergarten.id}/staff/${shared.id}/records`),
      adminB,
    );

    expect(fromA.body.map((r: { title: string }) => r.title)).toEqual(["А-гийн бүртгэл"]);
    expect(fromB.body.map((r: { title: string }) => r.title)).toEqual(["Б-гийн бүртгэл"]);
  });

  /**
   * ★ "Your own file" is still scoped to a kindergarten you belong to.
   *
   * Without the membership term in `canReadStaffRecords`, passing your own
   * user id with somebody else's kindergarten id would read a file kept by an
   * employer you have nothing to do with.
   */
  it("does not let a person read their own id at a kindergarten they do not belong to", async () => {
    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${b.kindergarten.id}/staff/${a.teacherUser.id}/records`,
      ),
      teacherA,
    );
    expect(res.status).toBe(404);
  });
});
