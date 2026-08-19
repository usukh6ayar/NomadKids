import argon2 from "argon2";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { testDb, uniq } from "./db";
import type { Role } from "../../src/generated/prisma/enums";

/**
 * Domain fixtures.
 *
 * Written as small composable builders rather than one big `seedWorld()`,
 * because the authorization tests need to construct awkward shapes — a revoked
 * guardian, a teacher assigned to the wrong group, a child mid-transfer — and a
 * fixed world would force each of them to undo something.
 */

const db = testDb();

/** A password strong enough for the policy, shared by every test user. */
export const TEST_PASSWORD = "TestPass123";

let cachedHash: string | undefined;

/**
 * Hashed once and reused. Fixtures create dozens of users, and a fresh hash per
 * user is pure key-derivation time.
 *
 * The parameters must match `PasswordService`'s test cost, or `verify` would be
 * comparing against a hash the service cannot reproduce — argon2 reads its
 * parameters from the encoded hash, so this is about speed, not correctness.
 */
async function testPasswordHash(): Promise<string> {
  cachedHash ??= await argon2.hash(TEST_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 1024,
    timeCost: 1,
    parallelism: 1,
  });
  return cachedHash;
}

export async function createUser(overrides: Partial<UserInput> = {}) {
  return db.user.create({
    data: {
      username: overrides.username ?? uniq("user"),
      email: overrides.email ?? null,
      phone: overrides.phone ?? null,
      passwordHash: await testPasswordHash(),
      lastName: overrides.lastName ?? "Овог",
      firstName: overrides.firstName ?? "Нэр",
      isActive: overrides.isActive ?? true,
    },
  });
}

export async function createKindergarten(name?: string) {
  return db.kindergarten.create({ data: { name: name ?? `Цэцэрлэг ${uniq()}` } });
}

export async function createSchoolYear(kindergartenId: string, isCurrent = true) {
  return db.schoolYear.create({
    data: {
      kindergartenId,
      name: `2025-2026-${uniq()}`,
      startsOn: new Date("2025-09-01"),
      endsOn: new Date("2026-06-01"),
      isCurrent,
    },
  });
}

export async function createGroup(kindergartenId: string, schoolYearId: string, name?: string) {
  return db.group.create({
    data: {
      kindergartenId,
      schoolYearId,
      name: name ?? `Бүлэг ${uniq()}`,
      ageBand: "MIDDLE",
    },
  });
}

export async function createMembership(userId: string, kindergartenId: string, role: Role) {
  return db.membership.create({ data: { userId, kindergartenId, role } });
}

/** Assigns a teacher membership to a group. `endedOn` set = revoked. */
export async function assignTeacher(
  kindergartenId: string,
  groupId: string,
  membershipId: string,
  endedOn: Date | null = null,
) {
  return db.groupTeacher.create({
    data: { kindergartenId, groupId, membershipId, endedOn },
  });
}

export async function createChild(kindergartenId: string, overrides: Partial<ChildInput> = {}) {
  return db.child.create({
    data: {
      kindergartenId,
      lastName: overrides.lastName ?? "Ганболд",
      firstName: overrides.firstName ?? "Батбаяр",
      sex: overrides.sex ?? "MALE",
      dateOfBirth: overrides.dateOfBirth ?? new Date("2021-04-12"),
    },
  });
}

export async function enrollChild(
  kindergartenId: string,
  childId: string,
  groupId: string,
  schoolYearId: string,
  status: "ACTIVE" | "ENDED" | "TRANSFERRED" = "ACTIVE",
) {
  return db.enrollment.create({
    data: {
      kindergartenId,
      childId,
      groupId,
      schoolYearId,
      startedOn: new Date("2025-09-01"),
      endedOn: status === "ACTIVE" ? null : new Date("2026-01-31"),
      status,
    },
  });
}

export async function linkGuardian(
  kindergartenId: string,
  childId: string,
  guardianUserId: string,
  canView = true,
) {
  return db.guardianship.create({
    data: { kindergartenId, childId, guardianUserId, relation: "MOTHER", canView },
  });
}

/**
 * A complete, working kindergarten: one admin, one teacher assigned to a group,
 * one child enrolled in it, one parent linked to the child.
 *
 * The starting point for most tests, which then break one link deliberately.
 */
export async function createScenario(label = "a") {
  const kindergarten = await createKindergarten(`Цэцэрлэг ${label}-${uniq()}`);
  const schoolYear = await createSchoolYear(kindergarten.id);
  const group = await createGroup(kindergarten.id, schoolYear.id);

  const adminUser = await createUser({ username: uniq(`admin-${label}`) });
  const adminMembership = await createMembership(adminUser.id, kindergarten.id, "ADMIN");

  const teacherUser = await createUser({ username: uniq(`teacher-${label}`) });
  const teacherMembership = await createMembership(teacherUser.id, kindergarten.id, "TEACHER");
  const assignment = await assignTeacher(kindergarten.id, group.id, teacherMembership.id);

  const parentUser = await createUser({ username: uniq(`parent-${label}`) });
  await createMembership(parentUser.id, kindergarten.id, "PARENT");

  const child = await createChild(kindergarten.id);
  const enrollment = await enrollChild(kindergarten.id, child.id, group.id, schoolYear.id);
  const guardianship = await linkGuardian(kindergarten.id, child.id, parentUser.id);

  return {
    kindergarten,
    schoolYear,
    group,
    adminUser,
    adminMembership,
    teacherUser,
    teacherMembership,
    assignment,
    parentUser,
    child,
    enrollment,
    guardianship,
  };
}

export type Scenario = Awaited<ReturnType<typeof createScenario>>;

/**
 * Logs a user in through the real HTTP endpoint and returns their cookies.
 *
 * Going through the endpoint rather than minting a token directly means the
 * tests exercise the same cookie handling a browser would, including the CSRF
 * token that unsafe requests need.
 */
export async function login(
  app: INestApplication,
  username: string,
  password = TEST_PASSWORD,
): Promise<AuthSession> {
  const response = await request(app.getHttpServer())
    .post("/v1/auth/login")
    .send({ identifier: username, password });

  if (response.status !== 200) {
    throw new Error(`Login failed for ${username}: ${response.status} ${response.text}`);
  }

  const setCookie = response.headers["set-cookie"] as unknown as string[];
  return {
    cookies: setCookie.map((c) => c.split(";")[0]!).join("; "),
    rawCookies: setCookie,
    csrfToken: response.body.csrfToken as string,
    userId: response.body.user.id as string,
  };
}

export interface AuthSession {
  cookies: string;
  rawCookies: string[];
  csrfToken: string;
  userId: string;
}

/** Applies a session's cookies and CSRF header to a supertest request. */
export function authed<T extends { set: (field: string, value: string) => T }>(
  req: T,
  session: AuthSession,
): T {
  return req.set("Cookie", session.cookies).set("X-CSRF-Token", session.csrfToken);
}

interface UserInput {
  username: string;
  email: string | null;
  phone: string | null;
  lastName: string;
  firstName: string;
  isActive: boolean;
}

interface ChildInput {
  lastName: string;
  firstName: string;
  sex: "MALE" | "FEMALE";
  dateOfBirth: Date;
}
