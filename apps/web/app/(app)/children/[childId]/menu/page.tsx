"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildMenu } from "@/components/child/child-menu";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { useSession } from "@/lib/auth/session";

/**
 * A specific child's weekly menu — the standalone route.
 *
 * ★ Same reasoning as `/overview` (`overview/page.tsx`): the home page's
 * "Хоол" tile used to deep-link into the child hub's own Хоол ба цэс tab
 * (`?tab=menu`); it opens this route directly instead, and the tab is gone
 * from the hub entirely.
 *
 * `ChildMenu` is kindergarten-wide, not child-scoped — `kindergartenId` and
 * `healthNotes` (the allergy cross-check) still come from this specific
 * child's own record, which is why this route fetches it at all rather than
 * routing straight to a kindergarten-level URL.
 */
export default function ChildMenuPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  if (child.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState description={errorMessage(child.error)} />
      </div>
    );
  }

  const data = child.data!;

  return (
    <div className="flex flex-col gap-6 py-2">
      <BackButton href={`/children/${childId}/general`} />

      {/* ★ Staff only, 2026-09-09 — see assessments/page.tsx's note. */}
      {isStaff ? <ChildHeroProfile child={data} showHealthAlert={isStaff} /> : null}

      <ChildMenu
        kindergartenId={data.kindergarten?.id ?? ""}
        childId={childId}
        healthNotes={data.healthNotes}
        isStaff={isStaff}
      />
    </div>
  );
}
