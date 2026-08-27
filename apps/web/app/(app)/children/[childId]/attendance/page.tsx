"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAttendance } from "@/components/child/child-attendance";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
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
 * The hero renders here (not inside `ChildAttendance` itself, which has no
 * opinion on identity) because this route has no other visible anchor for
 * whose record is open — unlike the hub, which already shows it above the
 * tab strip.
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
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/general`}>
          <ArrowLeft size={18} />
          Хүүхдийн бүртгэл
        </Link>
      </Button>

      <ChildHeroProfile child={data} showHealthAlert={isStaff} />

      <ChildAttendance childId={childId} isStaff={isStaff} childFirstName={data.firstName} />
    </div>
  );
}
