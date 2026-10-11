"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { groupSchema } from "@kinder/contracts";
import { RoutineView } from "@/components/routine/routine-view";
import { useRoutine } from "@/components/routine/use-routine";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";

/**
 * A group's Өдрийн дэглэм — the teacher keeps it; the director reads what the
 * teacher keeps (client, 2026-10-09: "удирдлагад … багшийн хийж хөтөлж байгаа
 * харагдана"), so for an ADMIN who is not the group's teacher it is read-only.
 */
export default function GroupRoutinePage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <GroupRoutine />
    </RequireRole>
  );
}

function GroupRoutine() {
  const { groupId } = useParams<{ groupId: string }>();
  const { hasRole } = useSession();
  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupSchema),
  });
  const name = group.data?.name ?? "";
  const { routine, demo, isLoading, error, actions } = useRoutine(
    `/groups/${groupId}/routine`,
    { id: groupId, name },
    { group: groupId },
  );
  const mode = hasRole("TEACHER") ? "teacher" : "admin";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Өдрийн дэглэм"
        backHref={mode === "admin" ? "/admin/routine" : "/dashboard"}
        lede={routine?.group.name || name || undefined}
      />
      {isLoading ? <LoadingState rows={6} /> : null}
      {error ? <ErrorState description={errorMessage(error)} /> : null}
      {routine ? (
        <RoutineView
          routine={routine}
          mode={mode}
          demo={demo}
          actions={mode === "teacher" ? actions : {}}
        />
      ) : null}
    </div>
  );
}
