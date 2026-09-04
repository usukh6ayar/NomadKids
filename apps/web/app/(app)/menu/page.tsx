"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, PackageMinus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { menuDayWithWarningsSchema, recipeSummarySchema } from "@kinder/contracts";
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
import {
  MenuDishEditor,
  fromDraft,
  toDraft,
  type DishDraft,
  type RecipeOption,
} from "@/components/menu/menu-dish-editor";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const weekSchema = z.array(menuDayWithWarningsSchema);
const approvedRecipesSchema = z.array(
  recipeSummarySchema.pick({ id: true, name: true, yieldPortions: true }),
);

/** Today, as `YYYY-MM-DD`, in UTC — matches how every other date here is keyed. */
function todayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
}

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

const WEEKDAY_BY_INDEX = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

/** The Mongolian weekday name for any date — not just the Mon–Fri five the
 * week view sticks to, so "Өнөөдөр"/"Маргааш" still label themselves
 * correctly on a weekend. */
function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return WEEKDAY_BY_INDEX[d.getUTCDay()]!;
}

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
 * ★★★★ Every dish field, not just its name — fixed 2026-08-30. `PUT
 * .../menu/:date` **replaces** the day's dishes outright, so this screen and
 * `child-menu.tsx`'s own editor share one implementation
 * (`components/menu/menu-dish-editor.tsx`) rather than risk disagreeing
 * about what a full dish record looks like.
 *
 * ★★★★★ 2026-09-01 — a dish may point at an APPROVED технологийн карт
 * ("батлагдсан цэс") and carry a photo of the plated result. Both are
 * `MenuDishEditor`'s `kitchen` prop, which only this screen supplies —
 * technology cards are the kitchen's own planning concept, so `child-menu.tsx`'s
 * quick edit from inside a child's page does not offer to set one, though it
 * still preserves one that is already there (`DishDraft` round-trips it either
 * way). A recipe-linked dish's name/allergens/calories come frozen from the
 * recipe (`MealsService.saveDay` resolves them, not this screen), and its
 * `portions` is what `consume` scales the recipe's ingredients by when stock
 * is deducted.
 */
export default function MenuPage() {
  return (
    <RequireRole roles={["COOK", "TEACHER", "ADMIN"]}>
      <WeeklyMenu />
    </RequireRole>
  );
}

