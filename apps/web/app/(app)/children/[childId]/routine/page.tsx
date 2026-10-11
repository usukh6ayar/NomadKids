"use client";

import { useParams } from "next/navigation";
import { RoutineView } from "@/components/routine/routine-view";
import { useRoutine } from "@/components/routine/use-routine";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { errorMessage } from "@/lib/api/errors";

/**
 * A family's Өдрийн дэглэм — their child's group's routine, plan and clubs,
 * and «Хамрагдах хүсэлт» on a club (client, 2026-10-09). Read through the
 * child, so the server checks the guardian (`canAccessChild`), not a group id
 * the browser names.
 */
export default function ChildRoutinePage() {
  return (
    <RequireRole roles={["PARENT"]}>
      <ChildRoutine />
    </RequireRole>
  );
}

function ChildRoutine() {
  const { childId } = useParams<{ childId: string }>();
  const { routine, isLoading, error, actions } = useRoutine(`/children/${childId}/routine`, {
    child: childId,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Өдрийн дэглэм" backHref="/home" lede={routine?.group.name || undefined} />
      {isLoading ? <LoadingState rows={6} /> : null}
      {error ? <ErrorState description={errorMessage(error)} /> : null}
      {routine ? <RoutineView routine={routine} mode="parent" actions={actions} /> : null}
    </div>
  );
}
