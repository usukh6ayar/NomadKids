import { describe, expect, it } from "vitest";
import { Role } from "../domain/enums";
import type { Actor } from "./actor";
import {
  canAccessChild,
  canAdministerChild,
  canArchiveChild,
  canEditObservationAsStaff,
  canObserveChild,
  canReadChildCard,
  canReadChildHealth,
  canReadObservations,
  canRecordChildHealth,
  canRecordForChild,
  childKindergartenIds,
  isAssignedSpecialistOf,
  isDoctorOver,
  seesFullChildCard,
  isAssignedTeacherOf,
  isFormerTeacherOf,
  isGuardianOf,
  type ChildAccessFacts,
} from "./child-access";

/**
 * Exhaustive unit tests for the authorization rules.
 *
 * These are necessary but NOT sufficient: a controller that forgets to call
 * `canAccessChild` passes every test in this file. The HTTP-level tests are
 * what prove the endpoints actually check — CLAUDE.md §4.1. Both exist.
 */

const KG_A = "kg-a";
const KG_B = "kg-b";
const GROUP_1 = "group-1";
const GROUP_2 = "group-2";

function actor(overrides: Partial<Actor> & { memberships: Actor["memberships"] }): Actor {
  return { userId: "user-1", sessionId: "session-1", isSuperAdmin: false, ...overrides };
}

function teacher(kindergartenId = KG_A, userId = "teacher-1"): Actor {
  return {
    userId,
    sessionId: "s",
    isSuperAdmin: false,
    memberships: [{ id: "m-teacher", kindergartenId, role: Role.TEACHER }],
  };
}

function parent(userId = "parent-1", kindergartenId = KG_A): Actor {
  return {
    userId,
    sessionId: "s",
    isSuperAdmin: false,
    memberships: [{ id: "m-parent", kindergartenId, role: Role.PARENT }],
  };
}

function admin(kindergartenId = KG_A, userId = "admin-1"): Actor {
  return {
    userId,
    sessionId: "s",
    isSuperAdmin: false,
    memberships: [{ id: "m-admin", kindergartenId, role: Role.ADMIN }],
  };
}

function facts(overrides: Partial<ChildAccessFacts> = {}): ChildAccessFacts {
  return {
    childId: "child-1",
    childKindergartenId: KG_A,
    childKindergartenKind: "CONTRACTED",
    enrollments: [{ groupId: GROUP_1, kindergartenId: KG_A, active: true }],
    guardianships: [],
    actorActiveTeachingGroupIds: [],
    actorActiveSpecialistGroupIds: [],
    ...overrides,
  };
}

describe("childKindergartenIds", () => {
  it("derives the set from enrollment history, not the denormalised column", () => {
    // The child currently sits in KG_B but was enrolled in KG_A. Both appear;
    // this is what keeps a previous kindergarten's own records reachable.
    const set = childKindergartenIds(
      facts({
        childKindergartenId: KG_B,
        enrollments: [
          { groupId: GROUP_1, kindergartenId: KG_A, active: true },
          { groupId: GROUP_2, kindergartenId: KG_B, active: true },
        ],
      }),
    );
    expect([...set].sort()).toEqual([KG_A, KG_B]);
  });

  it("ignores the denormalised column entirely when any enrollment exists", () => {
    const set = childKindergartenIds(
      facts({
        childKindergartenId: KG_B,
        enrollments: [{ groupId: GROUP_1, kindergartenId: KG_A, active: true }],
      }),
    );
    expect(set.has(KG_B)).toBe(false);
    expect(set.has(KG_A)).toBe(true);
  });

  it("falls back to the column only when there are NO enrollments at all", () => {
    // A child registered a minute ago. Without this, the staff member filling
    // in the record is locked out of it.
    const set = childKindergartenIds(facts({ childKindergartenId: KG_B, enrollments: [] }));
    expect([...set]).toEqual([KG_B]);
  });

  it("does not fall back merely because every enrollment has ended", () => {
    // The trigger is "no enrollments", not "no ACTIVE enrollment". Getting this
    // wrong would re-grant the current kindergarten access to every archived
    // child — and the two versions look nearly identical in review.
    const set = childKindergartenIds(
      facts({
        childKindergartenId: KG_B,
        enrollments: [{ groupId: GROUP_1, kindergartenId: KG_A, active: true }],
      }),
    );
    expect([...set]).toEqual([KG_A]);
  });
});

