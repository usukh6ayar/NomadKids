"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildObservations } from "@/components/child/child-observations";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { useSession } from "@/lib/auth/session";

/**
 * A specific child's observations — the standalone route.
 *
 * ★ Same reasoning as `/attendance` and `/menu`: this used to be the child
 * hub's own "Ажиглалт" tab; the hub is gone (`children/[childId]/page.tsx`
 * was deleted), so this opens directly and the tab no longer exists anywhere.
 */
export default function ChildObservationsPage() {
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

      <ChildObservations childId={childId} isStaff={isStaff} />
    </div>
  );
}
