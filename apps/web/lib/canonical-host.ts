/**
 * Keeping the Vercel copy of the site out of Google — 2026-10-08.
 *
 * ★ The web app is built from `main` in two places: the VPS behind
 * `https://nomadkids.mn` (the product), and the Vercel project from before the
 * DNS move (`https://nomadkids.vercel.app`, `PRODUCTION_READINESS.md`). The
 * Vercel build has no `NEXT_PUBLIC_SITE_URL`, so every page there declares
 * `<link rel="canonical" href="http://localhost:3000/…">` — a canonical Google
 * cannot fetch and therefore ignores.
 *
 * Search Console showed the result on 2026-10-07: for `/faq` the user-declared
 * canonical was `https://nomadkids.mn/faq` and the **Google-selected** one was
 * `https://nomadkids.vercel.app/faq`. Two identical copies, one with a broken
 * canonical, and Google kept the wrong one — so the real page was reported as
 * "Duplicate, Google chose different canonical than user" and dropped.
 *
 * ★★ The production alias is redirected, not just `noindex`ed. A 308 is the
 * one signal that both removes the copy *and* hands what it earned to the real
 * URL. Preview deployments keep working — they are how a branch is looked at —
 * but carry `X-Robots-Tag: noindex` so a shared preview link cannot become the
 * next copy Google prefers.
 *
 * Pure so it can be tested without a Next runtime; `middleware.ts` applies it.
 */
export const CANONICAL_ORIGIN = "https://nomadkids.mn";

export type HostPolicy =
  { kind: "serve" } | { kind: "noindex" } | { kind: "redirect"; location: string };

export function hostPolicy(url: URL, env: { VERCEL?: string; VERCEL_ENV?: string }): HostPolicy {
  // Not on Vercel — the VPS, `next dev`, the test runner. Nothing to do.
  if (!env.VERCEL) return { kind: "serve" };

  if (env.VERCEL_ENV === "production") {
    return { kind: "redirect", location: `${CANONICAL_ORIGIN}${url.pathname}${url.search}` };
  }

  return { kind: "noindex" };
}
