"use client";

import { useParams } from "next/navigation";
import { A79BaselinePanel } from "@/components/assessment/a79-baseline";
import { AssessmentSwitch } from "@/components/assessment/assessment-switch";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

/**
 * «Гарааны үнэлгээ» — the group's А/79 baseline, beside Явцын and Үр дүнгийн
 * (2026-10-21, the user). Read from the teacher's baseline survey; see
 * `components/assessment/a79-baseline.tsx`.
 */
export default function GroupBaselinePage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <GroupBaseline />
    </RequireRole>
  );
}

function GroupBaseline() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Гарааны үнэлгээ" backHref="/dashboard" />
      <AssessmentSwitch groupId={groupId} active="baseline" />
      <A79BaselinePanel groupId={groupId} heading={false} />
    </div>
  );
}
