import { describe, expect, it } from "vitest";
import { PasswordService, PRODUCTION_COST, validatePasswordStrength } from "./password.service";

/**
 * ★ Constructed with the PRODUCTION parameters explicitly.
 *
 * The integration suite runs argon2 at a reduced cost so that hundreds of
 * logins do not take minutes. This file is where the real hardening is
 * verified, so lowering the cost elsewhere cannot silently weaken it.
 */
const service = PasswordService.withCost(PRODUCTION_COST);

describe("PasswordService", () => {
  it("hashes with argon2id and verifies the result", async () => {
    const hash = await service.hash("CorrectHorse1");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await service.verify(hash, "CorrectHorse1")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await service.hash("CorrectHorse1");
    expect(await service.verify(hash, "WrongHorse1")).toBe(false);
  });

  it("returns false rather than throwing on a corrupted hash", async () => {
    // A corrupted row should be a failed login, not a 500 that tells an
    // attacker something interesting about the database.
    expect(await service.verify("not-a-hash", "anything")).toBe(false);
  });

  it("produces different hashes for the same password", async () => {
    // Distinct salts. Equal hashes would mean two users with the same password
    // are identifiable from the database alone.
    const a = await service.hash("SamePassword1");
    const b = await service.hash("SamePassword1");
    expect(a).not.toBe(b);
  });

  describe("burn", () => {
    it("costs real time, comparable to a genuine verification", async () => {
      // ★ This is the test that matters. `burn()` exists so that "no such user"
      // and "wrong password" take the same time; if it ever returns instantly,
      // the user-enumeration oracle is back and nothing else would notice.
      //
      // The first call generates the dummy hash, so measure the second.
      await service.burn();

      const start = performance.now();
      await service.burn();
      const elapsed = performance.now() - start;

      // A genuine argon2id verification at these parameters is ~110 ms. The
      // bound is deliberately loose — the point is "did real work", not a
      // precise figure that would make this flaky on slower CI hardware.
      expect(elapsed).toBeGreaterThan(20);
    });

    it("does not throw", async () => {
      await expect(service.burn()).resolves.toBeUndefined();
    });
  });
});

describe("validatePasswordStrength", () => {
  it("accepts a compliant password", () => {
    expect(validatePasswordStrength("GoodPass1")).toEqual([]);
  });

  it("rejects one that is too short", () => {
    expect(validatePasswordStrength("Ab1")).toContain("Нууц үг дор хаяж 8 тэмдэгт байх ёстой");
  });

  it("requires an upper case letter, a lower case letter and a digit", () => {
    expect(validatePasswordStrength("alllowercase1")).toHaveLength(1);
    expect(validatePasswordStrength("ALLUPPERCASE1")).toHaveLength(1);
    expect(validatePasswordStrength("NoDigitsHere")).toHaveLength(1);
  });

  it("accepts Cyrillic upper and lower case", () => {
    // Mongolian users type Mongolian passwords. Latin-only checks would reject
    // a perfectly strong one.
    expect(validatePasswordStrength("Нууцүг123")).toEqual([]);
  });

  it("reports every failure at once", () => {
    expect(validatePasswordStrength("abc")).toHaveLength(3);
  });
});
