import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { ApiError } from "@/lib/api/client";
import { currentCsrfToken, rememberCsrfToken } from "@/lib/api/csrf";

/**
 * Renewing an expired access token.
 *
 * ★ What this file protects is the reason people were being signed out every
 * fifteen minutes.
 *
 * `ACCESS_TOKEN_TTL` is 15 minutes; `REFRESH_TOKEN_TTL` is 30 days. Nothing in
 * the browser ever called `POST /auth/refresh`, so the long-lived credential
 * was issued, stored, sent on every request — and never used. A session ended
 * a quarter of an hour after it began. Reported on 2026-09-06 as "автоматаар
 * sign out хийгээд байна"; visible in production as one teacher signing in
 * three times inside half an hour.
 *
 * ★★ The tests below are about the *shape* of the retry rather than about any
 * one screen: one retry and never a loop, one refresh for a burst of parallel
 * 401s, and the new CSRF token carried into the retry. Each of those, done
 * wrong, produces a failure that looks like something else — an infinite
 * request loop, a "token theft" logout, or a 403 immediately after a
 * successful re-authentication.
 */

const schema = z.object({ ok: z.boolean() });

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A 401 in the shape the API actually sends. */
function unauthorized() {
  return json(401, {
    type: "about:blank",
    title: "Нэвтрэх шаардлагатай",
    status: 401,
    requestId: "test",
  });
}

/** A successful refresh, with the rotated CSRF token. */
function refreshed(csrfToken = "csrf-2") {
  return json(200, { user: { id: "u1" }, memberships: [], csrfToken });
}

/** Path after `/v1`, from a call recorded on the fetch mock. */
function pathOf(call: unknown[]): string {
  return String(call[0]).replace(/^.*\/v1/, "");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  rememberCsrfToken("csrf-1");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("сешн сэргээх", () => {
  it("renews the token on a 401 and runs the request again", async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(json(200, { ok: true }));

    await expect(get("/children", schema)).resolves.toEqual({ ok: true });

    const paths = fetchMock.mock.calls.map(pathOf);
    expect(paths).toEqual(["/children", "/auth/refresh", "/children"]);
  });

  /**
   * ★ The refresh is a POST with credentials — it is the refresh **cookie**
   * that authenticates it, and there is no access token left to send.
   */
  it("posts the refresh with credentials", async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(json(200, { ok: true }));

    await get("/children", schema);

    const init = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  /**
   * ★★ The rotated CSRF token must reach the retry.
   *
   * The API issues a new one with the new session. A retry that sent the old
   * token would be refused by `CsrfGuard` — a 403 landing immediately after a
   * successful re-authentication, which reads as a permissions bug and is not
   * one.
   */
  it("carries the rotated CSRF token into the retried request", async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(refreshed("csrf-2"))
      .mockResolvedValueOnce(json(200, { ok: true }));

    await mutate("/children", schema, { method: "POST", body: { a: 1 } });

    const retry = fetchMock.mock.calls[2]![1] as RequestInit;
    expect((retry.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-2");
    expect(currentCsrfToken()).toBe("csrf-2");
  });

  /**
   * ★ A failed refresh is a real sign-out.
   *
   * The original 401 is rethrown rather than the refresh's own error, because
   * that is what the caller asked about — and `SessionProvider` turns a 401 on
   * `/auth/me` into `null`, which is the state the login screen reacts to.
   */
  it("rethrows the original 401 when the refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized());

    await expect(get("/children", schema)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /** `{ user: null }` is the answer when the browser had no refresh cookie. */
  it("does not retry when the refresh reports no session", async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(json(200, { user: null }));

    await expect(get("/children", schema)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /**
   * ★★★ Never a loop.
   *
   * A 401 from `/auth/refresh` itself must not trigger another refresh. This
   * is the assertion that keeps a dead cookie from turning into an unbounded
   * request loop against the API.
   */
  it("does not refresh in response to a failing refresh", async () => {
    fetchMock.mockResolvedValue(unauthorized());

    await expect(mutate("/auth/refresh", schema, { method: "POST" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /** A wrong password is a result, not an expired token. */
  it("does not refresh on a failed login", async () => {
    fetchMock.mockResolvedValue(unauthorized());

    await expect(mutate("/auth/login", schema, { method: "POST" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * ★★★★ A burst of parallel 401s shares one refresh.
   *
   * A dashboard fires a dozen queries at once. Without the shared in-flight
   * promise each would refresh, every rotation invalidating the token the
   * others are about to present — and `AuthService.refresh` treats a reused
   * refresh token as theft and kills the session. So the failure mode of
   * getting this wrong is not "slow": it is a normal page load looking like an
   * attack and logging everybody out.
   */
  it("refreshes once for a burst of parallel 401s", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/v1/, "");
      if (path === "/auth/refresh") return Promise.resolve(refreshed());
      // Every data request 401s the first time and succeeds afterwards.
      return Promise.resolve(
        seen.has(path + (init?.method ?? "GET")) ? json(200, { ok: true }) : firstTime(path, init),
      );
    });

    const seen = new Set<string>();
    function firstTime(path: string, init?: RequestInit) {
      seen.add(path + (init?.method ?? "GET"));
      return unauthorized();
    }

    const results = await Promise.all([
      get("/a", schema),
      get("/b", schema),
      get("/c", schema),
      get("/d", schema),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);

    const refreshes = fetchMock.mock.calls.filter((c) => pathOf(c) === "/auth/refresh");
    expect(refreshes).toHaveLength(1);
  });

  /** One retry, not two: a 401 on the retry is the answer. */
  it("gives up after a single retry", async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(refreshed())
      .mockResolvedValueOnce(unauthorized());

    await expect(get("/children", schema)).rejects.toMatchObject({ status: 401 });

    const refreshes = fetchMock.mock.calls.filter((c) => pathOf(c) === "/auth/refresh");
    expect(refreshes).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  /** A 404 is not an expired token. */
  it("does not refresh on any other status", async () => {
    fetchMock.mockResolvedValue(
      json(404, { type: "about:blank", title: "Олдсонгүй", status: 404, requestId: "t" }),
    );

    await expect(get("/children", schema)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
