import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetData, testDb, uniq } from "./support/db";

/**
 * Schema tests.
 *
 * These assert against a real Postgres, because they are testing guarantees
 * that live in the database rather than in TypeScript: partial unique indexes,
 * foreign-key restrictions, and cascade rules. Prisma's types would happily
 * accept every one of the operations below — the database is what refuses them.
 *
 * The partial indexes in particular were added by hand to the migration
 * (Prisma cannot express them), so they are exactly the kind of thing that
 * silently disappears in a future `migrate dev` if nothing checks.
 */

const db = testDb();

/** Minimal fixture: a kindergarten with a school year and a group. */
async function makeKindergarten() {
  const kg = await db.kindergarten.create({ data: { name: `Цэцэрлэг ${uniq()}` } });
  const year = await db.schoolYear.create({
    data: {
      kindergartenId: kg.id,
      name: `2025-2026-${uniq()}`,
      startsOn: new Date("2025-09-01"),
      endsOn: new Date("2026-06-01"),
      isCurrent: true,
    },
  });
  const group = await db.group.create({
    data: {
      kindergartenId: kg.id,
      schoolYearId: year.id,
      name: `Бүлэг ${uniq()}`,
      ageBand: "MIDDLE",
    },
  });
  return { kg, year, group };
}

async function makeChild(kindergartenId: string) {
  return db.child.create({
    data: {
      kindergartenId,
      lastName: "Ганболд",
      firstName: "Батбаяр",
      sex: "MALE",
      dateOfBirth: new Date("2021-04-12"),
    },
  });
}

beforeAll(async () => {
  await db.$connect();
});

beforeEach(async () => {
  await resetData();
});

describe("system configuration rows", () => {
  it("seeds five development domains, four levels and five observation types", async () => {
    // These are created by the seed and survive resetData(). If they are
    // missing, the database was not seeded and every other test is unreliable.
    expect(await db.developmentDomain.count({ where: { kindergartenId: null } })).toBe(5);
    expect(await db.assessmentLevel.count({ where: { kindergartenId: null } })).toBe(4);
    expect(await db.observationType.count({ where: { kindergartenId: null } })).toBe(5);
  });

  it("refuses a duplicate system domain code", async () => {
    // Prisma's UNIQUE(kindergartenId, code) does NOT catch this: Postgres
    // treats NULLs as distinct, so two system rows with the same code would
    // both be accepted. The partial index added by hand to the migration is
    // what refuses it. Without it, running the seed twice would silently
    // duplicate every domain.
    await expect(
      db.developmentDomain.create({
        data: { kindergartenId: null, code: "physical", name: "Хуулбар" },
      }),
    ).rejects.toThrow();
  });

  it("refuses a duplicate system assessment level value", async () => {
    await expect(
      db.assessmentLevel.create({ data: { kindergartenId: null, value: 1, label: "Хуулбар" } }),
    ).rejects.toThrow();
  });

  it("allows a kindergarten to override a system code", async () => {
    // The whole point of the nullable tenant column: same code, different
    // scope, no collision.
    const { kg } = await makeKindergarten();
    const override = await db.developmentDomain.create({
      data: { kindergartenId: kg.id, code: "physical", name: "Бидний хувилбар" },
    });
    expect(override.kindergartenId).toBe(kg.id);
  });
});

describe("school year", () => {
  it("allows only one current year per kindergarten", async () => {
    const { kg } = await makeKindergarten(); // already has isCurrent: true
    await expect(
      db.schoolYear.create({
        data: {
          kindergartenId: kg.id,
          name: "2026-2027",
          startsOn: new Date("2026-09-01"),
          endsOn: new Date("2027-06-01"),
          isCurrent: true,
        },
      }),
    ).rejects.toThrow();
  });

  it("allows many non-current years", async () => {
    const { kg } = await makeKindergarten();
    const past = await db.schoolYear.create({
      data: {
        kindergartenId: kg.id,
        name: "2024-2025",
        startsOn: new Date("2024-09-01"),
        endsOn: new Date("2025-06-01"),
        isCurrent: false,
      },
    });
    expect(past.isCurrent).toBe(false);
  });

  it("allows two kindergartens to each have a current year", async () => {
    await makeKindergarten();
    const second = await makeKindergarten();
    expect(second.year.isCurrent).toBe(true);
  });
});

