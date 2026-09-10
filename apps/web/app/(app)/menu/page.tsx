"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, PackageMinus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import {
  ingredientUnitSchema,
  menuDayWithWarningsSchema,
  recipeSummarySchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import {
  MenuDishEditor,
  fromDraft,
  toDraft,
  type DishDraft,
  type RecipeOption,
} from "@/components/menu/menu-dish-editor";
import { useEsisFoodProducts } from "@/components/esis/use-esis-food-products";
import { formatDate, formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const weekSchema = z.array(menuDayWithWarningsSchema);
/*
 * ★ `mealKind` joined the picked fields on 2026-09-02 so the picker can group
 * its options by sitting. `listApprovedRecipes` has always selected it — the
 * client was simply throwing it away.
 */
const approvedRecipesSchema = z.array(
  recipeSummarySchema.pick({ id: true, name: true, yieldPortions: true, mealKind: true }),
);

/** `GET .../menu/:date/sufficiency` — this day's recipe-linked, portioned
 * dishes against current stock, using the exact deduction math `consume`
 * commits with. Only the ingredients actually required by the day appear. */
const sufficiencySchema = z.array(
  z.object({
    ingredient: z.object({ id: z.string(), name: z.string(), unit: ingredientUnitSchema }),
    required: z.string(),
    available: z.string(),
    sufficient: z.boolean(),
    shortfall: z.string().nullable(),
  }),
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

/** The first and last day of the calendar month `date` falls in — for the
 * "Сараар" export, always this month rather than whatever week is open. */
function monthRange(date: Date): { from: string; to: string } {
  const first = new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
  const last = new Date(Date.UTC(date.getFullYear(), date.getMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

const WEEKDAY_BY_INDEX = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

/** The Mongolian weekday name for any date — not just the Mon–Fri five the
 * week view sticks to, so "Өнөөдөр"/"Маргааш" still label themselves
 * correctly on a weekend. */
function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return WEEKDAY_BY_INDEX[d.getUTCDay()]!;
}

/** Monday-first weekday index for `iso`, clamped into the Mon–Fri range this
 * screen shows — a weekend date (Сар/Ба clicked "Маргааш" on a Friday) lands
 * on Friday rather than pointing at a day the strip has no button for. */
function weekdayOffset(iso: string): number {
  const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  return Math.min((day + 6) % 7, 4);
}

const WEEKDAYS_SHORT = ["Да", "Мя", "Лх", "Пү", "Ба"];

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

  // A constant, not state — there is no control left that moves it off "this
  // week" (the Өмнөх/Энэ долоо хоног/Дараах row was removed 2026-09-05; see
  // the header's own comment below).
  const weekStart = mondayOf(new Date());
  const weekDates = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
  // Its own state, not derived from `weekStart` — see `child-menu.tsx`'s
  // identical `quickView` for why: "7 хоног" is a way back to the current
  // week, not a third destination, and deriving this from the date would
  // make it do nothing when the open week already contains today.
  const [quickView, setQuickView] = useState<"today" | "tomorrow" | "week">("today");
  // Which weekday the "7 хоног" strip has open — an offset into `weekDates`,
  // not a stored date, the same reasoning `child-menu.tsx`'s `selectedOffset`
  // gives: it is what turns a week into one day's detail instead of five
  // full editors stacked and scrolled past to reach Friday.
  const [selectedOffset, setSelectedOffset] = useState(() => weekdayOffset(today));

  // The whole Mon–Fri range for "week" — the strip needs every day's
  // fill-state at once, not just the one currently open — versus a single
  // day for "today"/"tomorrow", which have no strip to feed.
  const from = quickView === "week" ? weekStart : quickView === "today" ? today : tomorrow;
  const to = quickView === "week" ? addDays(weekStart, 4) : from;
  // The one day actually rendered below: the strip's selection in "week",
  // otherwise whichever of "today"/"tomorrow" is active.
  const activeDate = quickView === "week" ? weekDates[selectedOffset]! : from;

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

  const weekEnd = addDays(weekStart, 4);
  const month = monthRange(new Date());

  /*
   * ★ One icon button, not three text ones — client request, 2026-09-05.
   *
   * The Өмнөх/Энэ долоо хоног/Дараах row that used to sit here duplicated the
   * tri-toggle below it (both moved between "today"/"this week") without
   * adding a destination of its own once "7 хоног" already means *this*
   * week — it was removed rather than kept for a "previous week" case
   * nothing else on the screen offers. This slot is Excel instead: the three
   * ranges from a fixed period each, not from whatever `quickView` happens to
   * be showing, same reasoning `menu-workbook.ts`'s doc comment gives.
   */
  const exportItems: MenuItem[] = kindergartenId
    ? [
        {
          href: downloadUrl(
            `/kindergartens/${kindergartenId}/menu/export?from=${today}&to=${today}`,
          ),
          label: "Өдрөөр",
          hint: formatDate(today),
        },
        {
          href: downloadUrl(
            `/kindergartens/${kindergartenId}/menu/export?from=${weekStart}&to=${weekEnd}`,
          ),
          label: "7 хоногоор",
          hint: `${formatDate(weekStart)} – ${formatDate(weekEnd)}`,
        },
        {
          href: downloadUrl(
            `/kindergartens/${kindergartenId}/menu/export?from=${month.from}&to=${month.to}`,
          ),
          label: "Сараар",
          hint: formatMonthLabel(month.from.slice(0, 7)),
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Долоо хоногийн цэс"
        actions={
          kindergartenId ? (
            <Menu
              variant="secondary"
              ariaLabel="Excel татах"
              items={exportItems}
              label={
                <>
                  <Download size={18} aria-hidden="true" />
                  <span className="sr-only">Excel татах</span>
                </>
              }
            />
          ) : null
        }
      />

      {/* Same 3-way quick view as a parent's own menu tab (`child-menu.tsx`)
          — "Өнөөдөр"/"Маргааш" jump straight to that day; "7 хоног" opens the
          Mon–Fri strip below, starting this Monday, the only week this
          screen shows now that there is no control left to move `weekStart`
          off it. */}
      <div
        role="group"
        aria-label="Хугацаа сонгох"
        className="grid grid-cols-3 gap-1 rounded-control bg-canvas p-1"
      >
        {(
          [
            [
              "today",
              "Өнөөдөр",
              () => {
                setSelectedOffset(weekdayOffset(today));
                setQuickView("today");
              },
            ],
            [
              "tomorrow",
              "Маргааш",
              () => {
                setSelectedOffset(weekdayOffset(tomorrow));
                setQuickView("tomorrow");
              },
            ],
            ["week", "7 хоног", () => setQuickView("week")],
          ] as const
        ).map(([value, label, onClick]) => (
          <button
            key={value}
            type="button"
            onClick={onClick}
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

      {/* The weekday strip is what "7 хоног" means — Өнөөдөр/Маргааш jump
          straight to a day without it, so it only shows once that's the
          actual quick view selected, same as `child-menu.tsx`. Picking a day
          here narrows the week down to that one day's card below instead of
          stacking all five and scrolling. */}
      {quickView === "week" ? (
        <div className="grid grid-cols-5 gap-1.5">
          {weekDates.map((date, i) => {
            const day = byDate.get(date);
            const filled = (day?.dishes.length ?? 0) > 0;
            const isToday = date === today;
            const active = i === selectedOffset;

            return (
              <button
                key={date}
                type="button"
                aria-pressed={active}
                aria-label={`${WEEKDAYS_SHORT[i]}, ${formatDate(date)}${filled ? " — цэстэй" : ""}`}
                onClick={() => setSelectedOffset(i)}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-row border px-1 py-2 text-caption font-semibold transition-colors",
                  active
                    ? "border-primary bg-primary-soft text-primary-strong"
                    : "border-border bg-surface text-ink hover:border-primary",
                  isToday && !active && "border-primary/50",
                )}
              >
                <span className="text-faint">{WEEKDAYS_SHORT[i]}</span>
                <span>{Number(date.slice(8, 10))}</span>
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 rounded-pill", filled ? "bg-mint" : "bg-transparent")}
                />
              </button>
            );
          })}
        </div>
      ) : null}

      {week.isLoading ? <LoadingState rows={1} /> : null}
      {week.isError ? <ErrorState description={errorMessage(week.error)} /> : null}

      {kindergartenId && !week.isLoading ? (
        <MenuDayCard
          key={activeDate}
          kindergartenId={kindergartenId}
          queryFrom={from}
          queryTo={to}
          date={activeDate}
          weekday={weekdayLabel(activeDate)}
          day={byDate.get(activeDate) ?? null}
          recipes={recipes.data ?? []}
          isKitchen={isKitchen}
        />
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
  const esisProducts = useEsisFoodProducts();
  const [draftDishes, setDraftDishes] = useState<DishDraft[]>(() => toDraft(day?.dishes ?? []));
  const [dirty, setDirty] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: qk.weeklyMenu(kindergartenId, queryFrom, queryTo),
    });
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

  /*
   * ★ Хангамжийн шалгалт — reads the exact numbers `consume` will deduct
   * with, not an estimate. Kitchen-only (the endpoint is COOK/ADMIN,
   * `assertCanManageKitchen`), so a teacher's screen never fires this query.
   * Skipped once the day is already consumed — the ledger is already the
   * fact by then, and a shortfall found afterward is a stock ADJUSTMENT, not
   * something this screen can still act on.
   */
  const sufficiency = useQuery({
    enabled: isKitchen && !isConsumed,
    queryKey: qk.kitchen.sufficiency(kindergartenId, date),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/menu/${date}/sufficiency`, sufficiencySchema),
  });
  const shortages = (sufficiency.data ?? []).filter((row) => !row.sufficient);

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

      {/*
        ★ Same shape as the allergy warning above, own colour — this is an
        operational shortage, not a safety warning, and the two must not read
        as the same kind of alert. `required`/`available` are already in the
        ingredient's own unit; no conversion happens anywhere in this module.
        ★★ Not just advisory since 2026-09-08 — `consume` actually refuses
        while any row here is short, so the wording says so rather than
        hedging with "may be".
      */}
      {shortages.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-row bg-sky/40 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-body font-medium text-sky-ink">
            <PackageMinus size={16} aria-hidden="true" />
            Нөөц хүрэлцэхгүй байна — хэрэглээ бүртгэх боломжгүй
          </p>
          <ul className="flex flex-col gap-1">
            {shortages.map((row) => (
              <li key={row.ingredient.id} className="text-caption text-sky-ink">
                {row.ingredient.name} — хэрэгтэй {row.required}, байгаа {row.available}
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
        /*
          ★ ESIS-ийн бэлэн бүтээгдэхүүн joins the same picker as the local
          cards — 2026-09-09, at the client's request ("тогоочийн хэсэгт бэлэн
          хоол сонгох хэсэгт API-г дуудах").

          `useEsisFoodProducts` reads the role-scoped catalog first, so a
          teacher opening this screen gets an empty list and a picker that
          looks exactly as it did before. Nothing here has to know that.
        */
        kitchen={{ kindergartenId, recipes, esisProducts }}
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

          {/* Зарцуулалт — deducts this day's cooking from stock. Disabled
              while a shortage is showing above: the server refuses the same
              way (2026-09-08), this just saves the round trip. */}
          {isApproved && !isConsumed ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={consume.isPending || shortages.length > 0}
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
