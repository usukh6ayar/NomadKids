"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Users } from "lucide-react";
import { cookDashboardSchema, type CookDashboard } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { cn } from "@/lib/utils";
import { formatDate, todayLocal } from "@/lib/format";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SearchField } from "@/components/ui/search-field";
import { TableShell, Td, Th } from "@/components/ui/table";
import { TodayAttendance } from "@/components/kitchen/today-attendance";

/**
 * "Ирц" — the sidebar row above "Тайлан" (`app/(app)/layout.tsx`).
 *
 * ★ The detail behind the Самбар headcount tile (`/kitchen/dashboard`), not a
 * second copy of it: that screen answers "how many, in total"; this answers
 * "how many per group", which is the number a cook actually portions meals
 * against — a kindergarten of ninety split five-to-a-group cooks nothing like
 * one hall of ninety.
 *
 * ★★ Same `GET /dashboard/cook` response as the dashboard tile. Both are
 * counts only — no child's name reaches either screen (`dashboard.service.ts`).
 *
 * ★★★ Тараалт (added 2026-09-05) was taken off on 2026-10-06 at the client's
 * request: nothing else read it — not the board, not a report — so it was a
 * checklist the cook did not use. The rows it wrote stay in `MealServing`.
 */
export default function KitchenAttendancePage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <KitchenAttendance />
    </RequireRole>
  );
}

function KitchenAttendance() {
  const today = todayLocal();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.cook(),
    queryFn: () => get("/dashboard/cook", cookDashboardSchema),
  });

  const header = <PageHeader title="Ирц" />;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 lg:gap-6">
        {header}
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col gap-5 lg:gap-6">
        {header}
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </div>
    );
  }

  const { attendanceToday, attendanceByGroup, groups } = data;

  return (
    <div className="page-band">
      <PageHeader
        title="Ирц"
        actions={
          <span className="inline-flex min-h-11 items-center rounded-pill bg-canvas px-4 text-body font-medium tabular-nums text-ink">
            {formatDate(today)}
          </span>
        }
      />

      {attendanceToday.expected === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="Хүүхэд бүртгэлгүй"
          description="Хүүхэд элссэний дараа ирц энд харагдана."
        />
      ) : (
        <>
          {/*
            ★ Today, made plain — client, 2026-10-06 ("өнөөдрөөр ойлгомжтой
            хий"). The board's attendance card, then one table: a group a
            line, each status in its own column, the day's total at the foot.
            The three large tiles and the per-group chips it replaces said the
            same numbers in three shapes. Today only: the client said the
            cook does not need a month ("тогооч сараар харах хэрэггүй").
          */}
          <div className="flex flex-col gap-2">
            <TodayAttendance data={data} />
            <GroupAttendanceTable groups={groups} byGroup={attendanceByGroup} />
          </div>
        </>
      )}
    </div>
  );
}

/** The groups' table, one tight line a group. */
const CELL = "px-2.5 py-1.5 text-caption";

/** The statuses a register records, in the order the teacher's sheet uses. */
const STATUS_COLUMNS = [
  { key: "SICK", label: "Өвчтэй" },
  { key: "EXCUSED", label: "Чөлөөтэй" },
  { key: "ABSENT", label: "Тасалсан" },
] as const;

/**
 * Today per group: on the roll, here, each kind of absence, and how many the
 * register has not answered for. «Ирсэн» counts `HALF_DAY` too, the way
 * `/dashboard/cook` does — a child there for half the day eats.
 */
function GroupAttendanceTable({
  groups,
  byGroup,
}: {
  groups: CookDashboard["groups"];
  byGroup: CookDashboard["attendanceByGroup"];
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase("mn");
  const rows = groups
    .filter((group) => !term || group.name.toLocaleLowerCase("mn").includes(term))
    .map((group) => {
      const counts = byGroup.find((row) => row.groupId === group.groupId)?.counts ?? {};
      return {
        ...group,
        counts,
        missing: Math.max(0, group.enrolled - group.recorded),
      };
    });
  const sum = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const blank = (row: (typeof rows)[number], value: number) => (row.recorded === 0 ? "—" : value);

  return (
    <section aria-labelledby="group-attendance" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="group-attendance" className="text-caption font-semibold text-muted">
          Бүлгүүдийн өнөөдрийн ирц
          <span className="ml-2 font-normal tabular-nums">
            {term ? `${rows.length} / ${groups.length}` : groups.length} бүлэг
          </span>
        </h2>
        {/*
          ★ Client, 2026-10-06: «бүлгийн ирц дээр хайх». The total row adds up
          what the search leaves, so a cook who narrows to two groups reads
          those two groups' total.
        */}
        <div className="w-full sm:w-[220px]">
          <SearchField
            label="Бүлгийн нэрээр хайх"
            placeholder="Бүлэг хайх"
            value={query}
            onChange={setQuery}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-control bg-canvas px-3 py-2 text-caption text-muted">
          «{query.trim()}» нэртэй бүлэг олдсонгүй.
        </p>
      ) : (
        <TableShell caption="Бүлгүүдийн өнөөдрийн ирц">
          <thead>
            <tr>
              <Th className={CELL}>Бүлэг</Th>
              <Th className={CELL} numeric>
                Нийт
              </Th>
              <Th className={CELL} numeric>
                Ирсэн
              </Th>
              {STATUS_COLUMNS.map((column) => (
                <Th key={column.key} className={CELL} numeric>
                  {column.label}
                </Th>
              ))}
              <Th className={CELL} numeric>
                Бүртгээгүй
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.groupId}>
                <Td className={cn(CELL, "font-medium")}>{row.name}</Td>
                <Td className={CELL} numeric>
                  {row.enrolled}
                </Td>
                <Td className={cn(CELL, "font-semibold text-mint-ink")} numeric>
                  {blank(row, row.present)}
                </Td>
                {STATUS_COLUMNS.map((column) => (
                  <Td key={column.key} className={CELL} numeric>
                    {blank(row, row.counts[column.key] ?? 0)}
                  </Td>
                ))}
                <Td className={cn(CELL, row.missing > 0 && "font-semibold text-sun-ink")} numeric>
                  {row.missing}
                </Td>
              </tr>
            ))}
            <tr className="bg-sunken font-semibold">
              <Td className={CELL}>Нийт</Td>
              <Td className={CELL} numeric>
                {sum((row) => row.enrolled)}
              </Td>
              <Td className={cn(CELL, "text-mint-ink")} numeric>
                {sum((row) => row.present)}
              </Td>
              {STATUS_COLUMNS.map((column) => (
                <Td key={column.key} className={CELL} numeric>
                  {sum((row) => row.counts[column.key] ?? 0)}
                </Td>
              ))}
              <Td className={CELL} numeric>
                {sum((row) => row.missing)}
              </Td>
            </tr>
          </tbody>
        </TableShell>
      )}
    </section>
  );
}
