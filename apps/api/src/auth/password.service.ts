import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";

/**
 * Production hardening: ~110 ms per verification on modern hardware.
 *
 * Explicit rather than the library defaults, so the cost is a recorded decision
 * instead of whatever the installed version happens to ship with.
 */
export type Argon2Cost = argon2.HashOptions & { raw?: false };

const PRODUCTION_COST: Argon2Cost = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 1,
};

/**
 * Test cost. Same algorithm, minimum work.
 *
 * The integration suite logs several users in per test; at production cost that
 * is ~6 s of pure key derivation per test and a suite that nobody runs. Lowering
 * it here is safe because **the production parameters are themselves under
 * test** — `password.service.test.ts` constructs a service with them explicitly
 * and asserts `burn()` costs real time. What the integration tests exercise is
 * the login *flow*, not the KDF.
 */
const TEST_COST: Argon2Cost = {
  type: argon2.argon2id,
  memoryCost: 1024, // 1 MB
  timeCost: 1,
  parallelism: 1,
};

/**
 * Password hashing and policy.
 */
@Injectable()
export class PasswordService {
  /**
   * No constructor parameters, deliberately.
   *
   * Nest cannot distinguish an optional constructor argument from a provider it
   * should inject, and fails with "cannot resolve dependency at index [0]" —
   * an error that points at the DI container rather than at the real cause.
   * Tests that need explicit parameters use `withCost()` below.
   */
  private options: Argon2Cost = process.env.NODE_ENV === "test" ? TEST_COST : PRODUCTION_COST;

  /** Builds a service with explicit parameters. For tests only. */
  static withCost(options: Argon2Cost): PasswordService {
    const service = new PasswordService();
    service.options = options;
    return service;
  }

  async hash(plain: string): Promise<string> {
    // `raw: false` is explicit because argon2's overloads return a Buffer when
    // it is true, and the default is easy to lose in a later refactor.
    return argon2.hash(plain, { ...this.options, raw: false });
  }

  /**
   * Verifies a password. Returns false rather than throwing on a malformed
   * hash, so a corrupted row is a failed login rather than a 500 that tells an
   * attacker something interesting.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * A dummy verification, used when the username does not exist.
   *
   * Without it, a missing user returns in ~1 ms and a wrong password in ~110 ms,
   * and that difference is a reliable user-enumeration oracle. Burning the same
   * work on both paths removes it. docs/SECURITY.md §2.
   *
   * ★ The hash is generated at first use with the same parameters as a real
   * password, rather than being a literal pasted into the source. A literal
   * that argon2 later rejects — a version bump, a parameter change — would fall
   * into a `catch` and return in microseconds, silently removing the defence
   * while every test still passed. Generating it means it cannot go stale.
   */
  async burn(): Promise<void> {
    this.dummyHash ??= await this.hash(randomBytes(24).toString("hex"));
    await argon2.verify(this.dummyHash, "not-the-password");
  }

  /** Lazily generated on first use; ~110 ms once, then reused. */
  private dummyHash?: string;
}

/**
 * Password policy: 8+ characters with an upper case letter, a lower case letter
 * and a digit. Inherited from the reference system, which the client has
 * already accepted.
 *
 * Returns Mongolian messages because they are shown to the user directly.
 */
export { PRODUCTION_COST };

export function validatePasswordStrength(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 8) errors.push("Нууц үг дор хаяж 8 тэмдэгт байх ёстой");
  if (!/[A-ZА-ЯӨҮ]/.test(password)) errors.push("Нууц үгэнд том үсэг байх ёстой");
  if (!/[a-zа-яөү]/.test(password)) errors.push("Нууц үгэнд жижиг үсэг байх ёстой");
  if (!/\d/.test(password)) errors.push("Нууц үгэнд тоо байх ёстой");
  return errors;
}
