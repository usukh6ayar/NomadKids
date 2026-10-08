"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import {
  A79ChildrenTable,
  A79_DEMO_NOTE,
  a79ChildRows,
  useA79GroupSummary,
} from "@/components/assessment/a79-group-summary";
import { AssessmentSwitch } from "@/components/assessment/assessment-switch";
import { DemoBanner } from "@/components/feedback/feedback-parts";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { errorMessage } from "@/lib/api/errors";
import { fullName } from "@/lib/format";

/**
 * «Үр дүнгийн үнэлгээ» — the group's children, each with their А/79 result by
 * part; pressing a name opens their own (`[childId]/page.tsx`).
 *
 * ★ The same table as Тайлан's «Үр дүнгийн үнэлгээ» tab — 2026-10-08, the
 * client: "ингээд харуул". One hook and one table serve both, so the two
 * screens cannot show a child different figures.
 */
export default function GroupResultsPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <GroupResults />
    </RequireRole>
  );
}

function GroupResults() {
  const { groupId } = useParams<{ groupId: string }>();
  const [query, setQuery] = useState("");
  const { data, demo, isLoading, error } = useA79GroupSummary(groupId);

  const needle = query.trim().toLowerCase();
  const rows = data
    ? a79ChildRows(data).filter((row) => !needle || fullName(row).toLowerCase().includes(needle))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Үр дүнгийн үнэлгээ" backHref="/dashboard" />
      <AssessmentSwitch groupId={groupId} active="results" />

      {demo ? <DemoBanner>{A79_DEMO_NOTE}</DemoBanner> : null}
      {isLoading ? <LoadingState rows={6} /> : null}
      {error ? <ErrorState description={errorMessage(error)} /> : null}

      {data && data.children.length === 0 ? (
        <EmptyState
          title="Бүлэгт хүүхэд алга"
          description="Хүүхэд бүлэгт бүртгэгдсэний дараа үр дүн энд харагдана."
        />
      ) : null}

      {data && data.children.length > 0 ? (
        <>
          <SearchField label="Хүүхдийн нэрээр хайх" value={query} onChange={setQuery} />
          {rows.length === 0 ? (
            <p className="py-8 text-center text-body text-muted">Хайлтад тохирох хүүхэд алга.</p>
          ) : (
            <A79ChildrenTable groupId={groupId} rows={rows} />
          )}
        </>
      ) : null}
    </div>
  );
}
