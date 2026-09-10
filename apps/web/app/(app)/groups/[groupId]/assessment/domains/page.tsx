"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { groupSchema, schoolYearSchema } from "@kinder/contracts";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { RequireRole } from "@/components/shell/require-role";
import { LoadingState } from "@/components/ui/states";
import { CoverageDetail } from "@/components/assessment/coverage-detail";

const yearsSchema = z.array(schoolYearSchema);

/**
 * One of the four breakdown screens — see `coverage-detail.tsx` for why they
 * are four routes over one component.
 *
 * `Suspense` because the component reads `useSearchParams` for the term it
 * came from, the same reason the assessment page itself is wrapped.
 */
export default function Page() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <Suspense fallback={<LoadingState rows={5} />}>
        <Body />
      </Suspense>
    </RequireRole>
  );
}

function Body() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  /*
    The window these counts are taken over is the group's school year, which
    only the group row knows. Read here rather than passed through the URL:
    a hand-typed address would otherwise decide the window.
  */
  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupSchema),
  });

  const years = useQuery({
    queryKey: ["school-years", group.data?.kindergartenId ?? ""],
    queryFn: () => get(`/kindergartens/${group.data!.kindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(group.data?.kindergartenId),
    staleTime: 5 * 60_000,
  });

  const year = (years.data ?? []).find((entry) => entry.id === group.data?.schoolYearId);

  return (
    <CoverageDetail
      groupId={groupId}
      kind="domains"
      startsOn={year?.startsOn}
      endsOn={year?.endsOn}
    />
  );
}
