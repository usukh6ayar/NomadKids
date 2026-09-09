import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Providers } from "./providers";
import { BRAND, BRAND_LATIN } from "@/lib/vocabulary";
import { siteOrigin } from "@/lib/site-origin";
import "./globals.css";

/*
 * ★ Both names, deliberately — 2026-09-09.
 *
 * The description is what Google prints under the link, and it is also text
 * the query is matched against. "NomadKids" was absent from every string on
 * the site, so a search for it had nothing but the domain to go on.
 */
const DESCRIPTION =
  "NomadKids (Бяцхан нүүдэлчид) — цэцэрлэгийн хүүхдийн хөгжлийн цахим бүртгэл. " +
  "Багш, эцэг эх, удирдлагад зориулсан ажиглалт, явцын үнэлгээ, ирц, цэс, тайлан.";

/**
 * ★ The icons are **not** declared in `metadata.icons`. `app/favicon.ico`,
 * `app/icon.png` and `app/apple-icon.png` are file conventions: Next reads
 * their real dimensions and emits the `<link>` tags with correct `sizes`.
 * Listing them here as well would emit each tag twice.
 */
export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  /*
   * ★ A template, so every page carries both names.
   *
   * `default` is what the root and any page without its own title gets;
   * `template` wraps the ones that set one (`/faq`, `/privacy`, `/terms` do).
   * Cyrillic first because that is what the product is called to the people
   * using it — the Latin name is the one being searched for, not the one on
   * the wall.
   */
  title: { default: `${BRAND} — ${BRAND_LATIN}`, template: `%s | ${BRAND} · ${BRAND_LATIN}` },
  description: DESCRIPTION,
  applicationName: BRAND,
  /*
   * ★★ Canonical. Without it `https://nomadkids.mn/` and any variant a link
   * arrives as — a trailing `?fbclid=…`, `www.`, a trailing slash — are
   * separate URLs to a crawler, splitting whatever ranking the domain earns
   * across several of them.
   */
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "mn_MN",
    siteName: `${BRAND} · ${BRAND_LATIN}`,
    title: `${BRAND} — ${BRAND_LATIN}`,
    description: DESCRIPTION,
  },
  // No `twitter.images`: with `summary_large_image` and no image of its own,
  // the card falls back to the OpenGraph one, which is the same picture.
  twitter: {
    card: "summary_large_image",
    title: `${BRAND} — ${BRAND_LATIN}`,
    description: DESCRIPTION,
  },
  // The iOS home-screen name. Without it Safari uses the <title>, which is the
  // full brand and is truncated to about eleven characters under the icon.
  appleWebApp: { capable: true, title: BRAND, statusBarStyle: "default" },
  /*
   * Google Search Console ownership — 2026-09-10.
   *
   * ★ Not a secret, and not `.env`. The token's entire job is to be readable
   * in the page source by anyone who fetches it; that is how the check works.
   * §1.5 is about credentials, and treating a public proof-of-ownership string
   * as one would mean a `NEXT_PUBLIC_` build argument on every deploy for a
   * value that is fixed to one domain and useless anywhere else.
   *
   * ★★ It stays after verification passes. Search Console re-checks
   * periodically and silently un-verifies a property whose tag has gone,
   * taking the sitemap and the indexing reports with it — the kind of thing
   * nobody notices for months.
   */
  verification: { google: "NrBNrgk-ae3z563Dnae6EUTsXtU8iWTBIQF-9JE-9cI" },
};

/**
 * ★ Every page is rendered per request.
 *
 * The CSP in `middleware.ts` carries a per-request nonce, and a nonce only
 * reaches the HTML if that HTML is generated per request. A statically
 * pre-rendered page was built before any nonce existed, so Next's inline
 * bootstrap script ships without one — the browser then blocks it and
 * hydration dies with React error #412: the page paints, and nothing responds
 * to a click.
 *
 * That is exactly what the first deployed build did. Setting it here rather
 * than page by page means a new route cannot quietly reintroduce it.
 *
 * The cost is nil in practice: every screen but login and password-reset is
 * authenticated and personalised, so none of them were cacheable anyway.
 */
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Tints the browser chrome on Android and the notch area on iOS. Same
  // `--color-primary` the manifest carries, so an installed app and a tab in
  // Chrome do not disagree about what colour this product is.
  themeColor: "#1d4ed8",
};

/**
 * Root layout. The three audience shells — (teacher), (parent), (admin) — are
 * route groups nested under this and arrive with their features.
 * docs/UI_UX_MAP.md §2.
 *
 * `lang="mn"`: all user-facing text is Mongolian, and screen readers need to
 * know which language to pronounce.
 */
/**
 * Structured data — 2026-09-09.
 *
 * ★ `alternateName` is the whole point. It is the field that tells a search
 * engine "this organisation is also called NomadKids", which is what a person
 * typing the Latin name is asking for. Everything visible on the site is
 * Cyrillic, so without this the two names are unrelated strings.
 *
 * ★★ Kept to what is true. No `aggregateRating`, no invented `foundingDate`,
 * no address this repository does not know — structured data that overstates
 * is the kind Google penalises, and a schema is not a place to be optimistic.
 */
function organisationJsonLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND,
    alternateName: BRAND_LATIN,
    url: origin,
    logo: `${origin}/icon.png`,
    description: DESCRIPTION,
    areaServed: "MN",
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const origin = siteOrigin().toString().replace(/\/$/, "");
  /*
   * ★ The nonce, or the tag is dropped on the floor.
   *
   * `middleware.ts` sets `script-src 'self' 'nonce-…' 'strict-dynamic'`, and
   * although a browser does not *execute* `application/ld+json`, the policy is
   * enforced against the element rather than against what it contains. Without
   * the nonce this renders, is refused, and shows up nowhere except a console
   * warning nobody reads — the failure being fixed here, in a different form.
   */
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="mn">
      <body>
        <script
          type="application/ld+json"
          nonce={nonce}
          // The payload is ours and contains no user input — the two strings
          // are compile-time constants and the origin is a parsed `URL`.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organisationJsonLd(origin)) }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
