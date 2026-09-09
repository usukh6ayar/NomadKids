import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site-origin";

/**
 * `/robots.txt`, which did not exist — 2026-09-09.
 *
 * ★ Its absence was not neutral. A missing `robots.txt` is a 404, and a 404
 * here means a crawler has no sitemap to find and no instruction about the
 * dozens of authenticated paths it will otherwise try, get redirected from,
 * and count against the site's crawl budget.
 *
 * ★★ The disallow list is a courtesy, not a defence. Every path below is
 * already behind `canAccessChild` and a session cookie — a crawler that
 * ignored this file would still get 401s and 404s, not children's records.
 * What it buys is that the budget is spent on the four pages that can actually
 * rank instead of on redirect chains, and that a stray private URL never
 * surfaces as a bare title in results.
 *
 * ★★★ `/` is deliberately **allowed** even though it renders a redirect stub.
 * It is the canonical URL, the one every inbound link points at, and the one
 * whose `<title>` and description are what a search for the brand shows.
 * Disallowing it would hide the site's own front door.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin().toString().replace(/\/$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Every authenticated shell. Listed by prefix rather than
          // exhaustively: the route tree grows, and a list that has to be kept
          // in step with it is one that quietly stops being in step.
          "/admin/",
          "/platform/",
          "/dashboard",
          "/home",
          "/children/",
          "/groups/",
          "/kitchen/",
          "/finance",
          "/assessment",
          "/menu",
          "/chat",
          "/settings",
          "/attendance/",
          "/no-access",
          // Token-bearing URLs. These are single-use and expire, but a crawled
          // one can end up in a cache or a referrer, and an invitation link is
          // a credential.
          "/invitation/",
          "/reset-password",
          // Next's internals and the API proxy — no content, and fetching them
          // is pure waste.
          "/_next/",
          "/api/",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
