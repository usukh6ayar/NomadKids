"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { CalendarDays, CheckCircle2, Percent } from "lucide-react";
import { useState } from "react";
import { groupAttendanceSummarySchema, type GroupAttendanceSummary } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { GroupSwitcher, useSwitchableGroups } from "@/components/shell/group-switcher";
import { Art } from "@/components/ui/art";
import { Card, SectionHeader, SunkenPanel } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { BarRow } from "@/components/ui/chart/bar-row";
import {
  ATTENDANCE_STATUS_CHART_TONE,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_ORDER,
} from "@/lib/attendance-meta";
import { fullName } from "@/lib/format";
import { StatCard } from "@/components/ui/stat-card";

/**
 * "Тайлан" — a teacher's own group, a month at a time.
 *
 * ★ Added 2026-09-05, and the menu row is the reason it exists.
 *
 * The reference system gives a teacher a "Тайлан" entry and this product did
 * not: `/attendance/daily` is the director's screen (`@Roles("ADMIN",
 * "ACCOUNTANT")`) and `term-report` is one child at a time. The client asked
 * for the menu row, and constraint 8 says every row goes somewhere — so the
 * destination had to be built rather than pointed at something adjacent.
 *
 * ★★ It adds no endpoint. `GET /groups/:id/attendance/summary` already returns
 * the month, the roster size, a per-day breakdown, the totals and every child
 * with their own counts — it is what the register's month panel draws. This
 * screen is that same response read at the grain a report wants, which is why
 * a figure here can never disagree with the figure on the register.
 *
 * ★★★ **No money, and no Excel button.**
 *
 * The reference's report band ends with "Хоолны дүн" and offers a download.
 * Neither is here. A teacher has no financial access at all (§4.16, and the
 * client's own words: "Багш санхүүгийн бүрэн мэдээллийг харах эрхгүй байна"),
 * and the register's spreadsheet export lives on
 * `kindergartens/:id/attendance/register/export` behind `@Roles("ADMIN",
 * "ACCOUNTANT")` — there is no group-scoped export a teacher may call. A
 * button that renders and then 403s is worse than one that was never offered,
 * because the teacher blames themselves.
 */
export default function ReportsPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <Reports />
    </RequireRole>
  );
}

/** `YYYY-MM` for today, in the same UTC framing every other date here uses. */
function currentMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 7);
}

function Reports() {
  const { group } = useMyGroup();
  const [month, setMonth] = useState(currentMonth);

  /*
   * ★ A director gets a group picker instead of a dead end — 2026-09-09.
   *
   * `useMyGroup` resolves nothing for an administrator, who has every group and
   * therefore no single one, and this screen answered that with an empty state
   * pointing at Ирц. That was defensible while nothing linked here; the
   * dashboard's `Тайлан` card does now, and a card that lands on "you are in
   * the wrong place" is the dead navigation this product deletes screens over.
   *
   * The group is in the query string rather than in local state, so a director
   * comparing two groups can keep both open and the Back button steps between
   * them — the reason `GroupSwitcher` is links everywhere else.
   */
  const searchParams = useSearchParams();
  const groups = useSwitchableGroups(!group);
  const items = groups.data?.items ?? [];
  const chosen = searchParams.get("group") ?? "";
  const groupId =
    group?.id ?? (items.some((item) => item.id === chosen) ? chosen : items[0]?.id) ?? "";

  const summary = useQuery({
    queryKey: qk.groupAttendanceSummary(groupId, month),
    queryFn: () =>
      get(`/groups/${groupId}/attendance/summary?month=${month}`, groupAttendanceSummarySchema),
    enabled: Boolean(groupId && month),
  });

  const header = <PageHeader title="Тайлан" />;

  /*
    ★ A teacher with no group gets an explanation, not an empty report.

    `useMyGroup` resolves nothing for a new hire before an assignment. That is a
    real state and not an error; the assessment sheet makes the same choice for
    the same reason. An administrator no longer reaches this branch unless the
    kindergarten has no groups at all, which is the same sentence either way.
  */
  if (!groupId && !groups.isLoading) {
    return (
      <div className="page-band">
        {header}
        <EmptyState
          title="Бүлэг хараахан хуваарилагдаагүй байна"
          description="Тайлан нэг бүлгийн сарын ирцийг харуулна. Бүлэг хуваарилагдсаны дараа энд гарч ирнэ. Захирал бүх бүлгийн нэгтгэлийг Ирц хэсгээс харна."
        />
      </div>
    );
  }

  return (
    <div className="page-band">
      {header}

      {/* Only for somebody who has more than one — `GroupSwitcher` renders
          nothing below two, so a teacher's screen is unchanged. */}
      <GroupSwitcher groups={items} activeGroupId={groupId} href={(id) => `/reports?group=${id}`} />

      {/*
        A month, not a from/to pair. The register is kept by the month and the
        summary endpoint takes one; a free range here would promise a query the
        API does not answer.
      */}
      <Card pad="roomy">
        <Field label="Сар" className="w-full sm:w-56">
          {({ id }) => (
            <Input
              id={id}
              type="month"
              max={currentMonth()}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          )}
        </Field>
      </Card>

      {summary.isLoading ? <LoadingState rows={3} shape="cards" /> : null}
      {summary.isError ? <ErrorState description={errorMessage(summary.error)} /> : null}
      {summary.data ? <MonthReport data={summary.data} /> : null}
    </div>
  );
}

