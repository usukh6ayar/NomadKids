"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
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
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { MenuDishEditor, fromDraft, toDraft, type DishDraft } from "@/components/menu/menu-dish-editor";
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
 *
 * ★★★★ Every dish field, not just its name — fixed 2026-08-30, the same day
 * this shipped. `PUT .../menu/:date` **replaces** the day's dishes outright
 * (`meals.repository.ts`'s `upsertDay`), and `findAllergenWarnings` only ever
 * warns by reading `dish.allergenTags` — a name-only save could never trigger
 * the one warning RFP Module 2 names for this role, and it silently erased
 * any `kind`/`allergenTags`/`ingredients`/`calories`/`portions` a teacher had
 * already entered for that day through `child-menu.tsx`'s own editor. Both
 * screens now share `MenuDishEditor` (`components/menu/menu-dish-editor.tsx`)
 * for exactly that reason — one editor, so a cook's save and a teacher's save
 * cannot disagree about what a full dish record looks like.
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
        lede="Өдөр бүрийн хоол, хоолны цаг, орц найрлага. Харшлын анхааруулга доор нь харагдана."
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
 *
 * ★★ Always the editor, never a read-only view — unlike `child-menu.tsx`'s
 * `DayDetail`, which toggles between the two for a teacher. Entering the menu
 * is this screen's whole job; there is no "done reading" state for a cook to
 * fall back to, so `MenuDishEditor` renders with no `onCancel`.
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
  const [draftDishes, setDraftDishes] = useState<DishDraft[]>(() => toDraft(day?.dishes ?? []));
  const [dirty, setDirty] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}`, z.unknown(), {
        method: "PUT",
        body: { dishes: fromDraft(draftDishes) },
      }),
    onSuccess: () => {
      toast.success(`${weekday} гарагийн цэс хадгалагдлаа.`);
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: qk.weeklyMenu(kindergartenId, weekStart) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const warnings = day?.warnings ?? [];

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lead font-semibold text-ink">{weekday}</h2>
        <div className="flex items-center gap-2">
          {day && !dirty ? <Badge tone="mint">Хадгалагдсан</Badge> : null}
          <span className="text-caption text-muted">{formatDate(date)}</span>
        </div>
      </div>

      {/*
        ★ The cross-check, RFP Module 2 — and the reason this screen reads the
        staff route.

        A warning names a child and what they react to. It is shown to the
        person who can act on it and to nobody else: `menu/with-warnings` is a
        separate endpoint from the menu a parent reads for exactly this reason.
        It only ever fires once a dish below actually carries an allergen tag.
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

      <MenuDishEditor
        draftDishes={draftDishes}
        onChange={(next) => {
          setDraftDishes(next);
          setDirty(true);
        }}
        onSave={() => save.mutate()}
        saving={save.isPending}
        error={save.isError ? errorMessage(save.error) : null}
      />
    </Card>
  );
}
