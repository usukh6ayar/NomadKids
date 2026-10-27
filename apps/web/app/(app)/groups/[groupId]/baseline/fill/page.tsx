"use client";

import { useParams } from "next/navigation";
import { A79BaselineGroupFill } from "@/components/assessment/a79-baseline-fill";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

/**
 * «Бүлгээр бөглөх» — the group's А/79 baseline for every child at once, in
 * the teacher sheet's table (2026-10-27, the user). See `a79-baseline-fill.tsx`.
 */
export default function GroupBaselineFillPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <GroupBaselineFill />
    </RequireRole>
  );
}

function GroupBaselineFill() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Гарааны үнэлгээ — бүлгээр" backHref={`/groups/${groupId}/baseline`} />
      <A79BaselineGroupFill groupId={groupId} />
    </div>
  );
}
