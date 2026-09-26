"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, Users, UtensilsCrossed } from "lucide-react";
import type { ReactNode } from "react";
import { z } from "zod";
import {
  cookDashboardSchema,
  MEAL_KIND_LABEL,
  mealKindSchema,
  mealServingSchema,
  type MealServing,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { formatDate, todayLocal, groupLabel } from "@/lib/format";
import {
  ATTENDANCE_STATUS_BG,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_ORDER,
} from "@/lib/attendance-meta";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

const mealServingsSchema = z.array(mealServingSchema);
const MEAL_KINDS = mealKindSchema.options;

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
 * ★★★ Тараалт, added 2026-09-05, is the other half of the same job: this
 * screen already says how many to portion for; each group's row now also
 * says whether that portion has actually gone out, per sitting.
 */
export default function KitchenAttendancePage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <KitchenAttendance />
    </RequireRole>
  );
}

function KitchenAttendance() {
  const { primaryKindergartenId } = useSession();
  const today = todayLocal();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.cook(),
    queryFn: () => get("/dashboard/cook", cookDashboardSchema),
  });

  const servings = useQuery({
    enabled: Boolean(primaryKindergartenId),
    queryKey: qk.kitchen.mealServings(primaryKindergartenId ?? "", today),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/meal-servings?date=${today}`,
        mealServingsSchema,
      ),
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

  const { attendanceToday, attendanceByGroup, groups, meals } = data;
  const percent =
    attendanceToday.expected > 0
      ? Math.round((attendanceToday.present / attendanceToday.expected) * 100)
      : 0;
  const withRegister = groups.filter((group) => group.recorded > 0).length;
  const servedGroups = new Set((servings.data ?? []).map((row) => row.groupId)).size;

  return (
    <div className="page-band">
      {/*
        ★ The board's own header and cards — 2026-09-17, the client: "тогооч
        ирц хэсгийн самбар дээрх шиг ижил ойлгомжтой болго."

        It opened on a ring and two lines of prose, which is a different visual
        language from the board the cook has just come from — and the ring's
        percentage is the least useful number here: a kitchen portions to a
        count, not a rate.
      */}
      <PageHeader
        title="Ирц"
        lede="Өнөөдөр хэдэн хүүхэд хооллохыг бүлгээр харах, тараалтаа бүртгэх"
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
          <section aria-label="Өнөөдрийн дүн" className="grid gap-3 sm:grid-cols-3">
            <KitchenStat
              tone="mint"
              icon={<Users size={18} aria-hidden="true" />}
              label="Өнөөдөр хоолох хүүхэд"
              value={`${attendanceToday.present}`}
              detail={`${attendanceToday.expected} хүүхдээс · ${percent}%`}
              percent={percent}
            />
            <KitchenStat
              tone="sky"
              icon={<ClipboardList size={18} aria-hidden="true" />}
              label="Ирц бүртгэсэн бүлэг"
              value={`${withRegister} / ${groups.length}`}
              detail={
                withRegister === groups.length
                  ? "Бүх бүлэг бүртгэсэн"
                  : `${groups.length - withRegister} бүлэг дутуу`
              }
              percent={groups.length > 0 ? Math.round((withRegister / groups.length) * 100) : 0}
            />
            <KitchenStat
              tone="sun"
              icon={<UtensilsCrossed size={18} aria-hidden="true" />}
              label="Тараалт бүртгэсэн бүлэг"
              value={`${servedGroups} / ${groups.length}`}
              detail={
                meals.served > 0 ? `${meals.served} порц бүртгэгдсэн` : "Тараалт бүртгээгүй байна"
              }
              percent={groups.length > 0 ? Math.round((servedGroups / groups.length) * 100) : 0}
            />
          </section>

          {/*
            ★ Every active group, not only the ones with a register.

            The list used to drop a group that had recorded nothing, so the two
            groups a cook is waiting on were invisible — the one thing this
            screen is opened to find out. A group with no register shows a dash
            and a "Ирц дутуу" badge, exactly as the board's table does.
          */}
          <Card pad="none" className="divide-y divide-border-soft">
            {groups.map((group) => {
              const counts =
                attendanceByGroup.find((row) => row.groupId === group.groupId)?.counts ?? {};

              return (
                <div key={group.groupId} className="flex flex-col gap-2.5 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-body font-semibold text-ink">
                        {groupLabel(group.name)}
                      </span>
                      <span className="shrink-0 text-caption tabular-nums text-muted">
                        {group.recorded === 0 ? "—" : group.present} / {group.enrolled}
                      </span>
                    </span>

                    {group.recorded === 0 ? (
                      <Badge tone="sun">Ирц дутуу</Badge>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {ATTENDANCE_STATUS_ORDER.filter((status) => (counts[status] ?? 0) > 0).map(
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
                                {counts[status]}
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </div>

                  {primaryKindergartenId && servings.data ? (
                    <MealServingRow
                      kindergartenId={primaryKindergartenId}
                      groupId={group.groupId}
                      date={today}
                      servings={servings.data}
                    />
                  ) : null}
                </div>
              );
            })}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * One of the three figures, in the board's own card — icon chip, count, a line
 * of detail and a rule under it.
 */
function KitchenStat({
  tone,
  icon,
  label,
  value,
  detail,
  percent,
}: {
  tone: "mint" | "sky" | "sun";
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  percent: number;
}) {
  const chips = {
    mint: "bg-mint text-mint-ink",
    sky: "bg-sky text-sky-ink",
    sun: "bg-sun text-sun-ink",
  } as const;
  const bars = { mint: "bg-mint-ink", sky: "bg-sky-ink", sun: "bg-sun-ink" } as const;

  return (
    <Card pad="compact" className="flex flex-col gap-2">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn("grid size-9 shrink-0 place-items-center rounded-card", chips[tone])}
        >
          {icon}
        </span>
        <span className="min-w-0 truncate text-caption font-medium text-muted">{label}</span>
      </span>

      <span className="text-figure font-bold tabular-nums leading-none text-ink">{value}</span>

      <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-pill bg-track">
        <span
          className={cn("block h-full rounded-pill", bars[tone])}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </span>

      <span className="text-caption text-muted">{detail}</span>
    </Card>
  );
}

/**
 * Тараалт — one group's row of sitting chips, from Өглөөний хоол through
 * Их үдийн цай. Tapping an unmarked chip records it; tapping a marked one
 * undoes it — a cook fixing a mis-tap, or the food not actually being out yet.
 *
 * ★ Every possible sitting is offered, not just the ones today's menu plans.
 * The menu is kindergarten-wide while this is per group, and narrowing the
 * set would need cross-referencing the two — a real feature, just not this
 * one; nothing here stops a kitchen from marking a sitting it always serves.
 */
function MealServingRow({
  kindergartenId,
  groupId,
  date,
  servings,
}: {
  kindergartenId: string;
  groupId: string;
  date: string;
  servings: MealServing[];
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = qk.kitchen.mealServings(kindergartenId, date);

  const mark = useMutation({
    mutationFn: (kind: string) =>
      mutate(`/kindergartens/${kindergartenId}/meal-servings`, mealServingSchema, {
        method: "POST",
        body: { groupId, date, kind },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const unmark = useMutation({
    mutationFn: (id: string) => mutate(`/meal-servings/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const byKind = new Map(
    servings.filter((s) => s.groupId === groupId).map((s) => [s.kind, s] as const),
  );

  return (
    <ul className="flex flex-wrap gap-1.5">
      {MEAL_KINDS.map((kind) => {
        const serving = byKind.get(kind);
        const pending =
          (mark.isPending && mark.variables === kind) ||
          (unmark.isPending && serving && unmark.variables === serving.id);

        return (
          <li key={kind}>
            <button
              type="button"
              disabled={Boolean(pending)}
              aria-pressed={Boolean(serving)}
              onClick={() => (serving ? unmark.mutate(serving.id) : mark.mutate(kind))}
              className={cn(
                "flex min-h-[32px] items-center gap-1.5 rounded-pill border px-2.5 py-1 text-caption font-medium transition-colors disabled:opacity-50",
                serving
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-muted hover:bg-canvas",
              )}
            >
              {serving ? <Check size={14} aria-hidden="true" /> : null}
              {MEAL_KIND_LABEL[kind]}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
