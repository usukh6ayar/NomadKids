import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createKindergarten,
  createMembership,
  createUser,
  login,
  TEST_PASSWORD,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { hashToken } from "../src/auth/token.service";

/**
 * Auth integration tests — real app, real database, real cookies.
 *
 * Everything here goes through HTTP. A unit test of AuthService would pass even
 * if the controller forgot to set a cookie or the guard were never registered.
 */

let app: INestApplication;
const db = testDb();

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  // The limiter is in-process and would otherwise carry counts between tests,
  // making later cases fail depending on what ran before them.
  app.get(RateLimitService).resetAll();
});

const server = () => app.getHttpServer();

describe("POST /auth/login", () => {
  it("accepts valid credentials and sets three cookies", async () => {
    const user = await createUser({ username: uniq("u") });

    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);

    const cookies = (res.headers["set-cookie"] as unknown as string[]).join(";");
    expect(cookies).toContain("kinder_access=");
    expect(cookies).toContain("kinder_refresh=");
    expect(cookies).toContain("kinder_csrf=");
  });

  it("never puts a token in the response body", async () => {
    // A token in JSON is a token some frontend eventually stores in
    // localStorage. The body carries only what the UI renders.
    const user = await createUser({ username: uniq("u") });
    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: TEST_PASSWORD });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("kinder_access");
    expect(res.body).not.toHaveProperty("accessToken");
    expect(res.body).not.toHaveProperty("refreshToken");
  });

  it("marks the session cookies HttpOnly and SameSite=Lax", async () => {
    const user = await createUser({ username: uniq("u") });
    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: TEST_PASSWORD });

    const raw = res.headers["set-cookie"] as unknown as string[];
    const access = raw.find((c) => c.startsWith("kinder_access="))!;
    const refresh = raw.find((c) => c.startsWith("kinder_refresh="))!;
    const csrf = raw.find((c) => c.startsWith("kinder_csrf="))!;

    expect(access).toContain("HttpOnly");
    expect(access).toContain("SameSite=Lax");
    expect(refresh).toContain("HttpOnly");
    // The refresh cookie is scoped to its own path, so it is absent from every
    // other request and cannot be stolen by an XSS payload reading one response.
    expect(refresh).toContain("Path=/v1/auth/refresh");
    // The CSRF cookie is the one the frontend must read, so it is NOT HttpOnly.
    expect(csrf).not.toContain("HttpOnly");
  });

  it("sets no Domain attribute — host-only is intended", async () => {
    // nomadkids.mn and api.nomadkids.mn are same-site, so a host-only cookie
    // already works. A Domain would broadcast the session to every subdomain.
    const user = await createUser({ username: uniq("u") });
    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: TEST_PASSWORD });

    const raw = res.headers["set-cookie"] as unknown as string[];
    expect(raw.join(";")).not.toContain("Domain=");
  });

  it("accepts login by email and by phone", async () => {
    const user = await createUser({
      username: uniq("u"),
      email: `${uniq()}@test.mn`,
      phone: `9911${Math.floor(1000 + Math.random() * 8999)}`,
    });

    for (const identifier of [user.email!, user.phone!]) {
      const res = await request(server())
        .post("/v1/auth/login")
        .send({ identifier, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
    }
  });

  it("rejects a wrong password", async () => {
    const user = await createUser({ username: uniq("u") });
    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: "WrongPass123" });

    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("gives an unknown user and a wrong password the same message", async () => {
    // Any difference here is a user-enumeration oracle.
    const user = await createUser({ username: uniq("u") });

    const wrongPassword = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: "WrongPass123" });

    const unknownUser = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: "no-such-person", password: "WrongPass123" });

    expect(wrongPassword.status).toBe(unknownUser.status);
    expect(wrongPassword.body.detail ?? wrongPassword.body.title).toBe(
      unknownUser.body.detail ?? unknownUser.body.title,
    );
  });

  it("refuses a deactivated user", async () => {
    const user = await createUser({ username: uniq("u"), isActive: false });
    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("refuses a soft-deleted user", async () => {
    const user = await createUser({ username: uniq("u") });
    await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await request(server()).post("/v1/auth/login").send({ identifier: "" });
    expect(res.status).toBe(400);
  });
});