function MonthReport({ data }: { data: GroupAttendanceSummary }) {
  /*
    ★ Counted from the response, not fetched a second time.

    Every figure below comes out of the one payload, so the headline, the
    breakdown and the per-child table cannot disagree with each other — which
    is the failure a report makes expensive, because nobody can tell which of
    two numbers was wrong.
  */
  const recordedDays = data.days.length;
  const present = data.totals.PRESENT ?? 0;
  const totalMarks =
    ATTENDANCE_STATUS_ORDER.reduce((sum, status) => sum + (data.totals[status] ?? 0), 0) +
    (data.totals.OTHER ?? 0);

  /*
    The share of every mark that is "Ирсэн", not attendance against the roster
    ×  days: a month has weekends and holidays, and dividing by a calendar
    would report a well-run group as 70%.
  */
  const rate = totalMarks > 0 ? Math.round((present / totalMarks) * 100) : null;

  if (recordedDays === 0) {
    return (
      <EmptyState
        title="Энэ сард ирц бүртгэгдээгүй байна"
        description="Ирц бүртгэсний дараа сарын нэгтгэл, хүүхэд тус бүрийн задаргаа энд гарна."
      />
    );
  }

  return (
    <>
      <section aria-label="Сарын дүн" className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard
          label="Бүртгэсэн өдөр"
          value={recordedDays}
          unit="өдөр"
          art={<CalendarDays size={22} />}
          tone="sky"
          className="teacher-stat-card teacher-stat-sky"
        />
        <StatCard
          label="Ирцийн хувь"
          value={rate === null ? "—" : `${rate}%`}
          art={<Percent size={22} />}
          tone="mint"
          className="teacher-stat-card teacher-stat-mint"
        />
        <StatCard
          label="Ирсэн тэмдэглэгээ"
          value={present}
          unit="удаа"
          art={<CheckCircle2 size={22} />}
          tone="sun"
          className="teacher-stat-card teacher-stat-sun"
        />
        <StatCard
          label="Бүлгийн хүүхэд"
          value={data.roster}
          unit="хүүхэд"
          art={<Art name="group" size={36} />}
          artSurface={false}
          tone="peach"
          className="teacher-stat-card teacher-stat-peach"
        />
      </section>

      <section aria-labelledby="breakdown-heading">
        <SectionHeader
          id="breakdown-heading"
          title="Төлвийн задаргаа"
          lede="Тухайн сард тэмдэглэсэн бүх ирцийн хуваарилалт."
        />
        <Card pad="roomy" className="flex flex-col gap-2.5">
          {[...ATTENDANCE_STATUS_ORDER, "OTHER" as const]
            .map((status) => ({ status, count: data.totals[status] ?? 0 }))
            // A permanent row of noughts buries the two statuses that happened.
            .filter(({ count }) => count > 0)
            .map(({ status, count }) => (
              <BarRow
                key={status}
                inline
                label={ATTENDANCE_STATUS_LABEL[status] ?? status}
                value={count}
                percent={totalMarks > 0 ? Math.round((count / totalMarks) * 100) : 0}
                tone={ATTENDANCE_STATUS_CHART_TONE[status] ?? "sky"}
                accessibleLabel={`${ATTENDANCE_STATUS_LABEL[status]}: ${count} тэмдэглэгээ`}
              />
            ))}
        </Card>
      </section>

      <section aria-labelledby="children-heading">
        <SectionHeader
          id="children-heading"
          title="Хүүхэд тус бүрээр"
          lede="Бүртгэл байхгүй хүүхэд ч жагсаалтад орно."
        />
        <Card className="divide-y divide-border">
          {data.children.map(({ child, counts }) => {
            const marks =
              ATTENDANCE_STATUS_ORDER.reduce((sum, s) => sum + (counts[s] ?? 0), 0) +
              (counts.OTHER ?? 0);
            const childPresent = counts.PRESENT ?? 0;

            return (
              <div
                key={child.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken"
              >
                <ChildAvatar child={child} size={36} />
                <span className="min-w-0 flex-1 truncate text-lead font-semibold text-ink">
                  {fullName(child)}
                </span>

                {/*
                  ★ The absences, not only the attendances.

                  A teacher reading a month reads it for the children who were
                  not there; "22 ирсэн" beside "22 ирсэн" thirty times is a
                  column nobody scans. Anything above nought gets its own chip.
                */}
                <SunkenPanel className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                  {marks === 0 ? (
                    <span className="text-caption text-muted">Бүртгэл алга</span>
                  ) : (
                    [...ATTENDANCE_STATUS_ORDER, "OTHER" as const]
                      .filter((s) => (counts[s] ?? 0) > 0)
                      .map((s) => (
                        <span key={s} className="text-caption text-muted">
                          {ATTENDANCE_STATUS_LABEL[s] ?? s}{" "}
                          <strong className="tabular-nums text-ink">{counts[s]}</strong>
                        </span>
                      ))
                  )}
                </SunkenPanel>

                <span className="w-14 shrink-0 text-right text-lead font-semibold tabular-nums text-ink">
                  {marks > 0 ? `${Math.round((childPresent / marks) * 100)}%` : "—"}
                </span>
              </div>
            );
          })}
        </Card>
      </section>
    </>
  );
}
