"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, X } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { menuDayWithWarningsSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

const weekSchema = z.array(menuDayWithWarningsSchema);

/** Monday of the week `date` falls in, as `YYYY-MM-DD`. */
function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // getUTCDay: Sunday is 0, so Sunday belongs to the week that began six days ago.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY = ["Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан"];

/**
 * Долоо хоногийн цэс — the kitchen's own screen.
 *
 * ★ `PUT /kindergartens/:id/menu/:date` has existed since the meal register
 * shipped and had no screen at all. `TodayMenu` on the dashboard reads one day
 * for one group and `child-menu.tsx` shows a parent what their child ate;
 * neither writes, so the week was planned in the database or not at all.
 *
 * ★★ The role this exists for is Тогооч, added 2026-08-30.
 * `assertCanManageMeals` is COOK, TEACHER or ADMIN — a cook decides what goes
 * in the pot, and a teacher serves it and answers for it when a parent asks.
 *
 * ★★★ The allergy warnings are the reason this reads `with-warnings` rather
 * than the plain menu. They name which children react to what, which is why
 * that is a separate route from the one a parent reads — and the cook is
 * exactly the person who can act on it. RFP Module 2.
 */
export default function MenuPage() {
  return (
    <RequireRole roles={["COOK", "TEACHER", "ADMIN"]}>
      <WeeklyMenu />
    </RequireRole>
  );
}

function WeeklyMenu() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));

  const from = weekStart;
  const to = addDays(weekStart, 4);

  const week = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.weeklyMenu(kindergartenId ?? "", from),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/menu/with-warnings?from=${from}&to=${to}`, weekSchema),
  });

  const byDate = new Map((week.data ?? []).map((day) => [day.date.slice(0, 10), day]));

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Долоо хоногийн цэс"
        lede="Өдөр бүрийн хоол. Харшлын анхааруулга доор нь харагдана."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
            >
              Өмнөх
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setWeekStart(mondayOf(new Date()))}
            >
              Энэ долоо хоног
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
            >
              Дараах
            </Button>
          </div>
        }
      />

      {week.isLoading ? <LoadingState rows={5} /> : null}
      {week.isError ? <ErrorState description={errorMessage(week.error)} /> : null}

      {kindergartenId && !week.isLoading ? (
        <div className="flex flex-col gap-4">
          {WEEKDAY.map((label, index) => {
            const date = addDays(weekStart, index);
            return (
              <MenuDayCard
                key={date}
                kindergartenId={kindergartenId}
                weekStart={weekStart}
                date={date}
                weekday={label}
                day={byDate.get(date) ?? null}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One day, edited in place.
 *
 * ★ Saved per day rather than per week.
 *
 * `PUT /kindergartens/:id/menu/:date` is the endpoint's shape, and it matches
 * how the work is actually done: a cook writes Monday on Friday and Tuesday
 * when the delivery arrives. One save button for five days would make a
 * half-planned week unsaveable.
 */
function MenuDayCard({
  kindergartenId,
  weekStart,
  date,
  weekday,
  day,
}: {
  kindergartenId: string;
  weekStart: string;
  date: string;
  weekday: string;
  day: z.infer<typeof menuDayWithWarningsSchema> | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dishes, setDishes] = useState<string[]>(() =>
    day && day.dishes.length > 0 ? day.dishes.map((d) => d.name) : [""],
  );
  const [dirty, setDirty] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}`, z.unknown(), {
        method: "PUT",
        body: {
          dishes: dishes
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => ({ name })),
        },
      }),
    onSuccess: () => {
      toast.success(`${weekday} гарагийн цэс хадгалагдлаа.`);
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: qk.weeklyMenu(kindergartenId, weekStart) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function update(index: number, value: string) {
    setDishes((current) => current.map((d, i) => (i === index ? value : d)));
    setDirty(true);
  }

  const warnings = day?.warnings ?? [];

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lead font-semibold text-ink">{weekday}</h2>
        <span className="text-caption text-muted">{formatDate(date)}</span>
      </div>

      <div className="flex flex-col gap-2">
        {dishes.map((dish, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={`${weekday} гарагийн ${index + 1}-р хоол`}
              value={dish}
              onChange={(event) => update(index, event.target.value)}
              placeholder="Жишээ нь: Гурилтай шөл"
            />
            {dishes.length > 1 ? (
              <button
                type="button"
                aria-label={`${index + 1}-р хоолыг хасах`}
                onClick={() => {
                  setDishes((current) => current.filter((_, i) => i !== index));
                  setDirty(true);
                }}
                className="grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-danger"
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ))}

        <button
          type="button"
          onClick={() => {
            setDishes((current) => [...current, ""]);
            setDirty(true);
          }}
          className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-body font-medium text-primary hover:text-primary-strong"
        >
          <Plus size={16} aria-hidden="true" />
          Хоол нэмэх
        </button>
      </div>

      {/*
        ★ The cross-check, RFP Module 2 — and the reason this screen reads the
        staff route.

        A warning names a child and what they react to. It is shown to the
        person who can act on it and to nobody else: `menu/with-warnings` is a
        separate endpoint from the menu a parent reads for exactly this reason.
      */}
      {warnings.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-row bg-peach/40 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-body font-medium text-peach-ink">
            <AlertTriangle size={16} aria-hidden="true" />
            Харшлын анхааруулга
          </p>
          <ul className="flex flex-col gap-1">
            {warnings.map((warning, index) => (
              <li key={index} className="text-caption text-peach-ink">
                {warning.childName} — {warning.allergen}
                {warning.dishName ? ` (${warning.dishName})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={save.isPending || !dirty} onClick={() => save.mutate()}>
          {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
        {day && !dirty ? <Badge tone="mint">Хадгалагдсан</Badge> : null}
      </div>
    </Card>
  );
}