describe("account lockout", () => {
  it("locks after five failures and keeps rejecting the CORRECT password", async () => {
    // The lockout has to be checked before the password, or the window becomes
    // a free oracle for testing whether a guess was right.
    const user = await createUser({ username: uniq("u") });

    for (let i = 0; i < 5; i++) {
      await request(server())
        .post("/v1/auth/login")
        .send({ identifier: user.username, password: `Wrong${i}Pass1` });
    }

    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.detail ?? res.body.title).toMatch(/олон удаа|Хэт олон/);
  });

  it("records failures in the database, so a restart does not clear them", async () => {
    const user = await createUser({ username: uniq("u") });
    await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: "WrongPass123" });

    const failures = await db.loginAttempt.count({
      where: { identifier: user.username, succeeded: false },
    });
    expect(failures).toBe(1);
  });

  it("counts failures for a username that does not exist", async () => {
    // Otherwise an attacker enumerating usernames is never throttled.
    await request(server())
      .post("/v1/auth/login")
      .send({ identifier: "ghost-user", password: "WrongPass123" });

    expect(await db.loginAttempt.count({ where: { identifier: "ghost-user" } })).toBe(1);
  });

  it("clears the failure count after a successful login", async () => {
    const user = await createUser({ username: uniq("u") });

    for (let i = 0; i < 3; i++) {
      await request(server())
        .post("/v1/auth/login")
        .send({ identifier: user.username, password: "WrongPass123" });
    }
    await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: TEST_PASSWORD });

    const remaining = await db.loginAttempt.count({
      where: { identifier: user.username, succeeded: false },
    });
    expect(remaining).toBe(0);
  });

  it("writes an audit row for a failed login", async () => {
    const user = await createUser({ username: uniq("u") });
    await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: "WrongPass123" });

    expect(await db.auditLog.count({ where: { action: "LOGIN_FAILED" } })).toBe(1);
  });
});

describe("GET /auth/me", () => {
  it("returns the user and their memberships", async () => {
    const kg = await createKindergarten();
    const user = await createUser({ username: uniq("u") });
    await createMembership(user.id, kg.id, "TEACHER");

    const session = await login(app, user.username);
    const res = await request(server()).get("/v1/auth/me").set("Cookie", session.cookies);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0].role).toBe("TEACHER");
  });

  it("refuses an unauthenticated request", async () => {
    expect((await request(server()).get("/v1/auth/me")).status).toBe(401);
  });

  it("refuses a tampered access cookie", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);
    const tampered = session.cookies.replace(
      /kinder_access=[^;]+/,
      "kinder_access=forged.jwt.here",
    );

    expect((await request(server()).get("/v1/auth/me").set("Cookie", tampered)).status).toBe(401);
  });

  it("stops working the moment the session is revoked", async () => {
    // Proof that authority is re-read per request rather than trusted from the
    // token. This is what makes revoking a teacher's access immediate.
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);

    expect((await request(server()).get("/v1/auth/me").set("Cookie", session.cookies)).status).toBe(
      200,
    );

    await db.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });

    expect((await request(server()).get("/v1/auth/me").set("Cookie", session.cookies)).status).toBe(
      401,
    );
  });

  it("reflects a membership revoked after login, without re-login", async () => {
    const kg = await createKindergarten();
    const user = await createUser({ username: uniq("u") });
    const membership = await createMembership(user.id, kg.id, "TEACHER");

    const session = await login(app, user.username);
    await db.membership.update({ where: { id: membership.id }, data: { isActive: false } });

    const res = await request(server()).get("/v1/auth/me").set("Cookie", session.cookies);
    expect(res.body.memberships).toHaveLength(0);
  });
});

