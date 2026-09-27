"use client";

import { useMemo, useState } from "react";
import { UsersRound } from "lucide-react";
import type { GroupListItem } from "@kinder/contracts";
import { Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { Art } from "@/components/ui/art";
import { GroupCard } from "./group-card";

/** Whether a group has anybody assigned to it right now. */
export const hasTeacher = (group: GroupListItem): boolean =>
  (group.teachers ?? []).some((teacher) => !teacher.endedOn);

/**
 * Бүлгүүд — the summary, the filters and the cards.
 *
 * ★ **Four figures, and the fourth is the one worth acting on.** "Багшгүй" is
 * not a statistic: a group with no `GroupTeacher` row is a group no teacher
 * can open, because that row is what `canAccessChild` resolves access through
 * (SECURITY.md §7). It is drawn in amber when it is not zero for that reason.
 *
 * ★★ Filtered in the browser, over the whole list. The screen asks for the
 * API's maximum page of 100 and a kindergarten does not have a hundred groups;
 * the day one does, this needs a pager and the filtering moves with it.
 */
export function GroupGrid({
  groups,
  onManageTeachers,
}: {
  groups: GroupListItem[];
  onManageTeachers: (group: GroupListItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [staffed, setStaffed] = useState("");
  const [status, setStatus] = useState("");

  const summary = useMemo(() => {
    const withTeacher = groups.filter(hasTeacher).length;
    return {
      groups: groups.length,
      children: groups.reduce((total, group) => total + (group._count?.enrollments ?? 0), 0),
      withTeacher,
      withoutTeacher: groups.length - withTeacher,
    };
  }, [groups]);

  const visible = useMemo(() => {
    // Mongolian case folding, as every other search in the product does it.
    const needle = query.trim().toLocaleLowerCase("mn-MN");
    return groups.filter((group) => {
      if (staffed === "WITH" && !hasTeacher(group)) return false;
      if (staffed === "WITHOUT" && hasTeacher(group)) return false;
      if (status && (group.status ?? "ACTIVE") !== status) return false;
      if (!needle) return true;
      return group.name.toLocaleLowerCase("mn-MN").includes(needle);
    });
  }, [groups, query, staffed, status]);

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Нийт бүлэг"
          value={summary.groups}
          unit="бүлэг"
          tone="sky"
          art={<UsersRound size={22} aria-hidden />}
        />
        <StatCard
          label="Нийт суралцагч"
          value={summary.children}
          unit="хүүхэд"
          tone="cornflower"
          art={<Art name="child" size={36} />}
          artSurface={false}
          href="/children"
        />
        <StatCard label="Багштай" value={summary.withTeacher} unit="бүлэг" tone="mint" />
        <StatCard
          label="Багшгүй"
          value={summary.withoutTeacher}
          unit="бүлэг"
          tone={summary.withoutTeacher > 0 ? "sun" : "mint"}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchField
          label="Бүлгийн нэрээр хайх"
          placeholder="Бүлэг хайх…"
          value={query}
          onChange={setQuery}
          className="sm:max-w-[300px]"
        />
        <Select
          aria-label="Багшаар шүүх"
          value={staffed}
          onChange={(event) => setStaffed(event.target.value)}
          className="w-full sm:w-[170px]"
        >
          <option value="">Бүх бүлэг</option>
          <option value="WITH">Багштай</option>
          <option value="WITHOUT">Багшгүй</option>
        </Select>
        <Select
          aria-label="Төлөвөөр шүүх"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="w-full sm:w-[160px]"
        >
          <option value="">Бүх төлөв</option>
          <option value="ACTIVE">Идэвхтэй</option>
          <option value="ARCHIVED">Архивласан</option>
        </Select>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Хайлтад тохирох бүлэг олдсонгүй"
          description="Хайлт, шүүлтээ өөрчилж үзнэ үү."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              onManageTeachers={() => onManageTeachers(group)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
