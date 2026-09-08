"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAttendance } from "@/components/child/child-attendance";
import { useSession } from "@/lib/auth/session";

/**
 * A specific child's attendance — the standalone route.
 *
 * ★ Same reasoning as `/overview` (`overview/page.tsx`): the home page's
 * "Ирц" tile used to deep-link into the child hub's own Ирц tab
 * (`?tab=attendance`); it opens this route directly instead, and the tab is
 * gone from the hub entirely — one destination, not a route and a tab both
 * showing the same thing.
 *
 * This route deliberately starts with the attendance content. The large child
 * hero and its decorative background belong to the profile, not to a task
 * screen somebody opens to report a drop-off or request leave.
 */
export default function ChildAttendancePage() {
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

      <h1 className="sr-only">{data.firstName}-ийн ирц</h1>

      <ChildAttendance childId={childId} isStaff={isStaff} childFirstName={data.firstName} />
    </div>
  );
}