describe("POST /auth/refresh", () => {
  it("rotates the refresh token and revokes the old one", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);
    const oldRefresh = extractCookie(session.rawCookies, "kinder_refresh");

    const res = await request(server()).post("/v1/auth/refresh").set("Cookie", session.cookies);

    expect(res.status).toBe(200);
    const newRefresh = extractCookie(
      res.headers["set-cookie"] as unknown as string[],
      "kinder_refresh",
    );
    expect(newRefresh).not.toBe(oldRefresh);

    const old = await db.session.findUnique({ where: { tokenHash: hashToken(oldRefresh) } });
    expect(old?.revokedAt).not.toBeNull();
  });

  it("revokes the whole family when a rotated token is replayed", async () => {
    // Two parties holding the cookie means it was stolen: the legitimate client
    // discards the old token after rotating. Killing the family logs both out.
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);

    await request(server()).post("/v1/auth/refresh").set("Cookie", session.cookies);

    // Replay the now-rotated token.
    const replay = await request(server()).post("/v1/auth/refresh").set("Cookie", session.cookies);
    expect(replay.status).toBe(401);

    const live = await db.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it("refuses an unknown refresh token", async () => {
    const res = await request(server())
      .post("/v1/auth/refresh")
      .set("Cookie", "kinder_refresh=not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("refuses an expired session and revokes it", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(
      (await request(server()).post("/v1/auth/refresh").set("Cookie", session.cookies)).status,
    ).toBe(401);
  });

  it("clears cookies when the refresh is refused", async () => {
    // Otherwise the browser retries a dead token forever and the user sees a
    // login screen that never succeeds.
    const res = await request(server())
      .post("/v1/auth/refresh")
      .set("Cookie", "kinder_refresh=garbage");

    const cleared = (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    expect(cleared.join(";")).toContain("kinder_access=;");
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session and clears cookies", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);

    const res = await authed(request(server()).post("/v1/auth/logout"), session);
    expect(res.status).toBe(204);

    expect(await db.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect((await request(server()).get("/v1/auth/me").set("Cookie", session.cookies)).status).toBe(
      401,
    );
  });

  it("requires authentication", async () => {
    expect((await request(server()).post("/v1/auth/logout")).status).toBe(401);
  });
});

describe("CSRF protection", () => {
  it("rejects an unsafe request with no CSRF header", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);

    const res = await request(server()).post("/v1/auth/logout").set("Cookie", session.cookies);
    expect(res.status).toBe(403);
  });

  it("rejects a mismatched CSRF token", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);

    const res = await request(server())
      .post("/v1/auth/logout")
      .set("Cookie", session.cookies)
      .set("X-CSRF-Token", "some-other-value");
    expect(res.status).toBe(403);
  });

  it("allows GET without a CSRF header", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);
    expect((await request(server()).get("/v1/auth/me").set("Cookie", session.cookies)).status).toBe(
      200,
    );
  });

  it("rejects an unsafe request from a disallowed Origin", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);

    const res = await authed(request(server()).post("/v1/auth/logout"), session).set(
      "Origin",
      "https://evil.example",
    );
    expect(res.status).toBe(403);
  });
});

