import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const valid = {
  NODE_ENV: "development",
  CORS_ORIGINS: "http://localhost:3000",
  DATABASE_URL: "postgresql://kinder:kinder@localhost:5432/kinder",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "a".repeat(48),
  REFRESH_SECRET: "b".repeat(48),
  STORAGE_ENDPOINT: "http://localhost:9000",
  STORAGE_BUCKET: "kinder-media",
  STORAGE_ACCESS_KEY_ID: "minioadmin",
  STORAGE_SECRET_ACCESS_KEY: "minioadmin",
} as unknown as NodeJS.ProcessEnv;

describe("loadEnv", () => {
  it("accepts a complete development environment and applies defaults", () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3001);
    expect(env.STORAGE_PRESIGN_TTL).toBe(300);
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3000"]);
  });

  it("splits CORS_ORIGINS on commas and trims", () => {
    const env = loadEnv({ ...valid, CORS_ORIGINS: "http://a.test, http://b.test" });
    expect(env.CORS_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });

  it("reports every problem at once, not just the first", () => {
    const broken = { ...valid, DATABASE_URL: "mysql://x", JWT_SECRET: "short" };
    try {
      loadEnv(broken as NodeJS.ProcessEnv);
      expect.unreachable("should have thrown");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("JWT_SECRET");
    }
  });

  it("rejects a missing required value", () => {
    const { DATABASE_URL: _omitted, ...rest } = valid as Record<string, string>;
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  describe("ESIS", () => {
    it("defaults to unconfigured, which is a legitimate deployment", () => {
      const env = loadEnv(valid);
      expect(env.ESIS_BASE_URL).toBe("");
      expect(env.ESIS_TOKEN).toBe("");
      expect(env.ESIS_INSTITUTION_ID).toBe("");
      expect(env.ESIS_TIMEOUT_MS).toBe(15_000);
    });

    it("accepts a complete set", () => {
      const env = loadEnv({
        ...valid,
        ESIS_BASE_URL: "https://esis.example.test",
        ESIS_TOKEN: "t".repeat(20),
        ESIS_INSTITUTION_ID: "INST-1",
      } as NodeJS.ProcessEnv);

      expect(env.ESIS_BASE_URL).toBe("https://esis.example.test");
    });

    it("refuses a timeout outside the sane range", () => {
      expect(() =>
        loadEnv({ ...valid, ESIS_TIMEOUT_MS: "50" } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/ESIS_TIMEOUT_MS/);
    });
  });

  describe("production invariants", () => {
    const prod = {
      ...valid,
      NODE_ENV: "production",
      CORS_ORIGINS: "https://nomadkids.mn",
      COOKIE_DOMAIN: "",
      // Defaults to http://localhost:3000, which production refuses — the same
      // guard that caught a real misconfiguration in the Phase 13 container run.
      WEB_ORIGIN: "https://nomadkids.mn",
    } as unknown as NodeJS.ProcessEnv;

    it("accepts the real production environment", () => {
      expect(() => loadEnv(prod)).not.toThrow();
    });

    it("refuses a half-configured ESIS, naming only what is missing", () => {
      try {
        loadEnv({
          ...prod,
          ESIS_BASE_URL: "https://esis.example.test",
          ESIS_TOKEN: "super-secret-value",
        } as NodeJS.ProcessEnv);
        expect.unreachable("should have thrown");
      } catch (e) {
        const message = (e as Error).message;
        expect(message).toContain("ESIS_INSTITUTION_ID");
        // ★ The message names the absent settings, never the value of a
        // present one — the token is among them.
        expect(message).not.toContain("super-secret-value");
      }
    });

    it("refuses a plaintext ESIS base URL, because the token crosses it", () => {
      expect(() =>
        loadEnv({
          ...prod,
          ESIS_BASE_URL: "http://esis.example.test",
          ESIS_TOKEN: "t".repeat(20),
          ESIS_INSTITUTION_ID: "INST-1",
        } as NodeJS.ProcessEnv),
      ).toThrow(/ESIS_BASE_URL/);
    });

    it("accepts production with ESIS fully configured over https", () => {
      expect(() =>
        loadEnv({
          ...prod,
          ESIS_BASE_URL: "https://esis.example.test",
          ESIS_TOKEN: "t".repeat(20),
          ESIS_INSTITUTION_ID: "INST-1",
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it("refuses a plaintext WEB_ORIGIN in production", () => {
      expect(() => loadEnv({ ...prod, WEB_ORIGIN: "http://nomadkids.mn" })).toThrow(/WEB_ORIGIN/);
    });

    /**
     * ★ Half-configured SMTP is worse than none: it looks configured, and the
     * failure surfaces only when a parent cannot get a reset link.
     */
    it("refuses SMTP_HOST without MAIL_FROM", () => {
      expect(() => loadEnv({ ...prod, SMTP_HOST: "smtp.example.com" })).toThrow(/MAIL_FROM/);
    });

    it("refuses MAIL_FROM without SMTP_HOST", () => {
      expect(() => loadEnv({ ...prod, MAIL_FROM: "noreply@nomadkids.mn" })).toThrow(/SMTP_HOST/);
    });

    it("accepts a fully configured SMTP block", () => {
      expect(() =>
        loadEnv({ ...prod, SMTP_HOST: "smtp.example.com", MAIL_FROM: "noreply@nomadkids.mn" }),
      ).not.toThrow();
    });

    /** Mail is optional as a set — an unconfigured deployment still boots. */
    it("accepts no SMTP configuration at all", () => {
      expect(() => loadEnv(prod)).not.toThrow();
    });

    it("refuses a localhost origin in production", () => {
      expect(() =>
        loadEnv({ ...prod, CORS_ORIGINS: "https://nomadkids.mn,http://localhost:3000" }),
      ).toThrow(/localhost/);
    });

    it("refuses a plaintext origin in production", () => {
      expect(() => loadEnv({ ...prod, CORS_ORIGINS: "http://nomadkids.mn" })).toThrow(/http:\/\//);
    });

    it("accepts an empty COOKIE_DOMAIN — host-only is the intended default", () => {
      // nomadkids.mn and api.nomadkids.mn share a registrable domain, so the
      // cookie is already sent on credentialed requests without a Domain
      // attribute. Setting one would only widen it to every subdomain.
      expect(() => loadEnv({ ...prod, COOKIE_DOMAIN: "" })).not.toThrow();
    });

    it("refuses a COOKIE_DOMAIN without a leading dot", () => {
      // "nomadkids.mn" without the dot does not do what the author intends;
      // failing loudly beats a cookie that silently is not shared.
      expect(() => loadEnv({ ...prod, COOKIE_DOMAIN: "nomadkids.mn" })).toThrow(/COOKIE_DOMAIN/);
    });

    it("accepts an explicit dotted COOKIE_DOMAIN when a deployment needs one", () => {
      expect(() => loadEnv({ ...prod, COOKIE_DOMAIN: ".nomadkids.mn" })).not.toThrow();
    });

    it("refuses identical signing secrets in production", () => {
      const same = "c".repeat(48);
      expect(() => loadEnv({ ...prod, JWT_SECRET: same, REFRESH_SECRET: same })).toThrow(
        /identical/,
      );
    });
  });
});
