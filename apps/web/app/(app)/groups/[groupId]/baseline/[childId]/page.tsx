"use client";

import { useParams } from "next/navigation";
import { A79BaselineChildFill } from "@/components/assessment/a79-baseline-fill";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

/**
 * One child's А/79 baseline — Мэдлэг, Чадвар, Төлөвшил each on its own tab
 * (2026-10-27, the user). See `a79-baseline-fill.tsx`.
 */
export default function ChildBaselineFillPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <ChildBaselineFill />
    </RequireRole>
  );
}

function ChildBaselineFill() {
  const { groupId, childId } = useParams<{ groupId: string; childId: string }>();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Гарааны үнэлгээ" backHref={`/groups/${groupId}/baseline`} />
      <A79BaselineChildFill groupId={groupId} childId={childId} />
    </div>
  );
}
