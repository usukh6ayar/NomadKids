"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Users } from "lucide-react";
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
import { todayLocal } from "@/lib/format";
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

  const { attendanceToday, attendanceByGroup } = data;
  const percent =
    attendanceToday.expected > 0 ? (attendanceToday.present / attendanceToday.expected) * 100 : 0;
  const withRows = attendanceByGroup.filter((g) => Object.values(g.counts).some((n) => n > 0));

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader title="Ирц" />

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
                <div key={group.groupId} className="flex flex-col gap-2.5 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-body font-medium text-ink">
                      {group.name}
                    </span>
                    <ul className="flex flex-wrap gap-1.5">
                      {ATTENDANCE_STATUS_ORDER.filter(
                        (status) => (group.counts[status] ?? 0) > 0,
                      ).map((status) => (
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
                      ))}
                    </ul>
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
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Тараалт — one group's row of sitting chips, from Өглөөний цай through
 * Оройн хоол. Tapping an unmarked chip records it; tapping a marked one
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
