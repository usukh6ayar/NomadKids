"use client";

import { AlertTriangle } from "lucide-react";
import type { CookDashboard } from "@kinder/contracts";
import { Card } from "@/components/ui/card";
import { Ring } from "@/components/ui/chart/ring";

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

  /*
    ★ A ring and two figures — 2026-10-07, the client: "олон үггүй минимал
    орчин үеийн өхөөрдөм график". The sentences about the groups became a
    count and, when a group has not said, one short warning pill.
  */
  return (
    <section aria-labelledby="today-attendance">
      <Card className="flex items-center gap-4 px-4 py-3">
        <Ring percent={percent} tone="mint" />

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="today-attendance" className="text-caption font-semibold text-muted">
            Өнөөдрийн ирц
          </h2>
          <span className="flex items-baseline gap-1">
            <span className="text-title font-bold tabular-nums leading-none text-ink">
              {attendanceToday.present}
            </span>
            <span className="text-caption tabular-nums text-muted">
              / {attendanceToday.expected} хүүхэд
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-caption">
            <span className="rounded-pill bg-mint px-2 py-0.5 font-semibold tabular-nums text-mint-ink">
              {withRegister}/{groups.length} бүлэг
            </span>
            {missing.length > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-pill bg-sun px-2 py-0.5 font-semibold tabular-nums text-sun-ink">
                <AlertTriangle size={12} aria-hidden="true" className="shrink-0" />
                {missing.length} дутуу
              </span>
            ) : null}
          </span>
        </span>
      </Card>
    </section>
  );
}
