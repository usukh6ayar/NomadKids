import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Health records — RFP Module 2: allergies, medication, vaccination.
 *
 * The distinction under test is who writes what. An **allergy** is an
 * instruction other people act on, so staff record it. A **medication
 * authorisation** is a family's consent, so the guardian writes it and the row
 * *is* the consent. A **vaccination** is the kindergarten's register.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;

const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);
});

function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const NUT_ALLERGY = {
  kind: "FOOD",
  severity: "SEVERE",
  allergen: "самар",
  reaction: "Амьсгал давчдах",
  treatment: "Эпипен, дараа нь яаралтай тусламж",
  notedOn: inDays(-30),
};

const MEDICATION = {
  medicineName: "Парацетамол",
  dosage: "5 мл",
  timesOfDay: ["12:00", "16:30"],
  startsOn: inDays(-1),
  endsOn: inDays(5),
};

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  it("a teacher from another kindergarten gets 404", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/health`), teacherB);
    expect(res.status).toBe(404);
  });

  it("a guardian of another child gets 404", async () => {
    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/health`), parentB);
    expect(res.status).toBe(404);
  });

  it("a user from another kindergarten cannot record an allergy", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherB,
    ).send(NUT_ALLERGY);

    expect(res.status).toBe(404);
    expect(await db.allergyRecord.count({ where: { childId: a.child.id } })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Allergies — RFP Module 2
// ═══════════════════════════════════════════════════════════════════════════

describe("allergies", () => {
  it("a teacher records one and the family can read it", async () => {
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherA,
    ).send(NUT_ALLERGY);
    expect(created.status).toBe(201);

    const read = await authed(request(server()).get(`/v1/children/${a.child.id}/health`), parentA);
    expect(read.status).toBe(200);
    expect(read.body.allergies).toHaveLength(1);
    expect(read.body.allergies[0].allergen).toBe("самар");
    expect(read.body.allergies[0].severity).toBe("SEVERE");
  });

  /**
   * ★ A guardian may not raise the flag themselves.
   *
   * An allergy record changes what a kitchen cooks and what a teacher does in
   * an emergency. RFP Module 2 puts it on "багшийн систем дээр": a family
   * telling the kindergarten ends with a member of staff recording it — who can
   * also be asked what "ноцтой" meant.
   */
  it("a guardian cannot record one", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      parentA,
    ).send(NUT_ALLERGY);

    expect(res.status).toBe(404);
    expect(await db.allergyRecord.count({ where: { childId: a.child.id } })).toBe(0);
  });

  /**
   * ★★ The allergen is trimmed on the way in, because this string is *matched*
   * against a menu's allergen tags. " самар" and "самар" being different
   * allergens means the child with the first one is never warned about the
   * second.
   */
  it("trims the allergen so a stray space cannot split one allergy into two", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherA,
    ).send({ ...NUT_ALLERGY, allergen: "  сүү  " });

    expect(res.status).toBe(201);
    const row = await db.allergyRecord.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row.allergen).toBe("сүү");
  });

  it("refuses an empty allergen", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherA,
    ).send({ ...NUT_ALLERGY, allergen: "   " });
    expect(res.status).toBe(400);
  });

  /** Ended, not deleted — a child who outgrows one still had it. */
  it("ends an allergy without losing the record", async () => {
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherA,
    ).send(NUT_ALLERGY);

    const ended = await authed(
      request(server()).patch(`/v1/allergies/${created.body.id}`),
      teacherA,
    ).send({ endedOn: inDays(0) });

    expect(ended.status).toBe(200);
    const row = await db.allergyRecord.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.endedOn).not.toBeNull();
    expect(row.deletedAt).toBeNull();
  });

  it("soft-deletes rather than removing the row", async () => {
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherA,
    ).send(NUT_ALLERGY);

    await authed(request(server()).delete(`/v1/allergies/${created.body.id}`), teacherA);
    const row = await db.allergyRecord.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.deletedAt).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Medication — RFP Module 2, "Эм хэрэглээний зөвшөөрөл"
// ═══════════════════════════════════════════════════════════════════════════

