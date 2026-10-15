"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { childSummarySchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/use-debounced";
import { formatAge, fullName, groupLabel } from "@/lib/format";
import { PageHeader } from "@/components/shell/app-shell";
import { ChildAvatar } from "@/components/media/media-image";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

const listSchema = paginated(childSummarySchema);
const PAGE_SIZE = 30;

/**
 * «Суралцагч» for the PE/music teacher and the doctor — 2026-10-15.
 *
 * ★ `GET /children` already returns exactly their reach: a specialist's
 * assigned groups, the doctor's whole kindergarten (`visibleChildCardsWhere`).
 * So this is only a list and a door — straight to the one screen each role
 * is for: a child's observations, or their health record.
 */
export function CardRoster() {
  const { hasRole } = useSession();
  const isSpecialist = hasRole("PE_TEACHER") || hasRole("MUSIC_TEACHER");
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(typed.trim());

  const list = useQuery({
    queryKey: qk.children({ q: search || undefined, page, pageSize: PAGE_SIZE, view: "card" }),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search) params.set("q", search);
      return get(`/children?${params}`, listSchema);
    },
  });

  // A specialist's door is the observations; the doctor's is the health tab.
  const hrefFor = (childId: string) =>
    isSpecialist ? `/children/${childId}/observations` : `/children/${childId}/general?tab=health`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Суралцагч" />

      <SearchField
        label="Хүүхдийн нэрээр хайх"
        placeholder="Нэрээр хайх"
        value={typed}
        onChange={(value) => {
          setTyped(value);
          setPage(1);
        }}
      />

      {list.isLoading ? (
        <LoadingState rows={5} />
      ) : list.isError ? (
        <ErrorState description={errorMessage(list.error)} />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title={search ? "Хайлтад тохирох хүүхэд алга" : "Хүүхэд алга"}
          description={
            search
              ? "Өөр нэрээр хайж үзнэ үү."
              : isSpecialist
                ? "Захирал таныг бүлэгт хуваарилсны дараа тухайн бүлгийн хүүхдүүд энд харагдана."
                : "Цэцэрлэгт бүртгэлтэй хүүхэд одоогоор алга."
          }
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border-soft rounded-card border border-border bg-surface">
            {list.data.items.map((child) => {
              const group = child.enrollments[0]?.group?.name;
              return (
                <li key={child.id}>
                  <Link
                    href={hrefFor(child.id)}
                    className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-canvas"
                  >
                    <ChildAvatar child={child} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{fullName(child)}</span>
                      <span className="block text-caption text-muted">
                        {[group ? groupLabel(group) : null, formatAge(child.dateOfBirth)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} totalPages={list.data.totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