describe("isGuardianOf", () => {
  it("recognises an active guardian", () => {
    const f = facts({ guardianships: [{ guardianUserId: "parent-1", canView: true }] });
    expect(isGuardianOf(parent(), f)).toBe(true);
  });

  it("refuses a revoked guardian", () => {
    // canView = false is the revocation path; the relationship record survives
    // for custody history.
    const f = facts({ guardianships: [{ guardianUserId: "parent-1", canView: false }] });
    expect(isGuardianOf(parent(), f)).toBe(false);
  });

  it("refuses a guardian of a different child", () => {
    const f = facts({ guardianships: [{ guardianUserId: "other-parent", canView: true }] });
    expect(isGuardianOf(parent(), f)).toBe(false);
  });

  it("recognises one guardian among several", () => {
    const f = facts({
      guardianships: [
        { guardianUserId: "mother", canView: true },
        { guardianUserId: "father", canView: true },
      ],
    });
    expect(isGuardianOf(parent("father"), f)).toBe(true);
  });

  it("refuses one revoked guardian while the other keeps access", () => {
    const f = facts({
      guardianships: [
        { guardianUserId: "mother", canView: true },
        { guardianUserId: "father", canView: false },
      ],
    });
    expect(isGuardianOf(parent("mother"), f)).toBe(true);
    expect(isGuardianOf(parent("father"), f)).toBe(false);
  });
});

describe("isAssignedTeacherOf", () => {
  it("recognises a teacher assigned to the child's group", () => {
    expect(isAssignedTeacherOf(facts({ actorActiveTeachingGroupIds: [GROUP_1] }))).toBe(true);
  });

  it("refuses a teacher assigned to a different group", () => {
    expect(isAssignedTeacherOf(facts({ actorActiveTeachingGroupIds: [GROUP_2] }))).toBe(false);
  });

  it("refuses a teacher with no assignments", () => {
    expect(isAssignedTeacherOf(facts({ actorActiveTeachingGroupIds: [] }))).toBe(false);
  });

  it("does not reach a child who has left the group — D2 reversed, 2026-10-16", () => {
    // The teacher taught this child last year. They keep the notes they wrote
    // (`isFormerTeacherOf`), not the child's record.
    const f = facts({
      enrollments: [
        { groupId: GROUP_1, kindergartenId: KG_A, active: false },
        { groupId: GROUP_2, kindergartenId: KG_A, active: true },
      ],
      actorActiveTeachingGroupIds: [GROUP_1],
    });
    expect(isAssignedTeacherOf(f)).toBe(false);
    expect(isFormerTeacherOf(f)).toBe(true);
  });

  it("calls nobody a former teacher who teaches the child now, or never did", () => {
    const now = facts({ actorActiveTeachingGroupIds: [GROUP_1] });
    expect(isFormerTeacherOf(now)).toBe(false);
    const never = facts({ actorActiveTeachingGroupIds: [GROUP_2] });
    expect(isFormerTeacherOf(never)).toBe(false);
  });

  it("recognises a teacher assigned to several groups", () => {
    const f = facts({ actorActiveTeachingGroupIds: [GROUP_2, GROUP_1] });
    expect(isAssignedTeacherOf(f)).toBe(true);
  });
});