describe("medication", () => {
  /**
   * ★ The row is the consent, so `authorisedById` is the authenticated actor
   * and never a client-supplied id.
   */
  it("a guardian authorises, and the record names them", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send(MEDICATION);

    expect(res.status).toBe(201);
    const row = await db.medicationAuthorisation.findFirstOrThrow({
      where: { childId: a.child.id },
    });
    expect(row.authorisedById).toBe(a.parentUser.id);
  });

  /** A family who phones the instruction in is ordinary; the audit says who typed it. */
  it("a teacher may record one on the family's behalf", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      teacherA,
    ).send(MEDICATION);
    expect(res.status).toBe(201);
  });

  /**
   * ★★ "Is this live today" is computed by the API, not by each screen.
   *
   * It decides whether a teacher is reminded to give a child medicine, and two
   * clients deriving it from two date comparisons is two chances to get the
   * boundary wrong — a dose missed, or given after consent expired.
   */
  it("reports isActive against today, at both boundaries", async () => {
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send({ ...MEDICATION, medicineName: "Идэвхтэй", startsOn: inDays(0), endsOn: inDays(0) });

    await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send({ ...MEDICATION, medicineName: "Ирээдүйн", startsOn: inDays(3), endsOn: inDays(9) });

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/health`), teacherA);
    const byName = new Map(
      (res.body.medications as { medicineName: string; isActive: boolean }[]).map((m) => [
        m.medicineName,
        m.isActive,
      ]),
    );

    // Starting and ending today is active — the boundary is inclusive at both
    // ends, which is what "өнөөдрөөс маргааш хүртэл" means to a parent.
    expect(byName.get("Идэвхтэй")).toBe(true);
    expect(byName.get("Ирээдүйн")).toBe(false);
  });

  it("refuses an authorisation with no times — nobody would be reminded", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send({ ...MEDICATION, timesOfDay: [] });
    expect(res.status).toBe(400);
  });

  it("refuses a malformed time", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send({ ...MEDICATION, timesOfDay: ["25:00"] });
    expect(res.status).toBe(400);
  });

  it("refuses a window that has already closed", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send({ ...MEDICATION, startsOn: inDays(-20), endsOn: inDays(-10) });
    expect(res.status).toBe(400);
  });

  it("refuses a window that ends before it starts", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send({ ...MEDICATION, startsOn: inDays(5), endsOn: inDays(1) });
    expect(res.status).toBe(400);
  });

  /**
   * ★★★ One guardian may not withdraw another's consent — the same rule as a
   * milestone, and for a sharper reason: this is a medical instruction.
   */
  it("a second guardian cannot withdraw the first one's authorisation", async () => {
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send(MEDICATION);

    const other = await db.user.create({
      data: {
        username: `other-guardian-${Date.now()}`,
        passwordHash: a.parentUser.passwordHash,
        lastName: "Хоёр",
        firstName: "Асран",
      },
    });
    await db.membership.create({
      data: { userId: other.id, kindergartenId: a.kindergarten.id, role: "PARENT" },
    });
    await db.guardianship.create({
      data: {
        kindergartenId: a.kindergarten.id,
        childId: a.child.id,
        guardianUserId: other.id,
        relation: "FATHER",
      },
    });

    const otherSession = await login(app, other.username);
    const res = await authed(
      request(server()).delete(`/v1/medications/${created.body.id}`),
      otherSession,
    );
    expect(res.status).toBe(404);
  });

  it("the guardian who authorised it may withdraw it, and so may staff", async () => {
    const mine = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send(MEDICATION);
    expect(
      (await authed(request(server()).delete(`/v1/medications/${mine.body.id}`), parentA)).status,
    ).toBe(200);

    const theirs = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/medications`),
      parentA,
    ).send(MEDICATION);
    expect(
      (await authed(request(server()).delete(`/v1/medications/${theirs.body.id}`), teacherA))
        .status,
    ).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Vaccination
// ═══════════════════════════════════════════════════════════════════════════

