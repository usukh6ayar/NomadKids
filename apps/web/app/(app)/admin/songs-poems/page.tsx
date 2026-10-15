"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { useSwitchableGroups } from "@/components/shell/group-switcher";
import { RequireRole } from "@/components/shell/require-role";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/api/errors";
import { groupLabel } from "@/lib/format";

export default function AdminSongsPoemsPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminSongsPoems />
    </RequireRole>
  );
}

function AdminSongsPoems() {
  const groups = useSwitchableGroups();
  const items = groups.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Дуу, шүлэг" backHref="/admin" />
      {groups.isLoading ? <LoadingState rows={5} /> : null}
      {groups.isError ? <ErrorState description={errorMessage(groups.error)} /> : null}
      {groups.data && items.length === 0 ? (
        <EmptyState
          title="Бүлэг бүртгэгдээгүй байна"
          description="Бүлэг нэмсний дараа бүлэг бүрийн дуу, шүлгийг эндээс удирдана."
        />
      ) : null}
      {items.length > 0 ? (
        <TableShell caption="Бүлгүүдийн дуу, шүлэг" minWidth="min-w-0">
          <thead>
            <tr>
              <Th className="w-12">№</Th>
              <Th>Бүлэг</Th>
              <Th className="w-28 text-right">Үйлдэл</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((group, index) => (
              <tr key={group.id} className="hover:bg-canvas/60">
                <Td className="tabular-nums text-muted">{index + 1}</Td>
                <Td className="font-medium text-ink">{groupLabel(group.name)}</Td>
                <Td className="text-right">
                  <Link
                    href={`/admin/songs-poems/${group.id}`}
                    className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-compact font-medium text-primary hover:bg-primary-soft"
                  >
                    <Pencil size={15} aria-hidden="true" />
                    Засах
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      ) : null}
    </div>
  );
}
