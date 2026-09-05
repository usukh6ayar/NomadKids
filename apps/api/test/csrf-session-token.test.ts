import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import { createUser, login, TEST_PASSWORD } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * The CSRF token as a *split-origin browser* obtains it.
 *
 * ★ The distinction this file exists to prove.
 *
 * Every other CSRF test takes the token out of the `Set-Cookie` header, which
 * is something only a server-side HTTP client can do. A browser on
 * `https://nomadkids.mn` cannot: `kinder_csrf` is a host-only cookie belonging
 * to `https://api.nomadkids.mn`, so the browser attaches it to requests going
 * there but `document.cookie` on the web origin never sees it. Cookies scope by
 * domain; same-site is not the same as same-host.
 *
 * So the web app takes the token from the **response body** of `/auth/me` —
 * and these cases prove that value is the one `CsrfGuard` accepts. If it ever
 * stopped matching the cookie, every save in production would 403 while every
 * existing test stayed green.
 *
 * The browser half — that the app reads the session and never `document.cookie`
 * — is in `apps/web/test/csrf.test.tsx`.
 *
 * ★★ `createTestApp()` does not call `enableCors`, so nothing here tests CORS.
 * What the origin cases below exercise is `CsrfGuard`'s own origin check, which
 * is a second, independent layer.
 */

const WEB_ORIGIN = "https://nomadkids.mn";

let app: INestApplication;
let originalCorsOrigins: string | undefined;
testDb();

beforeAll(async () => {
  // `CsrfGuard` reads the environment once, in its constructor, so this has to
  // be set before the app is built. Restored in afterAll — the API suite runs
  // one file per fork, but an unrestored global is a trap for whoever adds the
  // next file.
  originalCorsOrigins = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = WEB_ORIGIN;

  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
  if (originalCorsOrigins === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = originalCorsOrigins;
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
});

const server = () => app.getHttpServer();

/** Signs in and reads the token back the way the web app does — from `/auth/me`. */
async function signInLikeABrowser() {
  const user = await createUser({ username: uniq("u") });
  const session = await login(app, user.username, TEST_PASSWORD);

  const me = await request(server()).get("/v1/auth/me").set("Cookie", session.cookies);
  expect(me.status).toBe(200);

  return { user, session, sessionToken: me.body.csrfToken as string };
}

describe("the token in the session body", () => {
  it("is present on /auth/me and pairs with the cookie the browser holds", async () => {
    const { session, sessionToken } = await signInLikeABrowser();

    expect(typeof sessionToken).toBe("string");
    expect(sessionToken.length).toBeGreaterThan(0);

    // The double-submit pair. The web app only ever sees the left-hand side;
    // the browser sends the right-hand side by itself.
    const cookieValue = session.rawCookies
      .find((c) => c.startsWith("kinder_csrf="))!
      .split(";")[0]!
      .slice("kinder_csrf=".length);

    expect(sessionToken).toBe(cookieValue);
  });

  it("is accepted by CsrfGuard on a protected mutation", async () => {
    const { session, sessionToken } = await signInLikeABrowser();

    const res = await request(server())
      .patch("/v1/me/profile")
      .set("Cookie", session.cookies)
      .set("Origin", WEB_ORIGIN)
      .set("X-CSRF-Token", sessionToken)
      .send({ bio: "Сешн дэх токеноор хадгаллаа" });

    expect(res.status).toBe(200);
  });

  it("is also what /auth/login returns, so the first save after signing in works", async () => {
    const user = await createUser({ username: uniq("u") });
    const session = await login(app, user.username, TEST_PASSWORD);

    const res = await request(server())
      .patch("/v1/me/profile")
      .set("Cookie", session.cookies)
      .set("Origin", WEB_ORIGIN)
      // `session.csrfToken` is read from the login *body* by the fixture.
      .set("X-CSRF-Token", session.csrfToken)
      .send({ bio: "Нэвтэрсэн даруйдаа" });

    expect(res.status).toBe(200);
  });
});

describe("a mutation without the session's token", () => {
  /**
   * ★ This is precisely what the old web client produced.
   *
   * It looked for `kinder_csrf` in `document.cookie`, found nothing on the web
   * origin, and sent the request with no header — cookies attached, because the
   * browser attaches those regardless.
   */
  it("is rejected with 403 when the header is missing", async () => {
    const { session } = await signInLikeABrowser();

    const res = await request(server())
      .patch("/v1/me/profile")
      .set("Cookie", session.cookies)
      .set("Origin", WEB_ORIGIN)
      .send({ bio: "Токенгүй" });

    expect(res.status).toBe(403);
  });

  it("is rejected with 403 when the header does not match the cookie", async () => {
    const { session } = await signInLikeABrowser();

    const res = await request(server())
      .patch("/v1/me/profile")
      .set("Cookie", session.cookies)
      .set("Origin", WEB_ORIGIN)
      .set("X-CSRF-Token", "a-token-from-somewhere-else")
      .send({ bio: "Буруу токен" });

    expect(res.status).toBe(403);
  });
});

describe("the origin check, independent of the token", () => {
  it("rejects a correct token sent from an origin that is not allowed", async () => {
    const { session, sessionToken } = await signInLikeABrowser();

    const res = await request(server())
      .patch("/v1/me/profile")
      .set("Cookie", session.cookies)
      .set("Origin", "https://nomadkids.mn.evil.example")
      .set("X-CSRF-Token", sessionToken)
      .send({ bio: "Өөр эх сурвалжаас" });

    expect(res.status).toBe(403);
  });

  it("still requires a token from an allowed origin", async () => {
    const { session } = await signInLikeABrowser();

    const res = await request(server())
      .patch("/v1/me/profile")
      .set("Cookie", session.cookies)
      .set("Origin", WEB_ORIGIN)
      .send({ bio: "Зөв эх сурвалж, токенгүй" });

    expect(res.status).toBe(403);
  });
});
