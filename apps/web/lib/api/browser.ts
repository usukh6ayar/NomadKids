"use client";

import { apiFetch, type RequestOptions } from "./client";

/**
 * The browser-side wrapper.
 *
 * ★ It reads the CSRF token from the cookie itself.
 *
 * `apiFetch` takes `csrfToken` as an option, which means every unsafe call site
 * has to remember to pass it — and forgetting produces a 403 that looks like a
 * permissions bug. The token is not a secret (the cookie is deliberately not
 * HttpOnly, docs/SECURITY.md §3.2); the protection comes from a third-party
 * site being unable to *read* it. So reading it here is safe and removes the
 * whole class of mistake.
 *
 * Server components keep using `apiFetch` directly with an explicit cookie
 * header, because there is no `document` there.
 */

const CSRF_COOKIE = "kinder_csrf";

export function readCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;

  const match = document.cookie.split("; ").find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return match?.slice(CSRF_COOKIE.length + 1) || undefined;
}

/** A GET. */
export async function get<T>(
  path: string,
  schema: { parse: (data: unknown) => T },
  signal?: AbortSignal,
): Promise<T> {
  return apiFetch(path, schema, signal ? { signal } : {});
}

/** Any unsafe method, with the CSRF header attached automatically. */
export async function mutate<T>(
  path: string,
  schema: { parse: (data: unknown) => T },
  options: Omit<RequestOptions, "csrfToken" | "cookie"> = {},
): Promise<T> {
  return apiFetch(path, schema, { ...options, csrfToken: readCsrfToken() });
}