function WeeklyMenu() {
  const { session, hasRole } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const isKitchen = hasRole("COOK") || hasRole("ADMIN");

  const today = todayIso();
  const tomorrow = addDays(today, 1);

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  // Its own state, not derived from `weekStart` — see `child-menu.tsx`'s
  // identical `quickView` for why: "7 хоног" is a way back to the current
  // week, not a third destination, and deriving this from the date would
  // make it do nothing when the open week already contains today.
  const [quickView, setQuickView] = useState<"today" | "tomorrow" | "week">("today");

  const from = quickView === "week" ? weekStart : quickView === "today" ? today : tomorrow;
  const to = quickView === "week" ? addDays(weekStart, 4) : from;

  const week = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.weeklyMenu(kindergartenId ?? "", from, to),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/menu/with-warnings?from=${from}&to=${to}`, weekSchema),
  });

  const recipes = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kitchen.approvedRecipes(kindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${kindergartenId}/recipes/approved`, approvedRecipesSchema),
  });

  const byDate = new Map((week.data ?? []).map((day) => [day.date.slice(0, 10), day]));
  const weekDates = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Долоо хоногийн цэс"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setWeekStart(addDays(weekStart, -7));
                setQuickView("week");
              }}
            >
              Өмнөх
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setWeekStart(mondayOf(new Date()));
                setQuickView("week");
              }}
            >
              Энэ долоо хоног
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setWeekStart(addDays(weekStart, 7));
                setQuickView("week");
              }}
            >
              Дараах
            </Button>
          </div>
        }
      />

      {/* Same 3-way quick view as a parent's own menu tab
          (`child-menu.tsx`) — "Өнөөдөр"/"Маргааш" jump straight to that day
          regardless of which week the nav buttons above have open; "7 хоног"
          is the way back to the full Mon–Fri week. */}
      <div
        role="group"
        aria-label="Хугацаа сонгох"
        className="grid grid-cols-3 gap-1 rounded-control bg-canvas p-1"
      >
        {(
          [
            ["today", "Өнөөдөр"],
            ["tomorrow", "Маргааш"],
            ["week", "7 хоног"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setQuickView(value)}
            aria-pressed={quickView === value}
            className={cn(
              "min-h-[40px] rounded-control text-caption font-semibold transition-colors",
              quickView === value
                ? "bg-primary text-primary-ink shadow-sm"
                : "text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {week.isLoading ? <LoadingState rows={quickView === "week" ? 5 : 1} /> : null}
      {week.isError ? <ErrorState description={errorMessage(week.error)} /> : null}

      {kindergartenId && !week.isLoading ? (
        <div className="flex flex-col gap-4">
          {(quickView === "week" ? weekDates : [from]).map((date) => (
            <MenuDayCard
              key={date}
              kindergartenId={kindergartenId}
              queryFrom={from}
              queryTo={to}
              date={date}
              weekday={weekdayLabel(date)}
              day={byDate.get(date) ?? null}
              recipes={recipes.data ?? []}
              isKitchen={isKitchen}
            />
          ))}
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
  queryFrom,
  queryTo,
  date,
  weekday,
  day,
  recipes,
  isKitchen,
}: {
  kindergartenId: string;
  queryFrom: string;
  queryTo: string;
  date: string;
  weekday: string;
  day: z.infer<typeof menuDayWithWarningsSchema> | null;
  recipes: RecipeOption[];
  isKitchen: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draftDishes, setDraftDishes] = useState<DishDraft[]>(() => toDraft(day?.dishes ?? []));
  const [dirty, setDirty] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.weeklyMenu(kindergartenId, queryFrom, queryTo) });
  };

  const save = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}`, z.unknown(), {
        method: "PUT",
        body: { dishes: fromDraft(draftDishes) },
      }),
    onSuccess: () => {
      toast.success(`${weekday} гарагийн цэс хадгалагдлаа.`);
      setDirty(false);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const approve = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}/approve`, z.unknown(), {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success(`${weekday} гарагийн цэс батлагдлаа.`);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const consume = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}/consume`, z.unknown(), {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success(`${weekday} гарагийн хэрэглээ нөөцөд бүртгэгдлээ.`);
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "stock"] });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const warnings = day?.warnings ?? [];
  const isApproved = day?.status === "APPROVED";
  const isConsumed = Boolean(day?.consumedAt);

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lead font-semibold text-ink">
          {weekday}
          {day ? (
            <Badge tone={isApproved ? "mint" : "neutral"}>
              {isApproved ? "Батлагдсан" : "Ноорог"}
            </Badge>
          ) : null}
        </h2>
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
        kitchen={{ kindergartenId, recipes }}
      />

      {isKitchen ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border-soft pt-3">
          {/* Батлагдсан цэс — COOK/ADMIN only, and only once saved. */}
          {day && !dirty && !isApproved ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              {approve.isPending ? "Батлаж байна…" : "Батлах"}
            </Button>
          ) : null}

          {/* Зарцуулалт — deducts this day's cooking from stock. */}
          {isApproved && !isConsumed ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={consume.isPending}
              onClick={() => consume.mutate()}
            >
              <PackageMinus size={16} aria-hidden="true" />
              {consume.isPending ? "Бүртгэж байна…" : "Хэрэглээ бүртгэх"}
            </Button>
          ) : null}
          {isConsumed ? <Badge tone="sky">Нөөцөд бүртгэсэн</Badge> : null}
        </div>
      ) : null}
    </Card>
  );
}
