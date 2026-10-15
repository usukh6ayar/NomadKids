"use client";

import { useParams } from "next/navigation";
import { SongsPoemsLibrary } from "@/components/songs-poems/songs-poems-library";
import { PageHeader } from "@/components/shell/app-shell";
import { useSwitchableGroups } from "@/components/shell/group-switcher";
import { RequireRole } from "@/components/shell/require-role";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { errorMessage } from "@/lib/api/errors";
import { groupLabel } from "@/lib/format";

export default function AdminGroupSongsPoemsPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminGroupSongsPoems />
    </RequireRole>
  );
}

function AdminGroupSongsPoems() {
  const { groupId } = useParams<{ groupId: string }>();
  const groups = useSwitchableGroups();
  const group = groups.data?.items.find((item) => item.id === groupId);

  return (
    <div className="page-band">
      <PageHeader
        title="Дуу, шүлэг"
        lede={group ? groupLabel(group.name) : undefined}
        backHref="/admin/songs-poems"
      />
      {groups.isLoading ? <LoadingState rows={5} /> : null}
      {groups.isError ? <ErrorState description={errorMessage(groups.error)} /> : null}
      {groups.data && !group ? (
        <EmptyState title="Бүлэг олдсонгүй" description="Бүлгийн жагсаалтаас дахин сонгоно уу." />
      ) : null}
      {group ? <SongsPoemsLibrary mode="admin" source={{ group: groupId }} /> : null}
    </div>
  );
}