describe("password reset", () => {
  it("returns 204 for an unknown identifier, revealing nothing", async () => {
    const res = await request(server())
      .post("/v1/auth/password-reset")
      .send({ identifier: "nobody-here" });
    expect(res.status).toBe(204);
  });

  it("issues a single-use token and stores only its hash", async () => {
    const user = await createUser({ username: uniq("u") });
    await request(server()).post("/v1/auth/password-reset").send({ identifier: user.username });

    const token = await db.authToken.findFirst({
      where: { userId: user.id, purpose: "PASSWORD_RESET" },
    });
    expect(token).not.toBeNull();
    // 64 hex characters = SHA-256. The token itself exists only in the email.
    expect(token!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("invalidates a previous token when a new one is requested", async () => {
    const user = await createUser({ username: uniq("u") });
    await request(server()).post("/v1/auth/password-reset").send({ identifier: user.username });
    await request(server()).post("/v1/auth/password-reset").send({ identifier: user.username });

    const unused = await db.authToken.count({ where: { userId: user.id, usedAt: null } });
    expect(unused).toBe(1);
  });

  it("completes a reset, ends every session and accepts the new password", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);

    // Mint a token directly: the real one is mailed, and the controller only
    // prints it in development.
    const raw = "reset-token-" + uniq();
    await db.authToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const res = await request(server())
      .post("/v1/auth/password-reset/confirm")
      .send({ token: raw, password: "BrandNew123" });
    expect(res.status).toBe(204);

    // Existing sessions must die — a user resetting because they fear they were
    // compromised should not leave the intruder logged in.
    expect((await request(server()).get("/v1/auth/me").set("Cookie", session.cookies)).status).toBe(
      401,
    );

    const relogin = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: "BrandNew123" });
    expect(relogin.status).toBe(200);
  });

  it("clears the lockout so a locked-out user can log in after resetting", async () => {
    // This is why a reset exists: the user forgot their password, tried five
    // times, and is now locked out. If the reset does not clear the counter,
    // it appears to succeed and the next login still fails — which reads as
    // the reset being broken.
    //
    // `LoginAttempt.identifier` stores what was typed, not a user id, so
    // clearing has to go through every identifier the user can log in with.
    const user = await createUser({ username: uniq("u"), email: `${uniq()}@test.mn` });

    for (let i = 0; i < 5; i++) {
      await request(server())
        .post("/v1/auth/login")
        .send({ identifier: user.username, password: "WrongPass123" });
    }

    const raw = "reset-" + uniq();
    await db.authToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await request(server())
      .post("/v1/auth/password-reset/confirm")
      .send({ token: raw, password: "BrandNew123" });

    const relogin = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: "BrandNew123" });

    expect(relogin.status).toBe(200);
  });

  it("refuses to reuse a consumed token", async () => {
    const user = await createUser({ username: uniq("u") });
    const raw = "reset-" + uniq();
    await db.authToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await request(server())
      .post("/v1/auth/password-reset/confirm")
      .send({ token: raw, password: "BrandNew123" });

    const second = await request(server())
      .post("/v1/auth/password-reset/confirm")
      .send({ token: raw, password: "Another123" });
    expect(second.status).toBe(401);
  });

  it("refuses an expired token", async () => {
    const user = await createUser({ username: uniq("u") });
    const raw = "reset-" + uniq();
    await db.authToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const res = await request(server())
      .post("/v1/auth/password-reset/confirm")
      .send({ token: raw, password: "BrandNew123" });
    expect(res.status).toBe(401);
  });

  it("enforces the password policy on reset", async () => {
    const user = await createUser({ username: uniq("u") });
    const raw = "reset-" + uniq();
    await db.authToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    // All lower case, no digit — fails the policy even though it is long.
    const res = await request(server())
      .post("/v1/auth/password-reset/confirm")
      .send({ token: raw, password: "alllowercase" });
    expect(res.status).toBe(401);
  });
});

describe("change password", () => {
  it("changes it and keeps the current session alive", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);

    const res = await authed(request(server()).post("/v1/auth/password"), session).send({
      currentPassword: TEST_PASSWORD,
      newPassword: "Changed123",
    });
    expect(res.status).toBe(204);

    // The tab the user is looking at should not log itself out.
    expect((await request(server()).get("/v1/auth/me").set("Cookie", session.cookies)).status).toBe(
      200,
    );
  });

  it("ends OTHER sessions", async () => {
    const user = await createUser({ username: uniq("u") });
    const first = await login(app, user.username);
    const second = await login(app, user.username);

    await authed(request(server()).post("/v1/auth/password"), second).send({
      currentPassword: TEST_PASSWORD,
      newPassword: "Changed123",
    });

    expect((await request(server()).get("/v1/auth/me").set("Cookie", first.cookies)).status).toBe(
      401,
    );
  });

  it("refuses a wrong current password", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username);

    const res = await authed(request(server()).post("/v1/auth/password"), session).send({
      currentPassword: "NotMyPassword1",
      newPassword: "Changed123",
    });
    expect(res.status).toBe(401);
  });
});

