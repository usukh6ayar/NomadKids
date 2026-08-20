import type { CookieOptions, Response } from "express";
import { loadEnv, type Env } from "../config/env";
import { parseDuration } from "./token.service";

/**
 * Cookie names and attributes.
 *
 * The web app is https://nomadkids.mn and the API is https://api.nomadkids.mn —
 * one registrable domain, therefore same-site, therefore `SameSite=Lax` works
 * and the browser's own CSRF protection stays in force.
 *
 * ★ No `Domain` attribute. The cookie is issued by api.nomadkids.mn and only
 * needs to return there; a host-only cookie already does that. Setting
 * `Domain=.nomadkids.mn` would broadcast the session to every present and
 * future subdomain for no benefit. docs/SECURITY.md §3.1.
 */
export const ACCESS_COOKIE = "kinder_access";
export const REFRESH_COOKIE = "kinder_refresh";
export const CSRF_COOKIE = "kinder_csrf";

/** Only this path receives the refresh cookie, so it is absent from every other request. */
export const REFRESH_COOKIE_PATH = "/v1/auth/refresh";

export function accessCookieOptions(env: Env = loadEnv()): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: parseDuration(env.ACCESS_TOKEN_TTL),
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function refreshCookieOptions(env: Env = loadEnv()): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: parseDuration(env.REFRESH_TOKEN_TTL),
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

/**
 * The CSRF cookie is the one that is NOT HttpOnly.
 *
 * ★ The frontend does **not** read it, and cannot. This cookie is host-only on
 * the API's host, and `document.cookie` scopes by domain rather than by site —
 * so a page on `nomadkids.mn` never sees a cookie belonging to
 * `api.nomadkids.mn`, same-site or not. The web client takes the value from the
 * session response instead (`/auth/login`, `/auth/me`); reading it here is what
 * used to 403 every write in a split-origin deployment.
 *
 * The flag stays off because it is the honest description of a double-submit
 * token — the value is not a secret, it only has to be unguessable by a
 * third-party site — and because a future same-host client may legitimately
 * read it. The protection is that the attacker cannot read the value, not that
 * the browser hides it.
 */
export function csrfCookieOptions(env: Env = loadEnv()): CookieOptions {
  return {
    httpOnly: false,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: parseDuration(env.REFRESH_TOKEN_TTL),
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string },
  env: Env = loadEnv(),
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, accessCookieOptions(env));
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions(env));
  res.cookie(CSRF_COOKIE, tokens.csrfToken, csrfCookieOptions(env));
}

/**
 * Clears all three. The options must match those used to set them — a cookie
 * cleared with a different path or domain is not cleared at all, and the user
 * stays half-logged-in in a way that is confusing to debug.
 */
export function clearAuthCookies(res: Response, env: Env = loadEnv()): void {
  const base = { ...accessCookieOptions(env), maxAge: undefined };
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(env), maxAge: undefined });
  res.clearCookie(CSRF_COOKIE, { ...csrfCookieOptions(env), maxAge: undefined });
}
