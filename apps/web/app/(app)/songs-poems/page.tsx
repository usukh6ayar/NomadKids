"use client";

import { useQuery } from "@tanstack/react-query";
import { groupListItemSchema, paginated } from "@kinder/contracts";
import { useState } from "react";
import { SongsPoemsLibrary } from "@/components/songs-poems/songs-poems-library";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";

const groupsSchema = paginated(groupListItemSchema);

export default function SongsPoemsPage() {
  return (
    <RequireRole roles={["TEACHER"]}>
      <div className="page-band">
        <PageHeader title="Дуу, шүлэг" backHref="/dashboard" />
        <TeacherLibrary />
      </div>
    </RequireRole>
  );
}

/**
 * ★ The library is the group's (2026-10-11): what a teacher adds reaches that
 * group's families. A teacher of one group goes straight to it; a teacher of
 * several chooses — `/groups` answers a teacher with their own groups only.
 */
function TeacherLibrary() {
  const groups = useQuery({
    queryKey: ["groups", "mine", "ACTIVE"],
    queryFn: () => get("/groups?status=ACTIVE&page=1&pageSize=50", groupsSchema),
  });
  const [chosen, setChosen] = useState<string | null>(null);

  if (groups.isLoading) return <LoadingState rows={3} shape="cards" />;
  if (groups.error) return <ErrorState description={errorMessage(groups.error)} />;

  const items = groups.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="Танд бүлэг оноогоогүй байна"
        description="Цэцэрлэгийн эрхлэгч таныг бүлэгт оноосны дараа дуу, шүлгээ энд оруулна."
      />
    );
  }

  const groupId = chosen ?? items[0]!.id;
  return (
    <div className="flex flex-col gap-4">
      {items.length > 1 ? (
        <Field label="Бүлэг">
          {({ id }) => (
            <Select id={id} value={groupId} onChange={(event) => setChosen(event.target.value)}>
              {items.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <SongsPoemsLibrary key={groupId} mode="teacher" source={{ group: groupId }} />
    </div>
  );
}
