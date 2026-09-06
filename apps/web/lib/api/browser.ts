"use client";

import { ApiError, apiFetch, type RequestOptions } from "./client";
import { currentCsrfToken, rememberCsrfToken } from "./csrf";

/**
 * The browser-side wrapper.
 *
 * ★ It attaches the CSRF token for every unsafe call.
 *
 * `apiFetch` takes `csrfToken` as an option, which means every unsafe call site
 * has to remember to pass it — and forgetting produces a 403 that looks like a
 * permissions bug. Attaching it in one place removes the whole class of mistake.
 *
 * The token comes from the session response, held in `./csrf`. It used to be
 * read out of `document.cookie`, which cannot work once the API is on its own
 * host — see the note there.
 *
 * ★★ It also **renews an expired access token**, which is the other thing every
 * call site would otherwise have to think about. See `withRefresh` below.
 *
 * Server components keep using `apiFetch` directly with an explicit cookie
 * header, because there is no session context there — and because a server
 * render cannot set the new cookies a refresh returns.
 */

/** A GET. */
export async function get<T>(
  path: string,
  schema: { parse: (data: unknown) => T },
  signal?: AbortSignal,
): Promise<T> {
  return withRefresh(path, () => apiFetch(path, schema, signal ? { signal } : {}));
}

/** Any unsafe method, with the CSRF header attached automatically. */
export async function mutate<T>(
  path: string,
  schema: { parse: (data: unknown) => T },
  options: Omit<RequestOptions, "csrfToken" | "cookie"> = {},
): Promise<T> {
  return withRefresh(path, () =>
    // Read inside the closure, not outside: a retry after a refresh must use
    // the *new* token, and the refresh response is what supplies it.
    apiFetch(path, schema, { ...options, csrfToken: currentCsrfToken() }),
  );
}

/**
 * Runs a request; on 401, renews the session once and runs it again.
 *
 * ★ **Why this exists.** `ACCESS_TOKEN_TTL` is 15 minutes and
 * `REFRESH_TOKEN_TTL` is 30 days. Nothing in the browser ever called
 * `POST /auth/refresh`, so the long-lived credential was issued, stored and
 * never used: every session ended a quarter of an hour after it began, and the
 * app showed the login page again. Reported on 2026-09-06 as "автоматаар sign
 * out хийгээд байна", and visible in production as one teacher signing in three
 * times in half an hour.
 *
 * ★★ **One retry, never a loop.** If the refresh fails the original 401 is
 * thrown, and `/auth/*` paths are excluded outright — a refresh that itself
 * 401s must not trigger another refresh. `SessionProvider` then resolves the
 * session to `null` exactly as before, which is the real "you are signed out".
 *
 * ★★★ **Concurrent 401s share one refresh.** A dashboard fires a dozen queries
 * at once; without the shared promise, a token that expired between two of them
 * would produce a dozen refreshes, each rotating the token under the others —
 * and `AuthService.refresh` treats a reused token as theft. The single
 * in-flight promise is what keeps a normal page load from looking like an
 * attack.
 */
async function withRefresh<T>(path: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || isAuthPath(path)) throw error;

    const renewed = await refreshSession();
    if (!renewed) throw error;

    return run();
  }
}

/**
 * `/auth/login`, `/auth/refresh` and `/auth/logout` answer 401 as a *result*,
 * not as an expired token. Retrying them would be a loop at worst and a wasted
 * round trip at best.
 *
 * `/auth/me` is deliberately **not** here: a 401 there is precisely the case a
 * refresh fixes, and it is the request that runs on every page load.
 */
function isAuthPath(path: string): boolean {
  return (
    path.startsWith("/auth/login") ||
    path.startsWith("/auth/refresh") ||
    path.startsWith("/auth/logout")
  );
}

let inFlight: Promise<boolean> | null = null;

/**
 * Rotates the tokens. Resolves `true` when the session survived.
 *
 * Uses `fetch` directly rather than `apiFetch`: the response shape is the
 * session, this module needs only two fields from it, and going through the
 * schema-validating path would make a contract change able to break session
 * renewal — the one request that must keep working when something else is
 * wrong.
 */
async function refreshSession(): Promise<boolean> {
  inFlight ??= (async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/v1/auth/refresh`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
          credentials: "include",
          cache: "no-store",
        },
      );

      if (!response.ok) return false;

      const body = (await response.json().catch(() => null)) as {
        user?: unknown;
        csrfToken?: string;
      } | null;

      // The API rotates the CSRF token with the session; a retry that sent the
      // old one would 403 having just successfully re-authenticated.
      if (body?.csrfToken) rememberCsrfToken(body.csrfToken);

      // `{ user: null }` is the answer when there was no refresh cookie at all.
      return Boolean(body?.user);
    } catch {
      // Offline, or the API is unreachable. The caller rethrows the original
      // 401 and the session resolves to null, which is the honest outcome.
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
