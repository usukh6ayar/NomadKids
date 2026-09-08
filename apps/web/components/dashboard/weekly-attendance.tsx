"use client";

import { useQueries } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";
import { z } from "zod";
import { groupAttendanceRowSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { ColumnChart } from "@/components/ui/chart/columns";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { BoardCard, BoardCardEmpty } from "./board-card";
import { useMyGroup } from "./use-my-group";

const daySheetSchema = z.array(groupAttendanceRowSchema);

/** Monday-first, matching the register and the sketch's own Да–Ба row. */
const SHORT_DAYS = ["Да", "Мя", "Лх", "Пү", "Ба"];
const FULL_DAYS = ["Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан"];

/**
 * The five weekdays of the week that contains `today`, as ISO dates.
 *
 * ★ This week, not the last five days.
 *
 * A rolling window would put Тавдугаар on the left on a Wednesday and on the
 * right on a Friday, so the same chart would mean something different every
 * morning. A fixed Monday–Friday column stays where a teacher last saw it, and
 * the days that have not happened yet are simply empty — which the chart draws
 * as a dashed track rather than as zero.
 *
 * Saturday and Sunday are excluded because the kindergarten does not open;
 * `getDay()` returns 0 for Sunday, so the offset is computed against a
 * Monday-first index.
 */
function weekdaysOf(today: Date): string[] {
  const mondayIndex = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayIndex);

  return SHORT_DAYS.map((_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    /*
     * Built from the local Y/M/D rather than `toISOString()`, which converts to
     * UTC first: at UTC+8 every date before 08:00 local would shift back a day,
     * so the register for "today" would be requested for yesterday. The bug is
     * invisible in a UTC test environment and wrong all morning in Ulaanbaatar.
     */
    const m = String(day.getMonth() + 1).padStart(2, "0");
    const d = String(day.getDate()).padStart(2, "0");
    return `${day.getFullYear()}-${m}-${d}`;
  });
}

/**
 * Долоо хоногийн ирц — attendance across this week, as a column per day.
 *
 * ★ The title names the data, not the old mock-up label.
 *
 * The chart contains Monday through Friday of the current week. Calling those
 * five columns "Сарын ирц" made the interface visually faithful but factually
 * ambiguous, so the card now says exactly what it shows.
 *
 * **A real month is not blocked by this file.** It needs
 * `GET /groups/:id/attendance/summary?from=&to=`, which does not exist — see
 * ★★ below for why assembling one from twenty day sheets is the wrong answer.
 *
 * ★ Five requests, and none of them is new API.
 *
 * The client's sketch puts a Да–Ба bar chart on the dashboard, and there is no
 * endpoint that returns a group's attendance over a range: `GET
 * /groups/:id/attendance` is a single day's sheet, and
 * `/children/:id/attendance/summary` is per child. Widening the API was
 * explicitly out of scope for this pass, so the week is assembled from five
 * calls to the day sheet that already exists.
 *
 * The cost is smaller than it looks. Every one is keyed
 * `qk.groupAttendance(groupId, date)` — byte-identical to the key
 * `AttendanceToday` registers for today — so today's column is a cache hit and
 * this widget adds four requests, not five. They are also the cheapest reads in
 * the product (one group, one day) and `staleTime` keeps them for the session.
 *
 * ★★ If this chart is ever asked to show a month rather than a week, that is
 * the point to add `GET /groups/:id/attendance/summary?from=&to=` rather than
 * to raise this number. Twenty requests would be the N+1 that CLAUDE.md §3.4
 * forbids, moved to the client where the rule cannot see it.
 *
 * ★★★ A day with no register is empty, not 0%.
 *
 * The sheet returns every enrolled child with `record: null` until somebody
 * marks them, so a naive present/total is 0% for tomorrow, for Friday, and for
 * this morning before 9am. `AttendanceToday` makes this the centre of its own
 * argument; `ColumnChart` draws the case as a dashed track.
 *
 * ★★★★ The headline is the week's mean over the days that were actually
 * marked. Averaging in the unmarked days would drag it toward zero as a
 * function of what day it is, which is a number about the calendar rather than
 * about the children.
 */
