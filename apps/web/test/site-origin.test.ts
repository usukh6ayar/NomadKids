import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("siteOrigin", () => {
  it("never falls back to localhost in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.resetModules();

    const { siteOrigin } = await import("@/lib/site-origin");

    expect(siteOrigin().origin).toBe("https://nomadkids.mn");
  });
});
