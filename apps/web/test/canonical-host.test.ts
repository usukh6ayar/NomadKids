import { describe, expect, it } from "vitest";
import { hostPolicy } from "@/lib/canonical-host";

/**
 * The Vercel copy of the site must not compete with `nomadkids.mn` in search.
 * `lib/canonical-host.ts` has the Search Console evidence.
 */
describe("hostPolicy", () => {
  const url = new URL("https://nomadkids.vercel.app/faq?utm_source=x");

  it("leaves the VPS and local development alone", () => {
    expect(hostPolicy(url, {})).toEqual({ kind: "serve" });
  });

  it("redirects the Vercel production deployment to the same path on nomadkids.mn", () => {
    expect(hostPolicy(url, { VERCEL: "1", VERCEL_ENV: "production" })).toEqual({
      kind: "redirect",
      location: "https://nomadkids.mn/faq?utm_source=x",
    });
  });

  it("keeps preview deployments usable but out of the index", () => {
    expect(hostPolicy(url, { VERCEL: "1", VERCEL_ENV: "preview" })).toEqual({ kind: "noindex" });
  });
});
