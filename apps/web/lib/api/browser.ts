"use client";

import { apiFetch, type RequestOptions } from "./client";
import { currentCsrfToken } from "./csrf";

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
 * Server components keep using `apiFetch` directly with an explicit cookie
 * header, because there is no session context there.
 */

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
  return apiFetch(path, schema, { ...options, csrfToken: currentCsrfToken() });
}