/**
 * Rate limiting.
 *
 * ★ Two controls, and they defend different things. Testing only one gives a
 * false sense of the other.
 *
 *  - The **per-identifier lockout** is what stops brute force. Five failures
 *    against one account locks it for fifteen minutes, recorded in the database
 *    so it survives a restart and holds across instances.
 *  - The **per-IP limit** is supplementary volume control, deliberately set high
 *    (60 / 15 min) because a kindergarten is one NAT address — see the note on
 *    the login handler and docs/SECURITY.md §9.
 *
 * The counts below track those numbers. When Phase 12 raised the per-IP limit
 * from 10 to 60, these tests failed with `expected [401 …] to include 429` —
 * correctly, because they were pinned to the old value. They are written
 * against the *documented* limits so the same thing happens next time.
 */
describe("rate limiting", () => {
  /** Mirrors the limit on the login handler. */
  const PER_IP_LOGIN_LIMIT = 60;

  it("★ locks a single account after repeated failures, whatever the IP", async () => {
    const user = await createUser({ username: uniq("locktarget") });

    const statuses: number[] = [];
    let lockedMessage: string | undefined;

    // Five failures is the threshold; the sixth attempt is refused as locked.
    for (let i = 0; i < 7; i++) {
      const res = await request(server())
        .post("/v1/auth/login")
        .send({ identifier: user.username, password: "WrongPass123" });
      statuses.push(res.status);
      if (/Хэт олон удаа буруу оролдлоо/.test(JSON.stringify(res.body))) {
        lockedMessage = res.body.detail;
        break;
      }
    }

    // 401 throughout — a locked account must not be distinguishable by status
    // from a wrong password, or the lockout itself becomes an oracle.
    expect(statuses.every((s) => s === 401)).toBe(true);
    expect(lockedMessage).toBeDefined();
  });

  it("★ the correct password is refused while the account is locked", async () => {
    const user = await createUser({ username: uniq("locked") });

    for (let i = 0; i < 5; i++) {
      await request(server())
        .post("/v1/auth/login")
        .send({ identifier: user.username, password: "WrongPass123" });
    }

    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
  });

  /**
   * ★ Locking one account must not lock the building.
   *
   * This is the property the old per-IP limit of 10 quietly destroyed: with
   * every teacher behind one address, one person's failed attempts consumed the
   * budget for everyone.
   */
  it("★ locking one account does not affect another user on the same IP", async () => {
    const victim = await createUser({ username: uniq("victim") });
    const bystander = await createUser({ username: uniq("bystander") });

    for (let i = 0; i < 6; i++) {
      await request(server())
        .post("/v1/auth/login")
        .send({ identifier: victim.username, password: "WrongPass123" });
    }

    const res = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: bystander.username, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
  });

  it("throttles a username spray from one IP once the per-IP limit is passed", async () => {
    const responses: number[] = [];

    // Distinct identifiers, so the per-identifier lockout never engages and the
    // only thing that can stop this is the per-IP limit.
    for (let i = 0; i < PER_IP_LOGIN_LIMIT + 10; i++) {
      const res = await request(server())
        .post("/v1/auth/login")
        .send({ identifier: `spray-${uniq()}-${i}`, password: "WrongPass123" });
      responses.push(res.status);
      if (res.status === 429) break;
    }

    expect(responses).toContain(429);
  });

  it("sends Retry-After when throttled", async () => {
    let throttled: request.Response | undefined;

    for (let i = 0; i < PER_IP_LOGIN_LIMIT + 10; i++) {
      const res = await request(server())
        .post("/v1/auth/login")
        .send({ identifier: `retry-${uniq()}-${i}`, password: "WrongPass123" });
      if (res.status === 429) {
        throttled = res;
        break;
      }
    }

    expect(throttled?.headers["retry-after"]).toBeDefined();
  });
});

function extractCookie(setCookie: string[], name: string): string {
  const found = setCookie.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`Cookie ${name} not found`);
  return found.split(";")[0]!.split("=")[1]!;
}