describe("canAccessChild", () => {
  it("allows an assigned teacher", () => {
    expect(canAccessChild(teacher(), facts({ actorActiveTeachingGroupIds: [GROUP_1] }))).toBe(true);
  });

  it("allows an active guardian", () => {
    const f = facts({ guardianships: [{ guardianUserId: "parent-1", canView: true }] });
    expect(canAccessChild(parent(), f)).toBe(true);
  });

  it("allows an admin of the child's kindergarten", () => {
    expect(canAccessChild(admin(KG_A), facts())).toBe(true);
  });

  it("refuses an admin of a different kindergarten", () => {
    expect(canAccessChild(admin(KG_B), facts())).toBe(false);
  });

  it("refuses a teacher from another group in the same kindergarten", () => {
    expect(canAccessChild(teacher(KG_A), facts({ actorActiveTeachingGroupIds: [GROUP_2] }))).toBe(
      false,
    );
  });

  it("refuses a guardian of another child", () => {
    const f = facts({ guardianships: [{ guardianUserId: "someone-else", canView: true }] });
    expect(canAccessChild(parent(), f)).toBe(false);
  });

  it("refuses a revoked teacher", () => {
    // Revocation shows up as the group disappearing from the actor's active
    // assignments — the GroupTeacher row has endedOn set.
    expect(canAccessChild(teacher(), facts({ actorActiveTeachingGroupIds: [] }))).toBe(false);
  });

  it("refuses an actor with no memberships at all", () => {
    expect(canAccessChild(actor({ memberships: [] }), facts())).toBe(false);
  });

  it("allows an admin to reach a child whose history includes their kindergarten", () => {
    const f = facts({
      childKindergartenId: KG_B,
      enrollments: [
        { groupId: GROUP_1, kindergartenId: KG_A, active: true },
        { groupId: GROUP_2, kindergartenId: KG_B, active: true },
      ],
    });
    expect(canAccessChild(admin(KG_A), f)).toBe(true);
    expect(canAccessChild(admin(KG_B), f)).toBe(true);
  });

  it("allows a teacher who is also the child's parent, by either chain", () => {
    // A teacher whose own child attends the same kindergarten is a real case,
    // and the reason Role lives on Membership rather than User.
    const dual: Actor = {
      userId: "dual",
      sessionId: "s",
      isSuperAdmin: false,
      memberships: [
        { id: "m1", kindergartenId: KG_A, role: Role.TEACHER },
        { id: "m2", kindergartenId: KG_A, role: Role.PARENT },
      ],
    };
    const f = facts({ guardianships: [{ guardianUserId: "dual", canView: true }] });
    expect(canAccessChild(dual, f)).toBe(true);
  });
});

describe("canRecordForChild", () => {
  it("allows an assigned teacher", () => {
    expect(canRecordForChild(teacher(), facts({ actorActiveTeachingGroupIds: [GROUP_1] }))).toBe(
      true,
    );
  });

  it("allows an admin of the child's kindergarten", () => {
    expect(canRecordForChild(admin(KG_A), facts())).toBe(true);
  });

  it("REFUSES the child's own guardian", () => {
    // Writing is narrower than reading. A parent may read the portfolio and
    // submit a parent observation through its own endpoint, but may not edit
    // the child, assess, upload to the gallery or delete anything.
    const f = facts({ guardianships: [{ guardianUserId: "parent-1", canView: true }] });
    expect(canAccessChild(parent(), f)).toBe(true);
    expect(canRecordForChild(parent(), f)).toBe(false);
  });

  it("refuses a teacher from another group", () => {
    expect(canRecordForChild(teacher(), facts({ actorActiveTeachingGroupIds: [GROUP_2] }))).toBe(
      false,
    );
  });
});

describe("canAdministerChild", () => {
  it("allows an admin only", () => {
    const f = facts({
      actorActiveTeachingGroupIds: [GROUP_1],
      guardianships: [{ guardianUserId: "parent-1", canView: true }],
    });
    expect(canAdministerChild(admin(KG_A), f)).toBe(true);
    expect(canAdministerChild(teacher(), f)).toBe(false);
    expect(canAdministerChild(parent(), f)).toBe(false);
  });
});

