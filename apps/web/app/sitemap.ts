import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site-origin";

/**
 * `/sitemap.xml` — 2026-09-09, alongside `robots.ts`.
 *
 * ★ Four URLs, and that is the honest number. Everything else in this product
 * is behind a session: a sitemap listing `/dashboard` would be a list of
 * redirects to `/login`, which is how a site teaches a crawler that its
 * sitemap cannot be trusted.
 *
 * ★★ `/` is included even though it renders a redirect stub for a signed-in
 * visitor. It is the canonical URL and the one inbound links point at; leaving
 * it out would tell Google the front door is not part of the site.
 *
 * ★★★ No `lastModified`. A date that is always "now" is worse than none — it
 * claims every page changed on every deploy, and a crawler that checks twice
 * and finds identical bytes learns to discount the field. These four pages
 * change when someone edits them, which nothing here can observe.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin().toString().replace(/\/$/, "");

  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    // The one page a person who searched for the product actually wants: it
    // names the system, says who it is for, and is where an invited parent
    // lands.
    { url: `${origin}/login`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/faq`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