export function WeeklyAttendance() {
  const { group, isLoading: groupLoading } = useMyGroup();
  const dates = weekdaysOf(new Date());

  const days = useQueries({
    queries: dates.map((date) => ({
      queryKey: qk.groupAttendance(group?.id ?? "", date),
      queryFn: () => get(`/groups/${group!.id}/attendance?date=${date}`, daySheetSchema),
      // Same gate `AttendanceToday` uses: the group id arrives from a separate
      // request, and without this every one of the five fires against
      // `/groups//attendance` and 404s before it can succeed.
      enabled: Boolean(group?.id),
      staleTime: 5 * 60_000,
      // A missing column is a missing column. Retrying five requests to draw a
      // bar chart is not worth the load it puts on a screen that has already
      // rendered.
      retry: false,
    })),
  });

  if (groupLoading || (Boolean(group?.id) && days.some((day) => day.isLoading))) {
    return <WeeklyAttendanceSkeleton />;
  }

  /*
   * ★ No group is its own state, and the chart must not be reached without one.
   *
   * Every query above is gated on `group?.id`, so with no group they are all
   * disabled, every `data` is undefined, and the mapping below would turn all
   * five columns into `value: null` — drawing a week of dashed tracks under the
   * footer "Энэ долоо хоногт ирц бүртгээгүй байна". That sentence says the
   * register was not filled in. The truth is that there is no register to fill:
   * this teacher has not been assigned a group, and `RequireRole` admits an
   * admin here too. `AttendanceToday` draws the same distinction in the same
   * words, and this is that branch.
   */
  if (!group) {
    return (
      <BoardCard title="Долоо хоногийн ирц">
        <BoardCardEmpty
          icon={<CloudOff size={22} />}
          title="Ирцийн мэдээлэл алга"
          hint="Бүлэг хуваарилагдаагүй байна."
        />
      </BoardCard>
    );
  }

  const columns = days.map((day, index) => {
    const rows = day.data;
    if (!rows || rows.length === 0) {
      return { label: SHORT_DAYS[index]!, value: null, accessibleLabel: FULL_DAYS[index]! };
    }

    const present = rows.filter(
      (row) => row.record?.status === "PRESENT" || row.record?.status === "HALF_DAY",
    ).length;
    const marked = rows.filter((row) => row.record).length;

    return {
      label: SHORT_DAYS[index]!,
      // Nobody marked → no column, per the docblock above.
      value: marked === 0 ? null : Math.round((present / rows.length) * 100),
      accessibleLabel: FULL_DAYS[index]!,
    };
  });

  const marked = columns.filter((column) => column.value !== null);
  const mean =
    marked.length === 0
      ? null
      : Math.round(marked.reduce((sum, column) => sum + column.value!, 0) / marked.length);

  return (
    <BoardCard
      title="Долоо хоногийн ирц"
      /*
        The mean, in the title row — where the sketch puts its "92%". A headline
        the chart then explains, rather than a figure the reader derives by eye
        from five bars. `—` while nothing is marked, never "0%".
      */
      figure={mean === null ? "—" : `${mean}%`}
      footer={
        <p className="text-caption text-muted">
          {marked.length > 0
            ? `${marked.length} өдрийн бүртгэлээр`
            : "Энэ долоо хоногт ирц бүртгээгүй байна"}
        </p>
      }
    >
      <ColumnChart columns={columns} emptyLabel="ирц бүртгээгүй" height={138} />
    </BoardCard>
  );
}

/**
 * The skeleton holds the tile's exact footprint — chip, label, headline, plot
 * and axis. A generic run of bars would resolve to a different height and shove
 * the survey card beside it, and the whole band below, down the page.
 */
function WeeklyAttendanceSkeleton() {
  return (
    <Card pad="roomy" className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-10" />
      </div>
      <Skeleton className="h-[204px] w-full rounded-control" />
      <Skeleton className="mt-auto h-3 w-32" />
    </Card>
  );
}
