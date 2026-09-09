const FALLBACK_ORIGIN = "http://localhost:3000";

/**
 * The site's own origin, or the localhost default if the setting is missing or
 * unparseable.
 *
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
 * ★★ Extracted from `app/layout.tsx` on 2026-09-09, when `robots.ts` and
 * `sitemap.ts` arrived and needed the same answer. Three copies of "where does
 * this site live" is three places for a deployment to be half-configured: a
 * sitemap listing `localhost` URLs is worse than no sitemap, because Google
 * fetches it, believes it, and finds nothing.
 *
 * It never throws. It runs while the root layout's metadata is being built,
 * and a throw there takes the whole page down over a malformed variable.
 */
export function siteOrigin(): URL {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_ORIGIN);
  } catch {
    return new URL(FALLBACK_ORIGIN);
  }
}
