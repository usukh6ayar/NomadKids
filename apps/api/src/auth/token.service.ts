import { Injectable } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { loadEnv, type Env } from "../config/env";

/**
 * Access tokens (JWT) and opaque refresh tokens.
 *
 * ★ The access token carries ONLY `userId` and `sessionId`. No roles, no
 * kindergarten ids. Authority is re-read from Membership on every request, so
 * revoking a teacher's assignment takes effect on the next call rather than
 * whenever their token expires. CLAUDE.md §1.3.
 *
 * Refresh tokens are opaque random bytes, not JWTs, and only their SHA-256 is
 * stored. A leaked database gives an attacker hashes, not sessions.
 */
@Injectable()
export class TokenService {
  /**
   * Loaded lazily rather than injected. An optional constructor parameter is
   * indistinguishable from a provider to Nest's DI container, which then fails
   * to resolve it — and the error points at "index [0]" rather than at the
   * environment, which is a confusing half-hour.
   */
  private readonly env: Env = loadEnv();

  signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.env.JWT_SECRET, {
      expiresIn: this.env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
      algorithm: "HS256",
    });
  }

  /**
   * Verifies and decodes an access token. Returns null on anything wrong —
   * expired, tampered, wrong algorithm, malformed. The caller turns that into
   * a 401 without distinguishing the cases.
   */
  verifyAccessToken(token: string): AccessTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.env.JWT_SECRET, {
        algorithms: ["HS256"], // pinned: never trust the token's own `alg`
      });
      if (typeof decoded === "string") return null;
      const { sub, sid } = decoded as Record<string, unknown>;
      if (typeof sub !== "string" || typeof sid !== "string") return null;
      return { sub, sid };
    } catch {
      return null;
    }
  }

  /** A new opaque refresh token: 256 bits of randomness, plus its hash. */
  createRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: hashToken(token) };
  }

  refreshTokenExpiry(): Date {
    return new Date(Date.now() + parseDuration(this.env.REFRESH_TOKEN_TTL));
  }

  /** A single-use token for password reset or invitation, plus its hash. */
  createOneTimeToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: hashToken(token) };
  }
}

export interface AccessTokenPayload {
  /** userId */
  sub: string;
  /** sessionId */
  sid: string;
}

/**
 * SHA-256, not argon2, and deliberately so.
 *
 * These tokens are 256 bits of cryptographic randomness — there is no
 * dictionary to attack, so a slow hash buys nothing and would add real latency
 * to every refresh. Passwords are different and use argon2id.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison for token hashes. Overkill against a hex digest, but
 * comparison helpers get reused in places where it is not overkill.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Parses `15m`, `24h`, `30d` into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return amount * multipliers[unit];
}
