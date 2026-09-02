import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { BRAND } from "@/lib/vocabulary";
import "./globals.css";

const DESCRIPTION = "Цэцэрлэгийн хүүхдийн хөгжлийн цахим бүртгэл.";

const FALLBACK_ORIGIN = "http://localhost:3000";

/**
 * The site's own origin, or the localhost default if the setting is missing or
 * unparseable.
 *
 * ★ The `try` is not decoration. `new URL()` throws on a malformed value, this
 * runs while the root layout's metadata is being built, and a throw there is
 * every page in the product returning 500 — not a missing preview image.
 *
 * That is not hypothetical. The deployment's `API_DOMAIN` had become
 * `api.nomadkids.mn, api-vps.nomadkids.mn` during the cutover, because Caddy
 * takes a comma-separated list of site addresses, and compose was interpolating
 * that same variable into a URL. The settings are separated now
 * (`.env.production.example`), but the same shape of mistake is one careless
 * edit away and the cost of surviving it is four lines.
 *
 * `middleware.ts` guards `NEXT_PUBLIC_MEDIA_URL` the same way and for the same
 * stated reason: a typo in an environment variable should cost a missing photo,
 * not the whole site.
 */
function siteOrigin(): URL {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_ORIGIN);
  } catch {
    return new URL(FALLBACK_ORIGIN);
  }
}

/**
 * ★ `metadataBase` is the setting that decides whether a shared link previews.
 *
 * `app/opengraph-image.png` is a *relative* asset, and Next has to turn it into
 * an absolute URL before a chat app or a search engine can fetch it. With no
 * base it falls back to `http://localhost:3000` and says so in a build warning
 * — which is to say the deploy is green, the page is correct, and every link
 * anyone pastes into Messenger renders a broken image.
 *
 * The value is inlined at build time (`NEXT_PUBLIC_`), so it is a Docker build
 * argument, not an environment variable on the running container —
 * `apps/web/Dockerfile` and `docker-compose.prod.yml`. The localhost default is
 * for `next dev` only.
 *
 * The icons themselves are **not** declared here. `app/favicon.ico`,
 * `app/icon.png` and `app/apple-icon.png` are file conventions: Next reads
 * their real dimensions and emits the `<link>` tags with correct `sizes`.
 * Listing them in `metadata.icons` as well would emit each tag twice.
 */
export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  title: BRAND,
  description: DESCRIPTION,
  applicationName: BRAND,
  openGraph: {
    type: "website",
    locale: "mn_MN",
    siteName: BRAND,
    title: BRAND,
    description: DESCRIPTION,
  },
  // No `twitter.images`: with `summary_large_image` and no image of its own,
  // the card falls back to the OpenGraph one, which is the same picture.
  twitter: { card: "summary_large_image", title: BRAND, description: DESCRIPTION },
  // The iOS home-screen name. Without it Safari uses the <title>, which is the
  // full brand and is truncated to about eleven characters under the icon.
  appleWebApp: { capable: true, title: BRAND, statusBarStyle: "default" },
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
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="mn">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
