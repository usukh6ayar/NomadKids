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
  linkGuardian,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Portfolio — "Миний тухай", ages 2–5, birthday notes.
 *
 * The behaviour under test that is easiest to get wrong: **guardians may
 * write.** Portfolio editing is gated by read access, not record access, and
 * applying the stricter check used for observations would silently turn every
 * parent into a read-only viewer.
 *
 * Within that, RFP §4.3's two-voices rule: parentNote is the guardian's,
 * teacherNote is the teacher's, and neither may overwrite the other.
 */

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

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — the required regressions
// ═══════════════════════════════════════════════════════════════════════════

describe("portfolio authorization", () => {
  it("a parent reaches their own child's portfolio", async () => {
    const res = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", parentA.cookies);
    expect(res.status).toBe(200);
  });

  it("a parent CANNOT reach another child's portfolio", async () => {
    const res = await request(server())
      .get(`/v1/children/${b.child.id}/portfolio`)
      .set("Cookie", parentA.cookies);
    expect(res.status).toBe(404);
  });

  it("a REVOKED guardian gets 404", async () => {
    await authed(request(server()).patch(`/v1/guardianships/${a.guardianship.id}`), adminA).send({
      canView: false,
    });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", parentA.cookies);
    expect(res.status).toBe(404);
  });

  it("an assigned teacher reaches the portfolio", async () => {
    const res = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(200);
  });

  it("a REVOKED GroupTeacher gets 404", async () => {
    await authed(request(server()).delete(`/v1/group-teachers/${a.assignment.id}`), adminA);

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });

  it("a teacher from another group in the same kindergarten gets 404", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
    const child = await createChild(a.kindergarten.id, { firstName: "Хол" });
    await enrollChild(a.kindergarten.id, child.id, other.id, a.schoolYear.id);

    const res = await request(server())
      .get(`/v1/children/${child.id}/portfolio`)
      .set("Cookie", teacherA.cookies);
    expect(res.status).toBe(404);
  });

  it("cross-kindergarten gets 404", async () => {
    const adminB = await login(app, b.adminUser.username);
    const res = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", adminB.cookies);
    expect(res.status).toBe(404);
  });

  it("every portfolio sub-route enforces the same check", async () => {
    // A single forgotten call in one handler is the realistic failure, so each
    // route is checked rather than assuming they share a guard.
    const routes = ["portfolio", "about-me", "age-profiles", "age-profiles/3", "birthday-notes"];

    for (const route of routes) {
      const res = await request(server())
        .get(`/v1/children/${b.child.id}/${route}`)
        .set("Cookie", parentA.cookies);
      expect({ route, status: res.status }).toEqual({ route, status: 404 });
    }
  });

  it("every portfolio WRITE route enforces the same check", async () => {
    const writes: [string, object][] = [
      ["about-me", { introduction: "халдлага" }],
      ["age-profiles/3", { favoriteColor: "Улаан" }],
      ["birthday-notes/3", { note: "халдлага" }],
    ];

    for (const [route, body] of writes) {
      const res = await authed(
        request(server()).patch(`/v1/children/${b.child.id}/${route}`),
        parentA,
      ).send(body);
      expect({ route, status: res.status }).toEqual({ route, status: 404 });
    }
  });

  it("requires authentication", async () => {
    expect((await request(server()).get(`/v1/children/${a.child.id}/portfolio`)).status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Parent write scope — the rule that must not be silently narrowed
// ═══════════════════════════════════════════════════════════════════════════

describe("a guardian MAY write the portfolio", () => {
  it("edits About Me", async () => {
    // ★ If this ever returns 404, portfolio editing has been wrongly gated on
    // canRecordForChild and every parent has silently become read-only.
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/about-me`),
      parentA,
    ).send({ introduction: "Манай хүү тоглох дуртай", dream: "Нисгэгч болох" });

    expect(res.status).toBe(200);
    expect(res.body.introduction).toBe("Манай хүү тоглох дуртай");
  });

  it("edits shared age-profile fields", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      parentA,
    ).send({ favoriteColor: "Хөх", favoriteFood: "Бууз" });

    expect(res.status).toBe(200);
    expect(res.body.favoriteColor).toBe("Хөх");
  });

  it("writes a birthday note", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/birthday-notes/3`),
      parentA,
    ).send({ note: "Гурван настай төрсөн өдөр" });

    expect(res.status).toBe(200);
    expect(res.body.note).toBe("Гурван настай төрсөн өдөр");
  });
});

describe("the two-voices rule — RFP §4.3", () => {
  it("a guardian writes parentNote", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      parentA,
    ).send({ parentNote: "Гэртээ ном уншиж өгдөг" });

    expect(res.status).toBe(200);
    expect(res.body.parentNote).toBe("Гэртээ ном уншиж өгдөг");
  });

  it("a guardian CANNOT write teacherNote", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      parentA,
    ).send({ teacherNote: "Дарж бичих оролдлого" });

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("teacherNote");
  });

  it("a teacher writes teacherNote", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      teacherA,
    ).send({ teacherNote: "Бүлэгтээ идэвхтэй" });

    expect(res.status).toBe(200);
    expect(res.body.teacherNote).toBe("Бүлэгтээ идэвхтэй");
  });

  it("a teacher CANNOT write parentNote", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      teacherA,
    ).send({ parentNote: "Дарж бичих оролдлого" });

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("parentNote");
  });

  it("NEITHER note is destroyed by the other side's save", async () => {
    // The reason the rule exists: two voices in one record.
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      teacherA,
    ).send({ teacherNote: "Багшийнх" });

    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      parentA,
    ).send({ parentNote: "Эцэг эхийнх" });

    const profile = await db.childAgeProfile.findFirstOrThrow({
      where: { childId: a.child.id, age: 3 },
    });
    expect(profile.teacherNote).toBe("Багшийнх");
    expect(profile.parentNote).toBe("Эцэг эхийнх");
  });

  it("a guardian's crafted write leaves the teacher note untouched", async () => {
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      teacherA,
    ).send({ teacherNote: "Багшийн ажиглалт" });

    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      parentA,
    ).send({ favoriteColor: "Ногоон", teacherNote: "Дарж бичих оролдлого" });

    const profile = await db.childAgeProfile.findFirstOrThrow({
      where: { childId: a.child.id, age: 3 },
    });
    expect(profile.teacherNote).toBe("Багшийн ажиглалт");
    // The whole request was rejected, so the legitimate field did not save
    // either — a partial save would be harder to reason about than a refusal.
    expect(profile.favoriteColor).toBeNull();
  });

  it("a teacher who is ALSO the child's guardian writes the parent note", async () => {
    // The branch keys off relationship to this child, not role. A teacher whose
    // own child attends the same kindergarten is a real case, and keying off
    // Role.PARENT would get it backwards.
    const dual = await createUser({ username: uniq("dual") });
    await createMembership(dual.id, a.kindergarten.id, "TEACHER");
    await createMembership(dual.id, a.kindergarten.id, "PARENT");

    const ownChild = await createChild(a.kindergarten.id, { firstName: "Багшийн" });
    await enrollChild(a.kindergarten.id, ownChild.id, a.group.id, a.schoolYear.id);
    await linkGuardian(a.kindergarten.id, ownChild.id, dual.id);

    const session = await login(app, dual.username);

    const asParent = await authed(
      request(server()).patch(`/v1/children/${ownChild.id}/age-profiles/4`),
      session,
    ).send({ parentNote: "Миний хүүхэд" });
    expect(asParent.status).toBe(200);

    const asTeacher = await authed(
      request(server()).patch(`/v1/children/${ownChild.id}/age-profiles/4`),
      session,
    ).send({ teacherNote: "Багшийн эрхээр" });
    expect(asTeacher.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Persistence and validation
// ═══════════════════════════════════════════════════════════════════════════

describe("About Me", () => {
  it("returns an empty shape before anything is saved", async () => {
    // Not a 404 and not an empty body: a portfolio section nobody has filled in
    // is a normal state, and the form binds to the same field names either way.
    const res = await request(server())
      .get(`/v1/children/${a.child.id}/about-me`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.introduction).toBeNull();
  });

  it("creates the row on first save and updates thereafter", async () => {
    await authed(request(server()).patch(`/v1/children/${a.child.id}/about-me`), teacherA).send({
      introduction: "Эхний хадгалалт",
    });
    await authed(request(server()).patch(`/v1/children/${a.child.id}/about-me`), teacherA).send({
      dream: "Эмч болох",
    });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/about-me`)
      .set("Cookie", teacherA.cookies);

    // ★ A PATCH must not wipe fields it does not mention.
    expect(res.body.introduction).toBe("Эхний хадгалалт");
    expect(res.body.dream).toBe("Эмч болох");
  });

  it("stores height and weight", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/about-me`),
      teacherA,
    ).send({ heightCm: 103.5, weightKg: 18.2 });

    expect(res.status).toBe(200);
    expect(Number(res.body.heightCm)).toBe(103.5);
  });

  it("rejects an implausible height", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/about-me`),
      teacherA,
    ).send({ heightCm: 900 });
    expect(res.status).toBe(400);
  });

  it("allows clearing a field with null", async () => {
    await authed(request(server()).patch(`/v1/children/${a.child.id}/about-me`), teacherA).send({
      dream: "Эмч болох",
    });
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/about-me`),
      teacherA,
    ).send({ dream: null });

    expect(res.body.dream).toBeNull();
  });
});

