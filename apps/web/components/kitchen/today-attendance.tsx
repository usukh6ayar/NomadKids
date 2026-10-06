"use client";

import { AlertTriangle } from "lucide-react";
import type { CookDashboard } from "@kinder/contracts";
import { Card } from "@/components/ui/card";

/**
 * Today's attendance for the whole kindergarten — the figure the kitchen
 * cooks to.
 *
 * ★ It replaced four cards on 2026-10-06, at the client's request:
 * «Өнөөдөр хоолох хүүхэд», «Тараасан порц», «Тусгай хоол» and «Анхаарах
 * зүйлс» gave way to the kindergarten's attendance with the groups' table
 * straight under it. The kitchen's «Ирц» screen opens on the same card. The groups that have not filled their register in stay
 * on the card, because "43 of 46" means less while one group has not said.
 */
export function TodayAttendance({ data }: { data: CookDashboard }) {
  const { attendanceToday, groups } = data;
  const percent =
    attendanceToday.expected > 0
      ? Math.round((attendanceToday.present / attendanceToday.expected) * 100)
      : 0;

  const withRegister = groups.filter((group) => group.recorded > 0).length;
  const missing = groups.filter((group) => group.recorded === 0);

  return (
    <section aria-labelledby="today-attendance">
      <Card className="flex flex-col gap-1.5 px-3 py-2.5 sm:px-4">
        <span className="flex items-baseline justify-between gap-2">
          <h2 id="today-attendance" className="text-caption font-semibold text-muted">
            Өнөөдрийн ирц
          </h2>
          <span className="text-caption font-semibold tabular-nums text-mint-ink">{percent}%</span>
        </span>

        <span className="flex items-baseline gap-1">
          <span className="text-lead font-bold tabular-nums leading-none text-ink">
            {attendanceToday.present}
          </span>
          <span className="text-caption tabular-nums text-muted">
            / {attendanceToday.expected} хүүхэд ирсэн
          </span>
        </span>

        <span aria-hidden="true" className="h-1 overflow-hidden rounded-pill bg-track">
          <span
            className="block h-full rounded-pill bg-mint-ink"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </span>

        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted">
          <span>
            {groups.length} бүлгээс {withRegister} бүлгийн ирц бүртгэгдсэн
          </span>
          {missing.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-sun-ink">
              <AlertTriangle size={12} aria-hidden="true" className="shrink-0" />
              {missing.length} бүлэг ирцээ оруулаагүй байна
            </span>
          ) : null}
        </span>
      </Card>
    </section>
  );
}