describe("canArchiveChild", () => {
  it("allows the teacher of the group the child attends now", () => {
    expect(canArchiveChild(teacher(), facts({ actorActiveTeachingGroupIds: [GROUP_1] }))).toBe(
      true,
    );
  });

  it("refuses the teacher of a group the child has left", () => {
    const moved = facts({
      enrollments: [
        { groupId: GROUP_1, kindergartenId: KG_A, active: false },
        { groupId: GROUP_2, kindergartenId: KG_A, active: true },
      ],
      actorActiveTeachingGroupIds: [GROUP_1],
    });
    // Neither reads nor removes them since 2026-10-16.
    expect(canAccessChild(teacher(), moved)).toBe(false);
    expect(canArchiveChild(teacher(), moved)).toBe(false);
  });

  it("refuses a teacher of another group and a guardian", () => {
    expect(canArchiveChild(teacher(), facts({ actorActiveTeachingGroupIds: [GROUP_2] }))).toBe(
      false,
    );
    const own = facts({ guardianships: [{ guardianUserId: "parent-1", canView: true }] });
    expect(canArchiveChild(parent(), own)).toBe(false);
  });

  it("allows an admin of the child's kindergarten, not of another", () => {
    expect(canArchiveChild(admin(KG_A), facts())).toBe(true);
    expect(canArchiveChild(admin(KG_B), facts())).toBe(false);
  });
});

function withRole(role: Role, kindergartenId = KG_A, userId = "staff-1"): Actor {
  return {
    userId,
    sessionId: "s",
    isSuperAdmin: false,
    memberships: [{ id: `m-${role}`, kindergartenId, role }],
  };
}

describe("PE/music teacher and doctor (2026-10-15)", () => {
  const pe = withRole(Role.PE_TEACHER);
  const doctor = withRole(Role.DOCTOR);
  const assigned = facts({ actorActiveSpecialistGroupIds: [GROUP_1] });

  it("a specialist reaches an assigned group's child for the card and observations only", () => {
    expect(isAssignedSpecialistOf(assigned)).toBe(true);
    expect(canReadChildCard(pe, assigned)).toBe(true);
    expect(seesFullChildCard(pe, assigned)).toBe(false);
    expect(canReadObservations(pe, assigned)).toBe(true);
    expect(canObserveChild(pe, assigned)).toBe(true);
    // ★ Never the general chains.
    expect(canAccessChild(pe, assigned)).toBe(false);
    expect(canRecordForChild(pe, assigned)).toBe(false);
    expect(canReadChildHealth(pe, assigned)).toBe(false);
  });

  it("a specialist of another group reaches nothing", () => {
    const other = facts({ actorActiveSpecialistGroupIds: [GROUP_2] });
    expect(canReadChildCard(pe, other)).toBe(false);
    expect(canReadObservations(pe, other)).toBe(false);
  });

  it("a specialist edits only their own staff note", () => {
    expect(
      canEditObservationAsStaff(pe, assigned, { authorId: "staff-1", source: "TEACHER" }),
    ).toBe(true);
    expect(
      canEditObservationAsStaff(pe, assigned, { authorId: "teacher-1", source: "TEACHER" }),
    ).toBe(false);
    expect(canEditObservationAsStaff(pe, assigned, { authorId: "staff-1", source: "PARENT" })).toBe(
      false,
    );
  });

  it("the doctor reaches every child of their kindergarten for health, and no development record", () => {
    expect(isDoctorOver(doctor, facts())).toBe(true);
    expect(canReadChildHealth(doctor, facts())).toBe(true);
    expect(canRecordChildHealth(doctor, facts())).toBe(true);
    expect(seesFullChildCard(doctor, facts())).toBe(true);
    expect(canAccessChild(doctor, facts())).toBe(false);
    expect(canReadObservations(doctor, facts())).toBe(false);
    expect(canObserveChild(doctor, facts())).toBe(false);
  });

  it("the doctor of another kindergarten reaches nothing", () => {
    const elsewhere = withRole(Role.DOCTOR, KG_B);
    expect(isDoctorOver(elsewhere, facts())).toBe(false);
    expect(canReadChildCard(elsewhere, facts())).toBe(false);
  });
});
