"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ATTENDANCE_STATUS_LABEL,
  attendanceJournalSchema,
  groupListItemSchema,
  paginated,
  type AttendanceJournalRow,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

/**
 * Ирцийн дэлгэрэнгүй — the whole kindergarten, a child per row and a day per
 * column, over any range of dates.
 *
 * ★ Every other attendance screen answers about one group on one day, or one
 * child in one month. This is the one a director opens to see the shape of a
 * term, and the one an accountant reads before a funding claim: those two
 * questions are asked over the period the claim covers, which is not obliged
 * to be a calendar month.
 *
 * ★★ ADMIN and ACCOUNTANT only, matching `assertCanReadFinance` on the API.
 * `RequireRole` is UX — it keeps the sidebar honest — and the real refusal is
 * the server's 404. A teacher reads their own group's sheet instead, which is
 * the view their job needs (нэмэлт.md §13).
 */
export default function AttendanceJournalPage() {
  return (
    <RequireRole roles={["ADMIN", "ACCOUNTANT"]}>
      <AttendanceJournal />
    </RequireRole>
  );
}

/** The six the column can hold — `OTHER` included, since 2026-09-02. */
const groupsSchema = paginated(groupListItemSchema);

const STATUS_ORDER = ["PRESENT", "HALF_DAY", "EXCUSED", "SICK", "ABSENT", "OTHER"] as const;

/**
 * One letter per status, for a grid where a word would not fit.
 *
 * ★ The full label is on the cell's `title` and its `aria-label`, so the
 * abbreviation is a convenience for sighted readers and never the only way to
 * know what a cell says.
 */
const STATUS_SHORT: Record<string, string> = {
  PRESENT: "И",
  HALF_DAY: "Х",
  EXCUSED: "Ч",
  SICK: "Ө",
  ABSENT: "Т",
  OTHER: "Б",
};

const STATUS_TONE: Record<string, string> = {
  PRESENT: "bg-success-soft text-success-strong",
  HALF_DAY: "bg-warning-soft text-warning-strong",
  EXCUSED: "bg-info-soft text-info-strong",
  SICK: "bg-warning-soft text-warning-strong",
  ABSENT: "bg-danger-soft text-danger-strong",
  OTHER: "bg-canvas text-muted",
};

