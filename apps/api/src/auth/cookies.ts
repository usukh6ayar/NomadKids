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
 * The CSRF cookie is the one that is NOT HttpOnly — the frontend has to read it
 * to echo the value back in a header. That is the whole double-submit
 * mechanism; the value is not a secret, it only has to be unguessable by a
 * third-party site, which the same-origin policy guarantees.
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
