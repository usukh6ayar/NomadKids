"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, ClipboardList, ShoppingCart } from "lucide-react";
import { cookDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Ring } from "@/components/ui/chart/ring";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { BoardCard, BoardCardEmpty } from "@/components/dashboard/board-card";

/**
 * The cook's "Самбар" — replaced the bottom bar's `Цэс` tab, which pointed at
 * `/menu`, the same page the sidebar's own "Хоолны цэс" already opens.
 * Two nav entries for one page was the bug; this is a screen of its own.
 *
 * ★ "What needs my attention today", the same rule the teacher and admin
 * dashboards follow (`dashboard.service.ts`) — not a wall of statistics, and
 * not a hub of links back to the sidebar's own rows (`app/(app)/layout.tsx`'s
 * `staffSections` comment on why the admin hub screens were removed applies
 * here too). Two real questions: how many children are here to cook for, and
 * is anything waiting on a delivery.
 *
 * ★★ `GET /dashboard/cook` reuses the admin dashboard's own attendance
 * queries for a single day rather than the admin's 30-day window — a cook
 * plans one day's portions. Both are aggregate counts with no child's name in
 * them (`dashboard.service.ts`), which is what let this ship as a route
 * rather than a new authorization rule.
 */
export default function KitchenDashboardPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <KitchenDashboard />
    </RequireRole>
  );
}

function KitchenDashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.cook(),
    queryFn: () => get("/dashboard/cook", cookDashboardSchema),
  });

  const header = <PageHeader title="Самбар" />;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 lg:gap-6">
        {header}
        <LoadingState rows={3} />
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

  const { attendanceToday, pendingFoodOrders } = data;
  const percent =
    attendanceToday.expected > 0 ? (attendanceToday.present / attendanceToday.expected) * 100 : 0;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {header}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:gap-5">
        <BoardCard
          title="Өнөөдрийн ирц"
          footer={
            <Link
              href="/kitchen/attendance"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-body font-medium text-primary hover:text-primary-strong"
            >
              Бүлгээр харах
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {attendanceToday.expected === 0 ? (
            <BoardCardEmpty
              icon={<ClipboardList size={22} />}
              title="Хүүхэд бүртгэлгүй"
              hint="Хүүхэд элссэний дараа ирц энд харагдана."
            />
          ) : (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-4 md:gap-5">
              <Ring
                percent={percent}
                size="lg"
                tone="mint"
                muted={attendanceToday.recorded === 0}
              />
              <div className="min-w-0 text-center sm:text-left">
                {attendanceToday.recorded === 0 ? (
                  <>
                    <p className="text-lead font-semibold leading-heading text-ink">
                      Ирц бүртгэгдээгүй байна
                    </p>
                    <p className="mt-0.5 text-caption text-muted">
                      Багш бүлгийнхээ ирцийг бүртгэсний дараа энд харагдана
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold tabular-nums leading-none text-ink text-figure">
                      {attendanceToday.present}
                      <span className="text-display text-faint"> / {attendanceToday.expected}</span>
                    </p>
                    <p className="mt-1 text-caption text-muted">ирсэн — хоолны тоог ирцээр бод</p>
                  </>
                )}
              </div>
            </div>
          )}
        </BoardCard>

        <BoardCard
          title="Хүнсний захиалга"
          figure={pendingFoodOrders}
          footer={
            <Link
              href="/kitchen/orders"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-body font-medium text-primary hover:text-primary-strong"
            >
              Захиалгууд руу
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          }
        >
          {pendingFoodOrders === 0 ? (
            <BoardCardEmpty
              icon={<ShoppingCart size={22} />}
              title="Хүлээгдэж буй захиалга алга"
              hint="Бүх захиалга хүлээн авсан байна."
            />
          ) : (
            <p className="text-body text-muted">Нийлүүлэгчээс хараахан хүлээн аваагүй захиалга.</p>
          )}
        </BoardCard>
      </div>
    </div>
  );
}