describe("enrollment history", () => {
  it("allows only one ACTIVE enrollment per child per school year", async () => {
    const { kg, year, group } = await makeKindergarten();
    const child = await makeChild(kg.id);

    await db.enrollment.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        groupId: group.id,
        schoolYearId: year.id,
        startedOn: new Date("2025-09-01"),
        status: "ACTIVE",
      },
    });

    await expect(
      db.enrollment.create({
        data: {
          kindergartenId: kg.id,
          childId: child.id,
          groupId: group.id,
          schoolYearId: year.id,
          startedOn: new Date("2025-10-01"),
          status: "ACTIVE",
        },
      }),
    ).rejects.toThrow();
  });

  it("allows an ended enrollment alongside a new active one", async () => {
    // This is a transfer: the previous row is ended, a new one begins. The
    // history has to survive — it is what authorization reads.
    const { kg, year, group } = await makeKindergarten();
    const child = await makeChild(kg.id);

    await db.enrollment.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        groupId: group.id,
        schoolYearId: year.id,
        startedOn: new Date("2025-09-01"),
        endedOn: new Date("2025-12-31"),
        status: "ENDED",
      },
    });

    const current = await db.enrollment.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        groupId: group.id,
        schoolYearId: year.id,
        startedOn: new Date("2026-01-01"),
        status: "ACTIVE",
      },
    });

    expect(await db.enrollment.count({ where: { childId: child.id } })).toBe(2);
    expect(current.status).toBe("ACTIVE");
  });

  it("keeps enrollment rows when a group is soft-deleted", async () => {
    // Soft delete is a column, not a row removal, so history is unaffected.
    const { kg, year, group } = await makeKindergarten();
    const child = await makeChild(kg.id);
    await db.enrollment.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        groupId: group.id,
        schoolYearId: year.id,
        startedOn: new Date("2025-09-01"),
      },
    });

    await db.group.update({ where: { id: group.id }, data: { deletedAt: new Date() } });
    expect(await db.enrollment.count({ where: { childId: child.id } })).toBe(1);
  });
});

describe("referential integrity", () => {
  it("refuses to delete a kindergarten that still has children", async () => {
    // onDelete: Restrict. A kindergarten with data cannot vanish by accident —
    // soft delete is the supported path.
    const { kg } = await makeKindergarten();
    await makeChild(kg.id);
    await expect(db.kindergarten.delete({ where: { id: kg.id } })).rejects.toThrow();
  });

  it("refuses to delete a group that still has enrollments", async () => {
    const { kg, year, group } = await makeKindergarten();
    const child = await makeChild(kg.id);
    await db.enrollment.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        groupId: group.id,
        schoolYearId: year.id,
        startedOn: new Date("2025-09-01"),
      },
    });
    await expect(db.group.delete({ where: { id: group.id } })).rejects.toThrow();
  });

  it("cascades guardianships when a child is hard-deleted", async () => {
    const { kg } = await makeKindergarten();
    const child = await makeChild(kg.id);
    const user = await db.user.create({
      data: {
        username: uniq("parent"),
        passwordHash: "x",
        lastName: "Дорж",
        firstName: "Сараа",
      },
    });
    await db.guardianship.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        guardianUserId: user.id,
        relation: "MOTHER",
      },
    });

    await db.child.delete({ where: { id: child.id } });
    expect(await db.guardianship.count({ where: { childId: child.id } })).toBe(0);
  });
});