describe("age profiles", () => {
  it("persists and reads back", async () => {
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/2`),
      teacherA,
    ).send({ favoriteToy: "Барилгын шоо", personality: "Тайван" });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/age-profiles/2`)
      .set("Cookie", teacherA.cookies);

    expect(res.body.favoriteToy).toBe("Барилгын шоо");
    expect(res.body.age).toBe(2);
  });

  it("keeps ages separate", async () => {
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/2`),
      teacherA,
    ).send({ favoriteColor: "Улаан" });
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/5`),
      teacherA,
    ).send({ favoriteColor: "Ногоон" });

    const list = await request(server())
      .get(`/v1/children/${a.child.id}/age-profiles`)
      .set("Cookie", teacherA.cookies);

    expect(list.body).toHaveLength(2);
    expect(list.body.map((p: { age: number }) => p.age)).toEqual([2, 5]);
  });

  it("rejects an age outside 2–5", async () => {
    for (const age of [1, 6, 0, 99]) {
      const res = await authed(
        request(server()).patch(`/v1/children/${a.child.id}/age-profiles/${age}`),
        teacherA,
      ).send({ favoriteColor: "Улаан" });
      expect({ age, status: res.status }).toEqual({ age, status: 400 });
    }
  });

  it("attaches the child's current school year", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      teacherA,
    ).send({ favoriteColor: "Хөх" });

    expect(res.body.schoolYear?.id).toBe(a.schoolYear.id);
  });

  it("rejects an unknown field", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      teacherA,
    ).send({ kindergartenId: "escalation-attempt" });
    expect(res.status).toBe(400);
  });
});

