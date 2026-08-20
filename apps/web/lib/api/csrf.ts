"use client";

/**
 * The CSRF token, held in memory for the life of the page.
 *
 * ★ It is **not** read from `document.cookie`, and that is the whole point.
 *
 * The API issues `kinder_csrf` as a host-only cookie on its own origin
 * (`api.nomadkids.mn`), which is correct — docs/SECURITY.md §3.1. But
 * `document.cookie` scopes by *domain*, not by site: a page on
 * `nomadkids.mn` cannot read a cookie belonging to `api.nomadkids.mn`, even
 * though the two are same-site and the browser happily attaches that cookie to
 * every request it sends there. Reading it here returned `undefined`, no header
 * went out, and `CsrfGuard` answered 403 to every save.
 *
 * The token was already being handed to us in the response body of `/auth/login`,
 * `/auth/refresh` and `/auth/me` (`sessionSchema.csrfToken`). This module is the
 * bridge between that value and `mutate()`, which is a plain function and cannot
 * read React state.
 *
 * ★ The session query remains the single source of truth. Nothing here is
 * authoritative — `SessionProvider` mirrors `data.csrfToken` into this module on
 * every change, and the two places that clear the query cache (`useLogout`,
 * `providers.tsx` on session expiry) drop it explicitly, because
 * `queryClient.clear()` does not reset an active observer and the mirror would
 * not fire.
 *
 * Holding it in memory rather than in `localStorage` is deliberate. The token is
 * not a secret — the protection is that a third-party site cannot read it — and
 * a stored copy would outlive the session it belongs to.
 */

let token: string | null = null;

/**
 * Server-side no-op. Module scope is shared across requests on the server, so a
 * write there would hand one user's token to the next render.
 */
export function rememberCsrfToken(next: string | null | undefined): void {
  if (typeof window === "undefined") return;
  token = next ?? null;
}

export function currentCsrfToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return token ?? undefined;
}