describe("uniqueness", () => {
  it("refuses two memberships with the same user, kindergarten and role", async () => {
    const { kg } = await makeKindergarten();
    const user = await db.user.create({
      data: { username: uniq("t"), passwordHash: "x", lastName: "А", firstName: "Б" },
    });
    await db.membership.create({
      data: { userId: user.id, kindergartenId: kg.id, role: "TEACHER" },
    });

    await expect(
      db.membership.create({
        data: { userId: user.id, kindergartenId: kg.id, role: "TEACHER" },
      }),
    ).rejects.toThrow();
  });

  it("allows the same user to hold different roles in one kindergarten", async () => {
    // A teacher whose own child attends the same kindergarten is a real case.
    const { kg } = await makeKindergarten();
    const user = await db.user.create({
      data: { username: uniq("t"), passwordHash: "x", lastName: "А", firstName: "Б" },
    });
    await db.membership.create({
      data: { userId: user.id, kindergartenId: kg.id, role: "TEACHER" },
    });
    const parent = await db.membership.create({
      data: { userId: user.id, kindergartenId: kg.id, role: "PARENT" },
    });
    expect(parent.role).toBe("PARENT");
  });

  it("refuses two guardianships linking the same guardian and child", async () => {
    const { kg } = await makeKindergarten();
    const child = await makeChild(kg.id);
    const user = await db.user.create({
      data: { username: uniq("p"), passwordHash: "x", lastName: "А", firstName: "Б" },
    });
    await db.guardianship.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        guardianUserId: user.id,
        relation: "MOTHER",
      },
    });
    await expect(
      db.guardianship.create({
        data: {
          kindergartenId: kg.id,
          childId: child.id,
          guardianUserId: user.id,
          relation: "FATHER",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a duplicate age profile for one child", async () => {
    const { kg } = await makeKindergarten();
    const child = await makeChild(kg.id);
    await db.childAgeProfile.create({
      data: { kindergartenId: kg.id, childId: child.id, age: 3 },
    });
    await expect(
      db.childAgeProfile.create({ data: { kindergartenId: kg.id, childId: child.id, age: 3 } }),
    ).rejects.toThrow();
  });

  it("refuses a duplicate storage key", async () => {
    // Two rows pointing at one object would make deletion ambiguous.
    const { kg } = await makeKindergarten();
    const key = `children/${uniq()}/${uniq()}`;
    await db.mediaFile.create({
      data: {
        kindergartenId: kg.id,
        purpose: "CHILD_PHOTO",
        storageKey: key,
        originalName: "a.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1,
      },
    });
    await expect(
      db.mediaFile.create({
        data: {
          kindergartenId: kg.id,
          purpose: "CHILD_PHOTO",
          storageKey: key,
          originalName: "b.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("attendance — one row per enrollment per day", () => {
  /**
   * ★ The index behind this is hand-written, so it is exactly the kind of
   * guarantee that vanishes silently.
   *
   * `@@unique([enrollmentId, date])` in schema.prisma emits a *plain* unique
   * index; the migration replaces it with a partial one over
   * `WHERE "deletedAt" IS NULL`. A future `migrate dev` that regenerates the
   * file without the hand edit would restore the plain form, nothing would
   * fail to compile, and the damage would surface much later as a day nobody
   * can re-record.
   */
  async function enrolledChild() {
    const { kg, year, group } = await makeKindergarten();
    const child = await db.child.create({
      data: {
        kindergartenId: kg.id,
        lastName: "Ганболд",
        firstName: "Батбаяр",
        sex: "MALE",
        dateOfBirth: new Date("2021-04-12"),
      },
    });
    const enrollment = await db.enrollment.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        groupId: group.id,
        schoolYearId: year.id,
        startedOn: new Date("2025-09-01"),
      },
    });
    return { kg, child, enrollment };
  }

  const day = new Date("2026-02-10");

  function row(kg: string, enrollmentId: string, childId: string, status: "PRESENT" | "SICK") {
    return { kindergartenId: kg, enrollmentId, childId, date: day, status };
  }

  it("refuses a second row for the same enrollment and day", async () => {
    const { kg, child, enrollment } = await enrolledChild();
    await db.attendance.create({ data: row(kg.id, enrollment.id, child.id, "PRESENT") });

    // A register submitted twice, or a form resent on a slow connection.
    await expect(
      db.attendance.create({ data: row(kg.id, enrollment.id, child.id, "SICK") }),
    ).rejects.toThrow();
  });

  /**
   * ★★ The reason the index is partial rather than plain.
   *
   * Postgres treats NULLs as distinct, so a plain unique index counts a
   * soft-deleted row as still occupying the day — and a day deleted once could
   * never be recorded again. The failure would read as a unique violation on a
   * row the user cannot see.
   */
  it("allows the day to be recorded again after the first row is soft-deleted", async () => {
    const { kg, child, enrollment } = await enrolledChild();
    const first = await db.attendance.create({
      data: row(kg.id, enrollment.id, child.id, "PRESENT"),
    });

    await db.attendance.update({
      where: { id: first.id },
      data: { deletedAt: new Date() },
    });

    const second = await db.attendance.create({
      data: row(kg.id, enrollment.id, child.id, "SICK"),
    });
    expect(second.id).not.toBe(first.id);

    const live = await db.attendance.count({
      where: { enrollmentId: enrollment.id, date: day, deletedAt: null },
    });
    expect(live, "exactly one live row for the day").toBe(1);
  });

  /**
   * The same child on two days, and two children on one day, are both ordinary
   * — the constraint is on the pair, not on either column.
   */
  it("allows the same enrollment on a different day", async () => {
    const { kg, child, enrollment } = await enrolledChild();
    await db.attendance.create({ data: row(kg.id, enrollment.id, child.id, "PRESENT") });

    const next = await db.attendance.create({
      data: {
        kindergartenId: kg.id,
        enrollmentId: enrollment.id,
        childId: child.id,
        date: new Date("2026-02-11"),
        status: "PRESENT",
      },
    });
    expect(next.date.toISOString().slice(0, 10)).toBe("2026-02-11");
  });
});

describe("defaults that carry security weight", () => {
  it("creates observations invisible to parents", async () => {
    // A teacher's working note is private until deliberately shared. If this
    // default ever flips, every private note in the system becomes visible.
    const { kg, year, group } = await makeKindergarten();
    const child = await makeChild(kg.id);
    const enrollment = await db.enrollment.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        groupId: group.id,
        schoolYearId: year.id,
        startedOn: new Date("2025-09-01"),
      },
    });
    const type = await db.observationType.findFirstOrThrow({ where: { kindergartenId: null } });

    const obs = await db.observation.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        enrollmentId: enrollment.id,
        typeId: type.id,
        observedOn: new Date("2026-01-15"),
      },
    });

    expect(obs.visibleToParents).toBe(false);
  });

  it("creates guardianships with view access and memberships active", async () => {
    const { kg } = await makeKindergarten();
    const child = await makeChild(kg.id);
    const user = await db.user.create({
      data: { username: uniq("p"), passwordHash: "x", lastName: "А", firstName: "Б" },
    });
    const g = await db.guardianship.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        guardianUserId: user.id,
        relation: "MOTHER",
      },
    });
    const m = await db.membership.create({
      data: { userId: user.id, kindergartenId: kg.id, role: "PARENT" },
    });
    expect(g.canView).toBe(true);
    expect(m.isActive).toBe(true);
  });
});

describe("platform operator flag", () => {
  it("defaults to false", async () => {
    const user = await db.user.create({
      data: {
        username: uniq("plain"),
        passwordHash: "x",
        lastName: "Овог",
        firstName: "Нэр",
      },
    });

    expect(user.isSuperAdmin).toBe(false);
  });

  it("can be set", async () => {
    const user = await db.user.create({
      data: {
        username: uniq("super"),
        passwordHash: "x",
        lastName: "Систем",
        firstName: "Админ",
        isSuperAdmin: true,
      },
    });

    expect(user.isSuperAdmin).toBe(true);
  });
});