describe("birthday notes", () => {
  it("persists", async () => {
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/birthday-notes/4`),
      teacherA,
    ).send({ note: "Дөрвөн настай" });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/birthday-notes`)
      .set("Cookie", teacherA.cookies);

    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].note).toBe("Дөрвөн настай");
  });

  /**
   * RFP §4.2 asks the birthday section to show the birth date, the age, the
   * өрнийн орд and the монгол жилийн амьтан alongside the notes.
   *
   * The scenario child is born 2021-04-12 — Хонь by the western zodiac, and an
   * Үхэр year. Asserting the values rather than "the keys exist" is the point:
   * a section that returns `{ zodiac: null }` passes a shape check and prints
   * an empty box in the portfolio.
   */
  it("carries the derived birth facts, not only the notes", async () => {
    const res = await request(server())
      .get(`/v1/children/${a.child.id}/birthday-notes`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.dateOfBirth).toBe("2021-04-12");
    expect(res.body.zodiac).toEqual({ code: "aries", name: "Хонь" });
    expect(res.body.yearAnimal).toMatchObject({ code: "ox", name: "Үхэр" });
    expect(typeof res.body.ageYears).toBe("number");
  });

  it("returns the section with an empty note list before anything is written", async () => {
    const res = await request(server())
      .get(`/v1/children/${a.child.id}/birthday-notes`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.notes).toEqual([]);
    expect(res.body.zodiac.name).toBe("Хонь");
  });

  it("updates rather than duplicating", async () => {
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/birthday-notes/4`),
      teacherA,
    ).send({ note: "Эхний" });
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/birthday-notes/4`),
      teacherA,
    ).send({ note: "Засварласан" });

    const notes = await db.birthdayNote.findMany({ where: { childId: a.child.id, age: 4 } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.note).toBe("Засварласан");
  });

  it("rejects an age outside 2–5", async () => {
    const res = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/birthday-notes/9`),
      teacherA,
    ).send({ note: "Буруу нас" });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Overview
// ═══════════════════════════════════════════════════════════════════════════

describe("portfolio overview", () => {
  it("reports which sections are filled, not their content", async () => {
    // ★ An overview answers "what is in here?". Returning the content of every
    // section is how it becomes the dashboard the brief rules out.
    await authed(request(server()).patch(`/v1/children/${a.child.id}/about-me`), teacherA).send({
      introduction: "Урт танилцуулга",
    });
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/3`),
      teacherA,
    ).send({ favoriteColor: "Хөх" });

    const res = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.sections.aboutMe.filled).toBe(true);
    expect(res.body.sections.ages).toHaveLength(4);
    expect(res.body.sections.ages.find((x: { age: number }) => x.age === 3).filled).toBe(true);
    expect(res.body.sections.ages.find((x: { age: number }) => x.age === 2).filled).toBe(false);

    // Content is fetched per section, not here.
    expect(JSON.stringify(res.body)).not.toContain("Урт танилцуулга");
  });

  it("includes the child's identity and current group", async () => {
    const res = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", teacherA.cookies);

    expect(res.body.child.firstName).toBe(a.child.firstName);
    expect(res.body.child.enrollments[0].group.id).toBe(a.group.id);
  });

  it("tells a guardian they are one, so the UI shows the right note field", async () => {
    const parent = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", parentA.cookies);
    expect(parent.body.viewerIsGuardian).toBe(true);

    const teacher = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", teacherA.cookies);
    expect(teacher.body.viewerIsGuardian).toBe(false);
  });

  it("shows all four ages as unfilled for a new child", async () => {
    const res = await request(server())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", teacherA.cookies);

    expect(res.body.sections.ages.every((x: { filled: boolean }) => !x.filled)).toBe(true);
    expect(res.body.sections.photos.count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Audit and CSRF
// ═══════════════════════════════════════════════════════════════════════════

describe("audit", () => {
  it("records who edited which portfolio section", async () => {
    await authed(request(server()).patch(`/v1/children/${a.child.id}/about-me`), parentA).send({
      introduction: "Эцэг эхийн бичсэн",
    });

    const entry = await db.auditLog.findFirst({
      where: { objectType: "ChildProfile", childId: a.child.id },
    });
    expect(entry?.actorUserId).toBe(a.parentUser.id);
    expect(entry?.action).toBe("UPDATE");
  });

  it("records the age for an age-profile edit", async () => {
    await authed(
      request(server()).patch(`/v1/children/${a.child.id}/age-profiles/5`),
      teacherA,
    ).send({ favoriteColor: "Шар" });

    const entry = await db.auditLog.findFirst({
      where: { objectType: "ChildAgeProfile", childId: a.child.id },
    });
    expect((entry?.metadata as { age: number }).age).toBe(5);
  });
});

describe("CSRF", () => {
  it("rejects a portfolio write with no CSRF header", async () => {
    const res = await request(server())
      .patch(`/v1/children/${a.child.id}/about-me`)
      .set("Cookie", parentA.cookies)
      .send({ introduction: "CSRF-гүй" });

    expect(res.status).toBe(403);
  });
});

describe("parent B isolation", () => {
  it("cannot read or write A's portfolio", async () => {
    const read = await request(server())
      .get(`/v1/children/${a.child.id}/about-me`)
      .set("Cookie", parentB.cookies);
    const write = await authed(
      request(server()).patch(`/v1/children/${a.child.id}/about-me`),
      parentB,
    ).send({ introduction: "халдлага" });

    expect([read.status, write.status]).toEqual([404, 404]);
  });
});
