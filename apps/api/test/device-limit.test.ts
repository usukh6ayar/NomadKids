import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import { authed, createUser, login, TEST_PASSWORD, type AuthSession } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * The two-device limit (#211, the user 2026-10-12). A device is a
 * refresh-token family; the limit is checked only after the password.
 *
 * ★ Off everywhere else in the suite (`test/setup.ts`); on here.
 */
process.env.AUTH_DEVICE_LIMIT = "2";

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();

let username: string;

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  username = (await createUser({ username: uniq("dev") })).username;
});

const signIn = (body: Record<string, unknown>, agent = "Mozilla/5.0 (iPhone) Safari/604.1") =>
  request(server())
    .post("/v1/auth/login")
    .set("User-Agent", agent)
    .send({ identifier: username, password: TEST_PASSWORD, ...body });

const devicesForLogin = (password = TEST_PASSWORD) =>
  request(server()).post("/v1/auth/login/devices").send({ identifier: username, password });

async function twoDevices(): Promise<[AuthSession, AuthSession]> {
  return [await login(app, username), await login(app, username)];
}

describe("signing in on a third device", () => {
  it("is refused with 409 DEVICE_LIMIT once two are signed in", async () => {
    await twoDevices();

    const res = await signIn({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DEVICE_LIMIT");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("answers a wrong password with 401, never with the 409", async () => {
    await twoDevices();

    const res = await signIn({ password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBeUndefined();
  });

  it("lists the devices for the right password only, through the lockout", async () => {
    await twoDevices();

    const listed = await devicesForLogin();
    expect(listed.status).toBe(200);
    expect(listed.body.sessions).toHaveLength(2);
    expect(Object.keys(listed.body.sessions[0]).sort()).toEqual(
      ["createdAt", "id", "lastUsedAt", "userAgent"].sort(),
    );

    for (let i = 0; i < 5; i += 1) {
      expect((await devicesForLogin("wrong-password")).status).toBe(401);
    }
    // Five failures lock the identifier — for the list and the sign-in alike.
    expect((await devicesForLogin()).status).toBe(401);
    expect((await signIn({})).status).toBe(401);
  });

  it("signs the chosen device out and this one in", async () => {
    const [first] = await twoDevices();
    const listed = await devicesForLogin();
    const firstFamily = (
      await db.session.findFirstOrThrow({
        where: { userId: first.userId },
        orderBy: { createdAt: "asc" },
      })
    ).familyId;
    expect(listed.body.sessions.map((s: { id: string }) => s.id)).toContain(firstFamily);

    const res = await signIn({ replaceSessionId: firstFamily });

    expect(res.status).toBe(200);
    const stale = await request(server()).get("/v1/auth/me").set("Cookie", first.cookies);
    expect(stale.status).toBe(401);
    expect((await devicesForLogin()).body.sessions).toHaveLength(2);
  });

  it("refuses to replace a device that is not this account's, and signs nobody out", async () => {
    await twoDevices();
    const other = await createUser({ username: uniq("other") });
    const otherSession = await login(app, other.username);
    const otherFamily = (await db.session.findFirstOrThrow({ where: { userId: other.id } }))
      .familyId;

    const res = await signIn({ replaceSessionId: otherFamily });

    expect(res.status).toBe(409);
    const still = await request(server()).get("/v1/auth/me").set("Cookie", otherSession.cookies);
    expect(still.status).toBe(200);
  });

  it("a refresh is the same device, not a new one", async () => {
    const [first] = await twoDevices();

    const refreshed = await request(server()).post("/v1/auth/refresh").set("Cookie", first.cookies);

    expect(refreshed.status).toBe(200);
    expect((await devicesForLogin()).body.sessions).toHaveLength(2);
  });

  it("does not limit a platform operator", async () => {
    const operator = await createUser({ username: uniq("op"), isSuperAdmin: true });
    for (let i = 0; i < 3; i += 1) await login(app, operator.username);

    expect(await db.session.count({ where: { userId: operator.id, revokedAt: null } })).toBe(3);
  });
});

describe("«Бүртгэлтэй төхөөрөмж»", () => {
  it("lists the account's devices with this one marked", async () => {
    const [, second] = await twoDevices();

    const res = await request(server()).get("/v1/auth/sessions").set("Cookie", second.cookies);

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(2);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it("signs another of your devices out, which makes room for a new one", async () => {
    const [first, second] = await twoDevices();
    const listed = await request(server()).get("/v1/auth/sessions").set("Cookie", second.cookies);
    const other = listed.body.sessions.find((s: { current: boolean }) => !s.current);

    const res = await authed(request(server()).delete(`/v1/auth/sessions/${other.id}`), second);

    expect(res.status).toBe(204);
    expect((await request(server()).get("/v1/auth/me").set("Cookie", first.cookies)).status).toBe(
      401,
    );
    expect((await signIn({})).status).toBe(200);
  });

  it("is 404 for somebody else's device", async () => {
    const [mine] = await twoDevices();
    const other = await createUser({ username: uniq("other") });
    await login(app, other.username);
    const otherFamily = (await db.session.findFirstOrThrow({ where: { userId: other.id } }))
      .familyId;

    const res = await authed(request(server()).delete(`/v1/auth/sessions/${otherFamily}`), mine);

    expect(res.status).toBe(404);
    expect(await db.session.count({ where: { userId: other.id, revokedAt: null } })).toBe(1);
  });
});
