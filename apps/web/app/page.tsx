"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/auth/session";
import { LoadingState } from "@/components/ui/states";

/**
 * The root, which only ever redirects.
 *
 * Where someone lands is a role question, and the role lives in the session —
 * which is only known once `/auth/me` has answered. So this renders a loading
 * state and then forwards, rather than guessing and bouncing the user twice.
 *
 * The rule matches the API's own `primaryDashboard`: most capable role first,
 * so an admin who is also a parent starts on the admin screen and navigates to
 * their child from there.
 */
export default function RootPage() {
  const { session, isLoading, hasRole } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    if (!session) {
      router.replace("/login");
      return;
    }

    if (hasRole("ADMIN")) router.replace("/admin");
    else if (hasRole("TEACHER")) router.replace("/dashboard");
    else if (hasRole("PARENT")) router.replace("/home");
    // Signed in with no membership — a real state after a revocation, and one
    // that must not redirect in a loop.
    else router.replace("/no-access");
  }, [isLoading, session, hasRole, router]);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10">
      <LoadingState label="Ачаалж байна…" rows={2} />
    </main>
  );
}