function AttendanceJournal() {
  const { primaryKindergartenId } = useSession();

  const [from, setFrom] = useState(() => firstOfMonth());
  const [to, setTo] = useState(() => today());
  const [groupId, setGroupId] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      from,
      to,
      ...(groupId ? { groupId } : {}),
      ...(statuses.length ? { status: statuses.join(",") } : {}),
      ...(search.trim() ? { q: search.trim() } : {}),
      page,
      pageSize: 25,
    }),
    [from, to, groupId, statuses, search, page],
  );

  const journal = useQuery({
    queryKey: qk.attendanceJournal(primaryKindergartenId ?? "", filters),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/attendance/register?${new URLSearchParams(
          Object.entries(filters).map(([k, v]) => [k, String(v)]),
        ).toString()}`,
        attendanceJournalSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
    // Keeps the grid on screen while a filter is being changed, instead of
    // collapsing to a skeleton on every keystroke.
    placeholderData: (previous) => previous,
  });

  /*
   * `GET /groups`, not `/kindergartens/:id/groups` — the second is a POST-only
   * route, and the funding register's own comment records what happened when a
   * screen assumed otherwise. The key matches `useSwitchableGroups`, so this
   * reads a cache the shell has usually already filled.
   */
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  function toggleStatus(status: string) {
    setPage(1);
    setStatuses((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    );
  }

  const data = journal.data;

  return (
    <div className="flex flex-col gap-4 py-2">
      <PageHeader
        title="Ирцийн дэлгэрэнгүй"
        lede="Хүүхэд бүрийн өдөр тутмын ирц, сонгосон хугацаагаар"
      />

      <Card pad="roomy" className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Эхлэх">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={from}
                onChange={(e) => {
                  setPage(1);
                  setFrom(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Дуусах">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={to}
                onChange={(e) => {
                  setPage(1);
                  setTo(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Бүлэг">
            {({ id }) => (
              <Select
                id={id}
                value={groupId}
                onChange={(e) => {
                  setPage(1);
                  setGroupId(e.target.value);
                }}
              >
                <option value="">Бүх бүлэг</option>
                {(groups.data?.items ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Хүүхдийн нэр">
            {({ id }) => (
              <Input
                id={id}
                value={search}
                placeholder="Нэрээр хайх"
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
            )}
          </Field>
        </div>

        <FilterChipRow label="Ирцийн төлөв" scroll>
          {STATUS_ORDER.map((status) => (
            <FilterChip
              key={status}
              active={statuses.includes(status)}
              onClick={() => toggleStatus(status)}
            >
              {ATTENDANCE_STATUS_LABEL[status] ?? status}
            </FilterChip>
          ))}
        </FilterChipRow>
      </Card>

      {journal.isError ? (
        <ErrorState description={errorMessage(journal.error)} />
      ) : journal.isPending ? (
        <LoadingState rows={4} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Бүртгэл алга"
          description="Сонгосон хугацаа, шүүлтэд тохирох хүүхэд олдсонгүй. Хугацаагаа өргөтгөж эсвэл шүүлтээ цэвэрлэж үзнэ үү."
        />
      ) : (
        <>
          <Totals totals={data.totals} />
          <Grid rows={data.items} days={data.days} />
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

/** The period's totals, across every matching child rather than the page. */
function Totals({ totals }: { totals: Record<string, number> }) {
  const present = STATUS_ORDER.filter((status) => (totals[status] ?? 0) > 0);
  if (present.length === 0) return null;

  return (
    <Card pad="roomy" className="flex flex-wrap gap-x-6 gap-y-2">
      {present.map((status) => (
        <div key={status} className="flex flex-col">
          <span className="text-caption text-muted">{ATTENDANCE_STATUS_LABEL[status]}</span>
          <span className="text-title text-ink">{totals[status]}</span>
        </div>
      ))}
    </Card>
  );
}

/**
 * The grid itself.
 *
 * ★ The name column is sticky and the days scroll under it. A register whose
 * first column scrolls away is unreadable at exactly the width it is most
 * needed — a director on a laptop looking at a month.
 */
function Grid({ rows, days }: { rows: AttendanceJournalRow[]; days: string[] }) {
  return (
    <Card pad="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-caption">
          <thead>
            <tr className="border-b border-line">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium text-muted"
              >
                Хүүхэд
              </th>
              {days.map((day) => (
                <th key={day} scope="col" className="px-1 py-2 text-center font-medium text-muted">
                  {/* Day of month only — the year and month are in the filter above. */}
                  {Number(day.slice(8, 10))}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium text-muted">
                Ирсэн
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.childId} className="border-b border-line last:border-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[12rem] truncate bg-surface px-3 py-2 text-left font-normal text-ink"
                >
                  {row.child.lastName} {row.child.firstName}
                  <span className="block text-caption text-muted">{row.group.name}</span>
                </th>

                {row.days.map((cell, index) => (
                  <td key={days[index]} className="px-1 py-2 text-center">
                    {cell ? (
                      <span
                        title={`${days[index]} — ${ATTENDANCE_STATUS_LABEL[cell.status] ?? cell.status}`}
                        aria-label={`${days[index]} — ${ATTENDANCE_STATUS_LABEL[cell.status] ?? cell.status}`}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-control ${
                          STATUS_TONE[cell.status] ?? "bg-canvas text-muted"
                        }`}
                      >
                        {STATUS_SHORT[cell.status] ?? "?"}
                      </span>
                    ) : (
                      // ★ A dash, not an empty cell and not "absent". Nothing
                      // was recorded that day, which is a different fact from
                      // a recorded absence — and the one that becomes a
                      // funding claim if they are confused.
                      <span aria-label={`${days[index]} — бүртгэлгүй`} className="text-muted">
                        –
                      </span>
                    )}
                  </td>
                ))}

                <td className="px-3 py-2 text-right text-ink">
                  {(row.counts.PRESENT ?? 0) + (row.counts.HALF_DAY ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
