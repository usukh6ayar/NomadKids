"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useSession } from "@/lib/auth/session";
import { PublicLanding } from "@/components/public/landing";

/**
 * The root — the public landing page, and a redirect for anyone signed in.
 *
 * ★ It used to render a spinner and nothing else, and Google said so:
 * `https://nomadkids.mn/` came back **"Crawled – currently not indexed"** on
 * 2026-09-10. The fetch succeeded, the metadata was correct, and the crawler
 * declined anyway — because the page it was offered had one line of text on it.
 * Metadata does not substitute for content. `/login` had the whole marketing
 * page all along, one route away, so the root now renders the same component.
 *
 * ★★ The redirect is unchanged in every respect that matters. A signed-in
 * teacher opening `nomadkids.mn` still lands on their dashboard; the rule is
 * still "most capable role first", still matching the API's `primaryDashboard`,
 * so an admin who is also a parent starts on the admin screen.
 *
 * ★★★ What a signed-in visitor sees for the moment before the redirect is the
 * landing page rather than a spinner, and that is the right trade. The
 * redirect fires as soon as `/auth/me` answers — the same instant it did
 * before — and a crawler, which never has a session, gets the whole page and
 * never a flash of anything. Rendering the spinner for everybody in order to
 * spare the signed-in the flash is what put the root outside the index.
 */
export default function RootPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-white" />}>
      <RootRedirect />
      <PublicLanding />
    </Suspense>
  );
}

/**
 * Sends a signed-in visitor to their own screen. Renders nothing.
 *
 * Split out so the landing is not remounted when the session resolves: the
 * effect lives in its own component, and `PublicLanding` beside it is
 * untouched by the state change.
 */
function RootRedirect() {
  const { session, isLoading, hasRole, isSuperAdmin } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || !session) return;

    // Checked first, and not folded into the role chain below: the platform
    // operator holds no kindergarten membership at all (CLAUDE.md §1.1), so
    // `hasRole` is false for all three and this would otherwise fall through
    // to "no membership" — the same screen a revoked user gets.
    if (isSuperAdmin) router.replace("/platform");
    else if (hasRole("ADMIN")) router.replace("/admin");
    else if (hasRole("TEACHER")) router.replace("/dashboard");
    /*
     * ★ COOK and ACCOUNTANT, added 2026-09-09 — they were missing.
     *
     * The docblock above says this rule matches the API's `primaryDashboard`,
     * and it did not: that method has returned "cook" and "accountant" since
     * 2026-08-30, so `/login` sent them to their own screens while opening the
     * app at the root fell past every branch to `/no-access` — a revoked
     * account's screen, shown to someone who was just hired. Found while
     * pointing the accountant at their new board.
     *
     * Same order and the same reasoning as the API's: below TEACHER, because
     * someone who both teaches and cooks should land on the teaching screen;
     * above PARENT, because landing an employee on their own child's page
     * instead of their work is the wrong default at 8am.
     */
    else if (hasRole("COOK")) router.replace("/kitchen/dashboard");
    else if (hasRole("ACCOUNTANT")) router.replace("/finance/dashboard");
    else if (hasRole("PARENT")) router.replace("/home");
    // Signed in with no membership — a real state after a revocation, and one
    // that must not redirect in a loop.
    else router.replace("/no-access");
  }, [isLoading, session, hasRole, isSuperAdmin, router]);

  return null;
}
