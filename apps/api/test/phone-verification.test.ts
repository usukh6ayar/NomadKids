import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createUser, login, type AuthSession } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { hashToken } from "../src/auth/token.service";
import type { VerifyMnClient } from "../src/integrations/verify-mn/verify-mn.client";

/**
 * Phone verification through verify.mn — 2026-10-01.
 *
 * Only the SMS gateway is replaced: `fakeVerifyMn` stands where verify.mn's
 * two endpoints stand, and `deliver(phone)` is the person texting the code.
 * Every route, guard and binding check is the real one.
 *
 * What these cases carry is the rule in `PhoneVerificationService`: a proof
 * is **this phone, for this purpose, for this account, once**. The flows with
 * verify.mn switched off are every other invitation and profile test in the
 * suite, which run with no key and are unchanged.
 */

// ★ Before the app is built — `VerifyMnConfig` reads the env at construction.
process.env.VERIFY_MN_API_KEY = "vrf_test_key_not_real";

const db = testDb();
const sessions = new Map<string, { phone: string; status: "PENDING" | "VERIFIED" | "EXPIRED" }>();

const fakeVerifyMn: Partial<VerifyMnClient> = {
  async createSession({ phone, text }) {
    const sessionId = randomUUID();
    sessions.set(sessionId, { phone, status: "PENDING" });
    return {
      sessionId,
      shortcode: "144773",
      text,
      smsUri: `sms:144773?body=${text}`,
      displayInstruction: `Та өөрийн ${phone} дугаараас 144773 дугаарт "${text}" гэж SMS илгээнэ үү.`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  },
  async getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error("unknown session");
    return { sessionId, sessionStatus: session.status };
  },
};

/** The person sends the SMS from `phone`. */
function deliver(phone: string) {
  for (const session of sessions.values()) {
    if (session.phone === phone) session.status = "VERIFIED";
  }
}

let app: INestApplication;
const server = () => app.getHttpServer();
const NEW_PASSWORD = "NewPass456";

beforeAll(async () => {
  app = await createTestApp({ verifyMn: fakeVerifyMn });
}, 60_000);

afterAll(async () => {
  await app?.close();
  delete process.env.VERIFY_MN_API_KEY;
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  sessions.clear();
});

async function startReset(phone: string) {
  return request(server()).post("/v1/auth/password-reset/phone").send({ phone });
}

async function startProfile(session: AuthSession, phone: string) {
  return authed(request(server()).post("/v1/me/phone-verification"), session).send({ phone });
}

describe("password reset by phone", () => {
  it("answers identically whether or not an account holds the number", async () => {
    await createUser({ phone: "99110001" });

    const known = await startReset("99110001");
    const unknown = await startReset("99110002");

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort());
    // verify.mn's session id is a capability (its GET needs no key) — never sent.
    expect(known.body).not.toHaveProperty("sessionId");

    const check = await request(server())
      .post("/v1/phone-verifications/check")
      .send({ handle: known.body.handle });
    expect(check.body).toEqual({ status: "PENDING", expiresAt: expect.any(String) });
  });

  it("resets the password once the SMS arrives, and only once", async () => {
    const user = await createUser({ phone: "99110003" });
    const { body } = await startReset("99110003");
    deliver("99110003");

    const check = await request(server())
      .post("/v1/phone-verifications/check")
      .send({ handle: body.handle });
    expect(check.body).toMatchObject({ status: "VERIFIED", accountFound: true });

    const confirm = await request(server())
      .post("/v1/auth/password-reset/phone/confirm")
      .send({ handle: body.handle, password: NEW_PASSWORD });
    expect(confirm.status).toBe(204);
    await login(app, user.username, NEW_PASSWORD);

    const replay = await request(server())
      .post("/v1/auth/password-reset/phone/confirm")
      .send({ handle: body.handle, password: "Another789" });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe("PHONE_UNVERIFIED");
  });

  it("refuses a handle whose SMS never arrived", async () => {
    await createUser({ phone: "99110004" });
    const { body } = await startReset("99110004");

    const confirm = await request(server())
      .post("/v1/auth/password-reset/phone/confirm")
      .send({ handle: body.handle, password: NEW_PASSWORD });
    expect(confirm.status).toBe(400);
  });

  it("refuses a proof made for the profile, though the phone is the same", async () => {
    const user = await createUser({ phone: "99110005" });
    const session = await login(app, user.username);

    // The account holder proves a number for their own settings screen…
    const started = await startProfile(session, "99110006");
    deliver("99110006");
    // …and a second account holds that number already (it was not saved yet).
    await createUser({ phone: "99110006" });

    const confirm = await request(server())
      .post("/v1/auth/password-reset/phone/confirm")
      .send({ handle: started.body.handle, password: NEW_PASSWORD });
    expect(confirm.status).toBe(400);
  });
});

