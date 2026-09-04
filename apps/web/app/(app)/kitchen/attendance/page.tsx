"use client";

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { cookDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { formatLongDate } from "@/lib/format";
import {
  ATTENDANCE_STATUS_BG,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_ORDER,
} from "@/lib/attendance-meta";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Ring } from "@/components/ui/chart/ring";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

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
 */
export default function KitchenAttendancePage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <KitchenAttendance />
    </RequireRole>
  );
}

function KitchenAttendance() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.cook(),
    queryFn: () => get("/dashboard/cook", cookDashboardSchema),
  });

  const header = (lede: string) => (
    <PageHeader title="Ирц" lede={lede} />
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 lg:gap-6">
        {header("Ачаалж байна…")}
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col gap-5 lg:gap-6">
        {header("Мэдээлэл ачаалж чадсангүй")}
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

  const { attendanceToday, attendanceByGroup } = data;
  const percent =
    attendanceToday.expected > 0 ? (attendanceToday.present / attendanceToday.expected) * 100 : 0;
  const withRows = attendanceByGroup.filter((g) => Object.values(g.counts).some((n) => n > 0));

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {header(`${formatLongDate(new Date())} — хоолны тоо төлөвлөхөд`)}

      {attendanceToday.expected === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="Хүүхэд бүртгэлгүй"
          description="Хүүхэд элссэний дараа ирц энд харагдана."
        />
      ) : (
        <>
          <Card pad="roomy" className="flex flex-wrap items-center gap-6">
            <Ring
              percent={percent}
              size="lg"
              tone="mint"
              muted={attendanceToday.recorded === 0}
              label={`Ирсэн ${attendanceToday.present}, нийт ${attendanceToday.expected}`}
            >
              <span className="text-title font-semibold tabular-nums text-ink">
                {Math.round(percent)}%
              </span>
            </Ring>

            <dl className="flex min-w-0 flex-1 flex-col gap-3">
              <div>
                <dt className="text-caption text-muted">Ирсэн</dt>
                <dd className="text-figure font-semibold leading-none tabular-nums text-ink">
                  {attendanceToday.present}
                  <span className="text-title text-muted"> / {attendanceToday.expected}</span>
                </dd>
              </div>
              <div className="border-t border-border-soft pt-3">
                <dt className="text-caption text-muted">Бүртгэл</dt>
                <dd className="text-lead font-medium text-ink">
                  {attendanceToday.recorded === 0
                    ? "Бүртгэгдээгүй байна"
                    : `${attendanceToday.recorded} / ${attendanceToday.expected} бүртгэсэн`}
                </dd>
              </div>
            </dl>
          </Card>

          {withRows.length === 0 ? (
            <EmptyState
              icon={<Users size={28} />}
              title="Өнөөдөр ирц бүртгэгдээгүй байна"
              description="Багш нар бүлгийнхээ ирцийг бүртгэсний дараа энд бүлэг тус бүрээр харагдана."
            />
          ) : (
            <Card className="divide-y divide-border">
              {withRows.map((group) => (
                <div key={group.groupId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 truncate text-body font-medium text-ink">
                    {group.name}
                  </span>
                  <ul className="flex flex-wrap gap-1.5">
                    {ATTENDANCE_STATUS_ORDER.filter((status) => (group.counts[status] ?? 0) > 0).map(
                      (status) => (
                        <li
                          key={status}
                          className="flex items-center gap-1.5 rounded-pill border border-border bg-surface px-2.5 py-1 text-caption text-muted"
                        >
                          <span
                            aria-hidden="true"
                            className={`size-2 rounded-pill ${ATTENDANCE_STATUS_BG[status]}`}
                          />
                          {ATTENDANCE_STATUS_LABEL[status] ?? status}
                          <span className="font-semibold tabular-nums text-ink">
                            {group.counts[status]}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
