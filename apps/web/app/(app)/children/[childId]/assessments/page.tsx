"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAssessments } from "@/components/child/child-assessments";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { useSession } from "@/lib/auth/session";

/**
 * A specific child's development assessments — the standalone route.
 *
 * ★ Same reasoning as `/overview` (`overview/page.tsx`): the home page's
 * "Үнэлгээ" tile used to land on the child hub's bare Ерөнхий tab — it had
 * no assessment-specific destination of its own before this, despite the hub
 * carrying a real "Үнэлгээ" tab. It opens this route directly now, and the
 * tab is gone from the hub entirely.
 */
export default function ChildAssessmentsPage() {
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

      {/*
        ★ Staff only, 2026-09-09 — a guardian already knows whose record this
        is (there is one child on their screen at a time); repeating the same
        name/status/age card on every tab they open added nothing a parent
        needed and was the thing they asked to stop seeing.
      */}
      {isStaff ? <ChildHeroProfile child={data} showHealthAlert={isStaff} /> : null}

      <ChildAssessments childId={childId} isStaff={isStaff} />
    </div>
  );
}