describe("vaccination", () => {
  const VACCINE = {
    vaccineName: "Улаанбурхан",
    administeredOn: inDays(-100),
    doseLabel: "2-р тун",
  };

  it("a teacher records one", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/vaccinations`),
      teacherA,
    ).send(VACCINE);
    expect(res.status).toBe(201);
  });

  it("a guardian cannot — this is the kindergarten's register", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/vaccinations`),
      parentA,
    ).send(VACCINE);
    expect(res.status).toBe(404);
  });

  it("refuses a future date", async () => {
    const res = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/vaccinations`),
      teacherA,
    ).send({ ...VACCINE, administeredOn: inDays(3) });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The combined response
// ═══════════════════════════════════════════════════════════════════════════

describe("the health response", () => {
  /**
   * RFP §3.4's free-text note and the three structured tables answer the same
   * question on the same screen. A teacher seeing one without the other is
   * missing half of what a family told the kindergarten.
   */
  it("carries the free-text health note alongside the structured records", async () => {
    await db.child.update({
      where: { id: a.child.id },
      data: { healthNotes: "Нойрны өмнө уян хатан байх шаардлагатай." },
    });

    const res = await authed(request(server()).get(`/v1/children/${a.child.id}/health`), teacherA);
    expect(res.body.healthNotes).toContain("Нойрны өмнө");
    expect(res.body.allergies).toEqual([]);
    expect(res.body.medications).toEqual([]);
    expect(res.body.vaccinations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The menu cross-check — RFP Module 2's automatic warning
// ═══════════════════════════════════════════════════════════════════════════

describe("menu versus allergies", () => {
  const TODAY = new Date().toISOString().slice(0, 10);

  async function setMenu(dishes: { name: string; allergenTags: string[] }[]) {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/${TODAY}`),
      teacherA,
    ).send({ dishes });
    expect(res.status).toBe(200);
  }

  async function warningsForToday(session: AuthSession) {
    return authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu/with-warnings?from=${TODAY}&to=${TODAY}`,
      ),
      session,
    );
  }

  it("warns a teacher when a dish matches a child's allergy", async () => {
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherA,
    ).send(NUT_ALLERGY);

    await setMenu([
      { name: "Самартай бялуу", allergenTags: ["самар"] },
      { name: "Ногоотой шөл", allergenTags: ["лууван"] },
    ]);

    const res = await warningsForToday(teacherA);
    expect(res.status).toBe(200);

    const warnings = res.body[0].warnings as { dishName: string; childId: string }[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.dishName).toBe("Самартай бялуу");
    expect(warnings[0]!.childId).toBe(a.child.id);
  });

  /**
   * ★ The case a substring match would have missed — Mongolian suffixation
   * elides the stem vowel, so "самрын тос" does not contain "самар".
   *
   * Asserted end to end as well as in the unit test, because this is the whole
   * point of the feature and it would fail silently: the warning simply would
   * not appear.
   */
  it("warns across a declined form of the allergen", async () => {
    await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherA,
    ).send(NUT_ALLERGY);

    await setMenu([{ name: "Салат", allergenTags: ["самрын тос"] }]);

    const res = await warningsForToday(teacherA);
    expect(res.body[0].warnings).toHaveLength(1);
  });

  /**
   * ★★ A parent must not see which classmates are allergic to what.
   *
   * The warning names another family's child and their medical condition. The
   * plain menu stays open to everyone; this route does not.
   */
  it("a guardian cannot read the warnings, only the menu", async () => {
    await setMenu([{ name: "Самартай бялуу", allergenTags: ["самар"] }]);

    expect((await warningsForToday(parentA)).status).toBe(404);

    // …but the menu itself is still theirs to read.
    const menu = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu?from=${TODAY}&to=${TODAY}`,
      ),
      parentA,
    );
    expect(menu.status).toBe(200);
    expect(menu.body).toHaveLength(1);
  });

  it("an ended allergy stops raising warnings", async () => {
    const created = await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherA,
    ).send(NUT_ALLERGY);

    await setMenu([{ name: "Самартай бялуу", allergenTags: ["самар"] }]);
    expect((await warningsForToday(teacherA)).body[0].warnings).toHaveLength(1);

    await authed(request(server()).patch(`/v1/allergies/${created.body.id}`), teacherA).send({
      endedOn: TODAY,
    });

    expect((await warningsForToday(teacherA)).body[0].warnings).toHaveLength(0);
  });

  it("does not warn about a child in another kindergarten", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    await authed(
      request(server()).post(`/v1/children/${b.child.id}/health/allergies`),
      teacherB,
    ).send(NUT_ALLERGY);

    await setMenu([{ name: "Самартай бялуу", allergenTags: ["самар"] }]);

    const res = await warningsForToday(teacherA);
    expect(res.body[0].warnings).toHaveLength(0);
  });
});