describe("changing one's own phone", () => {
  it("needs a proof for a new number, and the proof must be for that number", async () => {
    const user = await createUser({ phone: "99120001" });
    const session = await login(app, user.username);

    const bare = await authed(request(server()).patch("/v1/me/profile"), session).send({
      phone: "99120002",
    });
    expect(bare.status).toBe(400);
    expect(bare.body.code).toBe("PHONE_UNVERIFIED");

    const started = await startProfile(session, "99120002");
    deliver("99120002");

    const other = await authed(request(server()).patch("/v1/me/profile"), session).send({
      phone: "99120003",
      phoneVerification: started.body.handle,
    });
    expect(other.status).toBe(400);

    const saved = await authed(request(server()).patch("/v1/me/profile"), session).send({
      phone: "99120002",
      phoneVerification: started.body.handle,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.phone).toBe("99120002");

    // The settings form sends every field on every save: the number already
    // on file needs no second SMS.
    const unchanged = await authed(request(server()).patch("/v1/me/profile"), session).send({
      phone: "99120002",
      firstName: "Шинэ",
    });
    expect(unchanged.status).toBe(200);
  });

  it("refuses another account's proof", async () => {
    const owner = await createUser({ phone: null });
    const other = await createUser({ phone: null });
    const ownerSession = await login(app, owner.username);
    const otherSession = await login(app, other.username);

    const started = await startProfile(ownerSession, "99120004");
    deliver("99120004");

    const stolen = await authed(request(server()).patch("/v1/me/profile"), otherSession).send({
      phone: "99120004",
      phoneVerification: started.body.handle,
    });
    expect(stolen.status).toBe(400);
  });
});

describe("accepting a guardian invitation", () => {
  async function invite() {
    const guardian = await createUser({ phone: null, firstName: "Асран хамгаалагч" });
    const token = `invite-${randomUUID()}`;
    await db.authToken.create({
      data: {
        userId: guardian.id,
        purpose: "INVITATION",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    return { guardian, token };
  }

  const accept = (token: string, phone: string, phoneVerification?: string) =>
    request(server()).post("/v1/auth/invitation/accept").send({
      token,
      password: NEW_PASSWORD,
      firstName: "Болд",
      phone,
      relation: "FATHER",
      phoneVerification,
    });

  it("refuses an unproven phone without spending the link", async () => {
    const { guardian, token } = await invite();

    const started = await request(server())
      .post("/v1/auth/invitation/phone")
      .send({ token, phone: "99130001" });
    expect(started.status).toBe(200);

    // Before the SMS arrives.
    const early = await accept(token, "99130001", started.body.handle);
    expect(early.status).toBe(400);

    const still = await request(server()).get(`/v1/auth/invitation/${token}`);
    expect(still.body.valid).toBe(true);

    deliver("99130001");
    const done = await accept(token, "99130001", started.body.handle);
    expect(done.status).toBe(204);
    expect((await db.user.findUniqueOrThrow({ where: { id: guardian.id } })).phone).toBe(
      "99130001",
    );
  });

  it("refuses a proof started for a different invitation", async () => {
    const first = await invite();
    const second = await invite();

    const started = await request(server())
      .post("/v1/auth/invitation/phone")
      .send({ token: first.token, phone: "99130002" });
    deliver("99130002");

    const crossed = await accept(second.token, "99130002", started.body.handle);
    expect(crossed.status).toBe(400);
  });
});
