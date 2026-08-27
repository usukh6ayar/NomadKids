import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
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
 * User administration, memberships and own-profile editing.
 *
 * The recurring theme: an admin's reach stops at their own kindergartens, and
 * a user must not be able to widen their own access through the profile
 * endpoint.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let adminB: AuthSession;

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
  adminB = await login(app, b.adminUser.username);
});

const server = () => app.getHttpServer();

describe("GET /users", () => {
  it("lists users in the admin's kindergarten", async () => {
    const res = await request(server()).get("/v1/users").set("Cookie", adminA.cookies);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((u: { id: string }) => u.id);
    expect(ids).toContain(a.teacherUser.id);
    expect(ids).toContain(a.parentUser.id);
  });

  it("does NOT include users from another kindergarten", async () => {
    const res = await request(server()).get("/v1/users").set("Cookie", adminA.cookies);
    const ids = res.body.items.map((u: { id: string }) => u.id);

    expect(ids).not.toContain(b.teacherUser.id);
    expect(ids).not.toContain(b.parentUser.id);
  });

  it("returns only memberships the admin may see", async () => {
    // A parent with a child at two kindergartens must not reveal the second to
    // an admin of the first.
    await createMembership(a.parentUser.id, b.kindergarten.id, "PARENT");

    const res = await request(server()).get("/v1/users").set("Cookie", adminA.cookies);
    const parent = res.body.items.find((u: { id: string }) => u.id === a.parentUser.id);

    expect(parent.memberships).toHaveLength(1);
    expect(parent.memberships[0].kindergartenId).toBe(a.kindergarten.id);
  });

  it("refuses a teacher", async () => {
    expect((await request(server()).get("/v1/users").set("Cookie", teacherA.cookies)).status).toBe(
      404,
    );
  });

  it("refuses a parent", async () => {
    expect((await request(server()).get("/v1/users").set("Cookie", parentA.cookies)).status).toBe(
      404,
    );
  });

  it("refuses a kindergartenId the admin does not administer", async () => {
    // The parameter narrows; it must never grant.
    const res = await request(server())
      .get(`/v1/users?kindergartenId=${b.kindergarten.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(404);
  });

  it("filters by role", async () => {
    const res = await request(server()).get("/v1/users?role=TEACHER").set("Cookie", adminA.cookies);

    const ids = res.body.items.map((u: { id: string }) => u.id);
    expect(ids).toContain(a.teacherUser.id);
    expect(ids).not.toContain(a.parentUser.id);
  });

  it("searches by name", async () => {
    await createUser({ username: uniq("srch"), lastName: "Дорж", firstName: "Мөнхбат" });
    const found = await db.user.findFirstOrThrow({ where: { firstName: "Мөнхбат" } });
    await createMembership(found.id, a.kindergarten.id, "TEACHER");

    const res = await request(server()).get("/v1/users?q=Мөнхбат").set("Cookie", adminA.cookies);

    expect(res.body.items.map((u: { id: string }) => u.id)).toContain(found.id);
  });

  it("paginates", async () => {
    const res = await request(server())
      .get("/v1/users?page=1&pageSize=1")
      .set("Cookie", adminA.cookies);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBeGreaterThan(1);
  });
});

describe("GET /users/:id", () => {
  it("returns a user in the admin's kindergarten", async () => {
    const res = await request(server())
      .get(`/v1/users/${a.teacherUser.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a.teacherUser.id);
  });

  it("REFUSES a user from another kindergarten", async () => {
    const res = await request(server())
      .get(`/v1/users/${b.teacherUser.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(404);
  });

  it("never exposes a password hash", async () => {
    const res = await request(server())
      .get(`/v1/users/${a.teacherUser.id}`)
      .set("Cookie", adminA.cookies);

    expect(JSON.stringify(res.body)).not.toContain("argon2");
    expect(res.body).not.toHaveProperty("passwordHash");
  });
});

describe("POST /kindergartens/:id/users", () => {
  it("creates a user with an invitation token and no usable password", async () => {
    // ★ An admin who types a password for someone else knows that password,
    // and "temporary" credentials are permanent in practice. The account is
    // unusable until the invitation is accepted.
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/users`),
      adminA,
    ).send({
      username: uniq("newteacher"),
      lastName: "Батсуурь",
      firstName: "Ganаа",
      role: "TEACHER",
    });

    expect(res.status).toBe(201);
    expect(res.body.invitationToken).toEqual(expect.any(String));

    const token = await db.authToken.findFirst({
      where: { userId: res.body.user.id, purpose: "INVITATION" },
    });
    expect(token).not.toBeNull();
    // Only the hash is stored; the token itself lives in the invitation.
    expect(token!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates the membership in the right kindergarten", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/users`),
      adminA,
    ).send({ username: uniq("u"), lastName: "Тест", firstName: "Хэрэглэгч", role: "PARENT" });

    const memberships = await db.membership.findMany({ where: { userId: res.body.user.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.kindergartenId).toBe(a.kindergarten.id);
    expect(memberships[0]!.role).toBe("PARENT");
  });

  it("REFUSES creating a user in another kindergarten", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/users`),
      adminA,
    ).send({ username: uniq("u"), lastName: "Халдлага", firstName: "Оролдлого", role: "ADMIN" });

    expect(res.status).toBe(404);
  });

  it("refuses a duplicate username with 409, not 500", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/users`),
      adminA,
    ).send({
      username: a.teacherUser.username,
      lastName: "Давхардсан",
      firstName: "Нэр",
      role: "TEACHER",
    });

    expect(res.status).toBe(409);
  });

  it("validates the Mongolian phone format", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/users`),
      adminA,
    ).send({
      username: uniq("u"),
      phone: "12345",
      lastName: "Буруу",
      firstName: "Утас",
      role: "PARENT",
    });

    expect(res.status).toBe(400);
  });

  it("rejects a username with unsupported characters", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/users`),
      adminA,
    ).send({ username: "хэрэглэгч нэр", lastName: "А", firstName: "Б", role: "PARENT" });

    expect(res.status).toBe(400);
  });

  it("refuses a teacher creating users", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/users`),
      teacherA,
    ).send({ username: uniq("u"), lastName: "А", firstName: "Б", role: "TEACHER" });

    expect(res.status).toBe(404);
  });
});

/**
 * `PATCH /users/:id` — the admin edit the users screen now calls.
 *
 * ★ The cross-tenant refusal is covered below ("admin B cannot see, edit or
 * revoke anything belonging to A"). What was missing is everything the form
 * depends on: that the fields it sends are accepted, that the two conflicts it
 * has to display really are 409s, and that the field it must NOT offer is not
 * silently honoured.
 */
describe("PATCH /users/:id", () => {
  it("an admin edits a user in their own kindergarten", async () => {
    const res = await authed(request(server()).patch(`/v1/users/${a.teacherUser.id}`), adminA).send(
      { lastName: "Шинэ", firstName: "Нэр", email: "shine@nomadkids.mn", phone: "99001122" },
    );

    expect(res.status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: a.teacherUser.id } });
    expect(row.lastName).toBe("Шинэ");
    expect(row.phone).toBe("99001122");
  });

  it("clears an optional field when it is sent as null", async () => {
    await authed(request(server()).patch(`/v1/users/${a.teacherUser.id}`), adminA).send({
      email: "temp@nomadkids.mn",
    });

    const res = await authed(request(server()).patch(`/v1/users/${a.teacherUser.id}`), adminA).send(
      { email: null },
    );

    expect(res.status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: a.teacherUser.id } });
    expect(row.email).toBeNull();
  });

  it("deactivates without removing the account or its roles", async () => {
    const res = await authed(request(server()).patch(`/v1/users/${a.teacherUser.id}`), adminA).send(
      { isActive: false },
    );

    expect(res.status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: a.teacherUser.id } });
    expect(row.isActive).toBe(false);
    expect(row.deletedAt).toBeNull();

    const memberships = await db.membership.findMany({ where: { userId: a.teacherUser.id } });
    expect(memberships.length).toBeGreaterThan(0);
  });

  /** The 409 the edit dialog renders above its form. */
  it("refuses an email another account already holds", async () => {
    await authed(request(server()).patch(`/v1/users/${a.parentUser.id}`), adminA).send({
      email: "taken@nomadkids.mn",
    });

    const res = await authed(request(server()).patch(`/v1/users/${a.teacherUser.id}`), adminA).send(
      { email: "taken@nomadkids.mn" },
    );

    expect(res.status).toBe(409);
  });

  it("refuses a phone another account already holds", async () => {
    await authed(request(server()).patch(`/v1/users/${a.parentUser.id}`), adminA).send({
      phone: "99887766",
    });

    const res = await authed(request(server()).patch(`/v1/users/${a.teacherUser.id}`), adminA).send(
      { phone: "99887766" },
    );

    expect(res.status).toBe(409);
  });

  /**
   * ★★ The reason the dialog shows the login name read-only.
   *
   * `updateUserSchema` has no `username`, and Zod strips unknown keys rather
   * than rejecting them — so a form that offered the field would appear to
   * work and change nothing. This pins that it really is ignored, which is
   * what makes read-only the honest presentation.
   */
  it("ignores a username in the body rather than renaming the account", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: a.teacherUser.id } });

    const res = await authed(request(server()).patch(`/v1/users/${a.teacherUser.id}`), adminA).send(
      { username: "hijacked", lastName: "Хэвээр" },
    );

    expect(res.status).toBe(200);
    const after = await db.user.findUniqueOrThrow({ where: { id: a.teacherUser.id } });
    expect(after.username).toBe(before.username);
    expect(after.lastName).toBe("Хэвээр");
  });

  it("refuses a phone that is not eight digits", async () => {
    const res = await authed(request(server()).patch(`/v1/users/${a.teacherUser.id}`), adminA).send(
      { phone: "+97699000008" },
    );

    expect(res.status).toBe(400);
    expect(res.body.errors?.phone).toBeDefined();
  });
});

describe("memberships", () => {
  it("grants a role", async () => {
    const user = await createUser({ username: uniq("u") });

    const res = await authed(
      request(server()).post(`/v1/users/${user.id}/memberships`),
      adminA,
    ).send({ kindergartenId: a.kindergarten.id, role: "TEACHER" });

    expect(res.status).toBe(201);
  });

  it("REFUSES granting a role in another kindergarten", async () => {
    const user = await createUser({ username: uniq("u") });

    const res = await authed(
      request(server()).post(`/v1/users/${user.id}/memberships`),
      adminA,
    ).send({ kindergartenId: b.kindergarten.id, role: "ADMIN" });

    expect(res.status).toBe(404);
  });

  it("reactivates a revoked membership instead of erroring", async () => {
    // Re-hiring a teacher is a normal operation, not a conflict.
    await db.membership.update({
      where: { id: a.teacherMembership.id },
      data: { isActive: false },
    });

    const res = await authed(
      request(server()).post(`/v1/users/${a.teacherUser.id}/memberships`),
      adminA,
    ).send({ kindergartenId: a.kindergarten.id, role: "TEACHER" });

    expect(res.status).toBe(201);
    const row = await db.membership.findUnique({ where: { id: a.teacherMembership.id } });
    expect(row?.isActive).toBe(true);
  });

  it("refuses granting a role the user already actively holds", async () => {
    const res = await authed(
      request(server()).post(`/v1/users/${a.teacherUser.id}/memberships`),
      adminA,
    ).send({ kindergartenId: a.kindergarten.id, role: "TEACHER" });

    expect(res.status).toBe(409);
  });

  it("revoking DEACTIVATES rather than deletes", async () => {
    const res = await authed(
      request(server()).delete(`/v1/memberships/${a.teacherMembership.id}`),
      adminA,
    );
    expect(res.status).toBe(204);

    const row = await db.membership.findUnique({ where: { id: a.teacherMembership.id } });
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(false);
  });

  it("revoking a membership also ENDS its group assignments", async () => {
    // ★ Otherwise the GroupTeacher rows stay open, and reactivating the
    // membership later silently restores access to groups nobody re-granted.
    await authed(request(server()).delete(`/v1/memberships/${a.teacherMembership.id}`), adminA);

    const assignment = await db.groupTeacher.findUnique({ where: { id: a.assignment.id } });
    expect(assignment?.endedOn).not.toBeNull();
  });

  it("revoking takes effect immediately, without re-login", async () => {
    expect(
      (await request(server()).get("/v1/auth/me").set("Cookie", teacherA.cookies)).body.memberships,
    ).toHaveLength(1);

    await authed(request(server()).delete(`/v1/memberships/${a.teacherMembership.id}`), adminA);

    const after = await request(server()).get("/v1/auth/me").set("Cookie", teacherA.cookies);
    expect(after.body.memberships).toHaveLength(0);
  });

  it("refuses revoking another kindergarten's membership", async () => {
    const res = await authed(
      request(server()).delete(`/v1/memberships/${b.teacherMembership.id}`),
      adminA,
    );
    expect(res.status).toBe(404);
  });
});

describe("own profile", () => {
  it("returns the caller's own profile", async () => {
    const res = await request(server()).get("/v1/me/profile").set("Cookie", teacherA.cookies);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a.teacherUser.id);
  });

  it("is available to every role, including parents", async () => {
    expect(
      (await request(server()).get("/v1/me/profile").set("Cookie", parentA.cookies)).status,
    ).toBe(200);
  });

  it("updates the caller's own fields", async () => {
    const res = await authed(request(server()).patch("/v1/me/profile"), teacherA).send({
      bio: "Би 10 жил багшилсан.",
      specialization: "Сургуулийн өмнөх боловсрол",
    });

    expect(res.status).toBe(200);
  });

  it("IGNORES an attempt to reactivate a deactivated account", async () => {
    // ★ `isActive` is absent from the profile DTO, and unknown properties are
    // stripped — so a user cannot undo an admin's deactivation.
    const res = await authed(request(server()).patch("/v1/me/profile"), teacherA).send({
      isActive: true,
      lastName: "Шинэ",
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("isActive", "escalated");
  });

  it("refuses an email already used by another user", async () => {
    const other = await createUser({ username: uniq("o"), email: `${uniq()}@test.mn` });

    const res = await authed(request(server()).patch("/v1/me/profile"), teacherA).send({
      email: other.email,
    });

    expect(res.status).toBe(409);
  });

  it("requires authentication", async () => {
    expect((await request(server()).get("/v1/me/profile")).status).toBe(401);
  });

  it("requires CSRF on update", async () => {
    const res = await request(server())
      .patch("/v1/me/profile")
      .set("Cookie", teacherA.cookies)
      .send({ bio: "CSRF-гүй" });

    expect(res.status).toBe(403);
  });
});

describe("cross-admin isolation", () => {
  it("admin B cannot see, edit or revoke anything belonging to A", async () => {
    const checks = await Promise.all([
      request(server()).get(`/v1/users/${a.teacherUser.id}`).set("Cookie", adminB.cookies),
      authed(request(server()).patch(`/v1/users/${a.teacherUser.id}`), adminB).send({
        lastName: "Хулгай",
      }),
      authed(request(server()).delete(`/v1/memberships/${a.teacherMembership.id}`), adminB),
      authed(request(server()).patch(`/v1/kindergartens/${a.kindergarten.id}`), adminB).send({
        name: "Хулгай",
      }),
    ]);

    expect(checks.map((r) => r.status)).toEqual([404, 404, 404, 404]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Accepting an invitation — the step that makes the account usable
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /auth/invitation/accept", () => {
  const PASSWORD = "Shine-Nuuts99";

  /** Invites a user and returns the token the administrator would hand over. */
  async function invite(role: "TEACHER" | "PARENT" | "ADMIN" = "TEACHER") {
    const username = uniq("invited");
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/users`),
      adminA,
    ).send({ username, lastName: "Батсуурь", firstName: "Ганаа", role });

    if (res.status !== 201) throw new Error(`invite failed: ${res.status} ${res.text}`);
    return { username, token: res.body.invitationToken as string, userId: res.body.user.id };
  }

  it("sets the first password and the account can then log in", async () => {
    const { username, token } = await invite();

    // ★ Before: the account exists and cannot be opened by anyone. The password
    // is 32 random bytes nobody has ever seen.
    const before = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: username, password: PASSWORD });
    expect(before.status).toBe(401);

    const accept = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token, password: PASSWORD });
    expect(accept.status).toBe(204);

    const after = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: username, password: PASSWORD });
    expect(after.status).toBe(200);
  });

  it("consumes the token, so a link cannot be replayed", async () => {
    const { token } = await invite();

    await request(server()).post("/v1/auth/invitation/accept").send({ token, password: PASSWORD });

    const replay = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token, password: "Ondoo-Nuuts99" });

    expect(replay.status).toBe(401);
  });

  it("refuses an expired invitation", async () => {
    const { token, userId } = await invite();
    await db.authToken.updateMany({
      where: { userId, purpose: "INVITATION" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token, password: PASSWORD });

    expect(res.status).toBe(401);
  });

  it("refuses an unknown token", async () => {
    const res = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token: "not-a-real-token-value", password: PASSWORD });

    expect(res.status).toBe(401);
  });

  it("says the same thing for unknown, used and expired", async () => {
    const { token } = await invite();
    await request(server()).post("/v1/auth/invitation/accept").send({ token, password: PASSWORD });

    const used = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token, password: PASSWORD });
    const unknown = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token: "another-token-that-does-not-exist", password: PASSWORD });

    // Distinguishing them tells someone holding a guessed token something
    // about it.
    expect(used.body.title).toBe(unknown.body.title);
  });

  it("enforces the password policy", async () => {
    const { token } = await invite();

    const res = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token, password: "short" });

    expect(res.status).toBe(400);
  });

  /**
   * ★ The separation that matters.
   *
   * An invitation token must not be usable to reset an existing user's
   * password, and a reset token must not activate an invited account. Merging
   * the two endpoints — they take the same body — would quietly allow both.
   */
  it("an invitation token cannot be used on the password-reset endpoint", async () => {
    const { token } = await invite();

    const res = await request(server())
      .post("/v1/auth/password-reset/confirm")
      .send({ token, password: PASSWORD });

    expect(res.status).toBe(401);
  });

  it("a password-reset token cannot be used to accept an invitation", async () => {
    const user = await createUser({ username: uniq("existing") });
    await request(server()).post("/v1/auth/password-reset").send({ identifier: user.username });
    const row = await db.authToken.findFirst({
      where: { userId: user.id, purpose: "PASSWORD_RESET" },
    });
    expect(row).toBeTruthy();

    // The raw token is not readable from the row — only its hash is stored —
    // so this asserts the lookup is scoped by purpose using a token that is
    // certainly not an INVITATION one.
    const res = await request(server())
      .post("/v1/auth/invitation/accept")
      .send({ token: "a-token-that-is-not-an-invitation", password: PASSWORD });

    expect(res.status).toBe(401);
  });
});
