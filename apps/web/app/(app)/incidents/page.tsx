"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { INCIDENT_KIND_LABEL, incidentSchema, paginated } from "@kinder/contracts";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { ChildAvatar } from "@/components/media/media-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowCard, RowList } from "@/components/ui/card";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/field";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatDate, fullName } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";

const listSchema = paginated(incidentSchema);

export default function IncidentsPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <IncidentJournal />
    </RequireRole>
  );
}

function IncidentJournal() {
  const { primaryKindergartenId } = useSession();
  const kindergartenId = primaryKindergartenId ?? "";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unreported" | "priority">("all");
  const [page, setPage] = useState(1);
  const search = useDebounced(query.trim());
  const filters = { q: search || undefined, filter, page };

  const incidents = useQuery({
    queryKey: qk.kindergartenIncidents(kindergartenId, filters),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search) params.set("q", search);
      if (filter === "unreported") params.set("unreportedOnly", "true");
      if (filter === "priority") params.set("highPriorityOnly", "true");
      return get(`/kindergartens/${kindergartenId}/incidents?${params}`, listSchema);
    },
    enabled: Boolean(kindergartenId),
    placeholderData: (previous) => previous,
  });

  function selectFilter(next: typeof filter) {
    setFilter(next);
    setPage(1);
  }

  return (
    <div className="page-band">
      <PageHeader
        title="Аюулгүй байдал"
        lede="Осол, бэртэл болон эцэг эхэд мэдээлэх шаардлагатай тохиолдлууд."
        actions={
          incidents.data ? <ResultCount total={incidents.data.total} noun="тохиолдол" /> : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-[420px]">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Хүүхэд эсвэл тэмдэглэлээр хайх"
            aria-label="Аюулгүй байдлын бүртгэлээс хайх"
            className="pl-11"
          />
        </div>

        <FilterChipRow label="Тохиолдлын төлөвөөр шүүх">
          <FilterChip active={filter === "all"} onClick={() => selectFilter("all")}>
            Бүгд
          </FilterChip>
          <FilterChip active={filter === "unreported"} onClick={() => selectFilter("unreported")}>
            Мэдэгдээгүй
          </FilterChip>
          <FilterChip active={filter === "priority"} onClick={() => selectFilter("priority")}>
            Яаралтай
          </FilterChip>
        </FilterChipRow>
      </div>

      {incidents.isLoading ? <LoadingState rows={5} shape="rows" /> : null}

      {incidents.isError ? (
        <ErrorState
          description={errorMessage(incidents.error)}
          action={
            <Button variant="secondary" onClick={() => void incidents.refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {incidents.data?.items.length === 0 ? (
        <EmptyState
          title={search || filter !== "all" ? "Тохирох тохиолдол алга" : "Тохиолдол бүртгэгдээгүй"}
          description={
            search || filter !== "all"
              ? "Хайлт эсвэл шүүлтүүрээ өөрчилж үзнэ үү."
              : "Хүүхдийн хуудасны Аюулгүй байдал хэсгээс шинэ тэмдэглэл бүртгэнэ."
          }
        />
      ) : null}

      {incidents.data && incidents.data.items.length > 0 ? (
        <>
          <RowList aria-busy={incidents.isPlaceholderData}>
            {incidents.data.items.map((incident) => {
              const child = incident.child;
              const href = child ? `/children/${child.id}/general?tab=incidents` : "/children";

              return (
                <RowCard key={incident.id} interactive>
                  <Link href={href} className="flex min-w-0 items-center gap-3">
                    <ChildAvatar child={child ?? {}} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-lead font-semibold text-ink">
                          {child ? fullName(child) : "Хүүхдийн мэдээлэл алга"}
                        </span>
                        {incident.isHighPriority ? (
                          <Badge tone="danger">
                            <AlertTriangle size={13} aria-hidden="true" /> Яаралтай
                          </Badge>
                        ) : null}
                        <Badge tone={incident.reportedAt ? "mint" : "sun"}>
                          {incident.reportedAt ? "Мэдэгдсэн" : "Мэдэгдээгүй"}
                        </Badge>
                      </span>
                      <span className="mt-1 block text-body font-medium text-ink">
                        {INCIDENT_KIND_LABEL[incident.kind] ?? incident.kind}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-body text-muted">
                        {incident.description}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
                        <span>{formatDate(incident.occurredAt)}</span>
                        {incident.location ? <span>{incident.location}</span> : null}
                        {incident.reportedAt ? (
                          <span className="inline-flex items-center gap-1 text-mint-ink">
                            <ShieldCheck size={14} aria-hidden="true" /> Эцэг эхэд мэдээлсэн
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <ChevronRight size={19} aria-hidden="true" className="shrink-0 text-faint" />
                  </Link>
                </RowCard>
              );
            })}
          </RowList>

          <Pagination
            page={incidents.data.page}
            totalPages={incidents.data.totalPages}
            onPage={setPage}
          />
        </>
      ) : null}
    </div>
  );
}
