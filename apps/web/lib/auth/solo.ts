"use client";

import { useSession } from "@/lib/auth/session";

/**
 * The solo workspace this person teaches in, or `null`.
 *
 * ★ A teacher who signed up alone holds TEACHER only in a workspace of kind
 * SOLO_TEACHER (the user, 2026-10-14) and sets up their own school year and
 * group there — nobody else would. The API decides who may
 * (`TenantAccessService.workspaceKindergartenIds`); this only decides which
 * menu entry and which screen to show.
 */
export function useSoloWorkspaceId(): string | null {
  const { session } = useSession();
  const solo = new Set(session?.soloKindergartenIds ?? []);
  return (
    session?.memberships.find((m) => m.role === "TEACHER" && solo.has(m.kindergartenId))
      ?.kindergartenId ?? null
  );
}
