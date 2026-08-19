"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import type { Role } from "@kinder/contracts";
import { useSession } from "@/lib/auth/session";
import { LoadingState } from "@/components/ui/states";

/**
 * Renders children only for a signed-in user holding one of these roles.
 *
 * ★★ This is **UX, not security.** It decides which navigation a person sees so
 * they are not shown menus that would only ever 404. It does not protect data:
 * every request is authorized independently by the API, which re-derives the
 * actor's memberships, guardianships and group assignments on each call.
 *
 * Someone who bypasses this — by editing the bundle, or by calling the API
 * directly — gains a different menu and exactly the same 404s. That property is
 * what makes it safe for this to be a client component at all.
 *
 * The redirect runs in an effect rather than during render because Next's
 * router cannot be called mid-render, and rendering `null` first would flash an
 * empty page before the session query settles.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session, isLoading, hasRole } = useSession();
  const router = useRouter();

  const allowed = roles.some(hasRole);

  useEffect(() => {
    if (isLoading) return;

    if (!session) {
      const from = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?from=${from}`);
      return;
    }

    // Signed in, wrong shell. Sent to their own start page rather than to
    // /login — they are authenticated, and a login form would be baffling.
    if (!allowed) router.replace("/");
  }, [isLoading, session, allowed, router]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8">
        <LoadingState label="Ачаалж байна…" />
      </div>
    );
  }

  if (!session || !allowed) {
    // The effect above is already redirecting; rendering the children for one
    // frame would fire their queries and produce a burst of 404s in the audit
    // log for a page nobody sees.
    return null;
  }

  return <>{children}</>;
}
