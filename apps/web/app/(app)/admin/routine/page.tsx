"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { useSwitchableGroups } from "@/components/shell/group-switcher";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/api/errors";
import { groupLabel } from "@/lib/format";

/**
 * Өдрийн дэглэм for the director — every group in a table; a row opens the
 * routine that group's teacher keeps, read-only (client, 2026-10-09).
 */
export default function AdminRoutinePage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminRoutine />
    </RequireRole>
  );
}

function AdminRoutine() {
  const groups = useSwitchableGroups();
  const items = groups.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Өдрийн дэглэм" backHref="/admin" />
      {groups.isLoading ? <LoadingState rows={5} /> : null}
      {groups.isError ? <ErrorState description={errorMessage(groups.error)} /> : null}
      {groups.data && items.length === 0 ? (
        <EmptyState
          title="Бүлэг бүртгэгдээгүй байна"
          description="Бүлэг нэмсний дараа бүлэг бүрийн дэглэм энд харагдана."
        />
      ) : null}
      {items.length > 0 ? (
        <TableShell caption="Бүлгүүдийн өдрийн дэглэм" minWidth="min-w-0">
          <thead>
            <tr>
              <Th className="w-12">№</Th>
              <Th>Бүлэг</Th>
              <Th className="w-10">
                <span className="sr-only">Нээх</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {items.map((group, index) => (
              <tr key={group.id} className="hover:bg-canvas/60">
                <Td className="tabular-nums text-muted">{index + 1}</Td>
                <Td>
                  <Link
                    href={`/groups/${group.id}/routine`}
                    className="font-medium text-ink hover:text-primary hover:underline"
                  >
                    {groupLabel(group.name)}
                  </Link>
                </Td>
                <Td>
                  <ChevronRight size={16} aria-hidden="true" className="text-muted" />
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      ) : null}
    </div>
  );
}
