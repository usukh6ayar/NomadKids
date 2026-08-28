"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Apple,
  ChevronLeft,
  ChevronRight,
  Cookie,
  Flame,
  Info,
  Plus,
  Soup,
  Sun,
  Trash2,
  Utensils,
  UtensilsCrossed,
} from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { MEAL_KIND_LABEL, menuDaySchema, type MealKind, type MenuDish } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { formatDayMonth, formatLongDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const menuSchema = z.array(menuDaySchema);

const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];
const MEAL_KIND_ORDER: MealKind[] = [
  "BREAKFAST",
  "MID_MORNING_SNACK",
  "LUNCH",
  "AFTERNOON_SNACK",
  "EXTRA",
];

/** One colour and icon per sitting, so the cards read as different things at a
 * glance rather than five identical white boxes with different headings. */
const MEAL_KIND_STYLE: Record<MealKind, { icon: ReactNode; tone: string }> = {
  BREAKFAST: { icon: <Sun size={22} aria-hidden="true" />, tone: "bg-sun text-sun-ink" },
  MID_MORNING_SNACK: {
    icon: <Apple size={22} aria-hidden="true" />,
    tone: "bg-primary-soft text-primary",
  },
  LUNCH: { icon: <UtensilsCrossed size={22} aria-hidden="true" />, tone: "bg-mint text-mint-ink" },
  AFTERNOON_SNACK: { icon: <Cookie size={22} aria-hidden="true" />, tone: "bg-peach text-peach-ink" },
  EXTRA: { icon: <Soup size={22} aria-hidden="true" />, tone: "bg-sky text-sky-ink" },
};

/** Monday of the week containing `date`, in UTC, as a `Date`. */
function mondayOf(date: Date): Date {
  const day = date.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + diff);
  return monday;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * 86_400_000);
}

/** Monday-first weekday index: 0 = Monday … 6 = Sunday. */
function mondayFirstIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * Which of a dish's declared allergen tags match a child's freeform health
 * notes — collected across every dish in one sitting, so a card names every
 * substance it should flag rather than only the first.
 *
 * ★ Best-effort, not a guarantee. There is no structured allergy field —
 * `Child.healthNotes` is free text — so this is a case-insensitive substring
 * match, deliberately conservative in what it claims. The UI says so.
 */
function matchedAllergens(dishes: MenuDish[], healthNotes: string | null | undefined): string[] {
  if (!healthNotes) return [];
  const notes = healthNotes.toLowerCase();
  const matched = new Set<string>();
  for (const dish of dishes) {
    for (const tag of dish.allergenTags) {
      if (notes.includes(tag.toLowerCase())) matched.add(tag);
    }
  }
  return [...matched];
}

function groupByKind(dishes: MenuDish[]): Partial<Record<MealKind, MenuDish[]>> {
  const groups: Partial<Record<MealKind, MenuDish[]>> = {};
  for (const dish of dishes) {
    const kind = dish.kind ?? "EXTRA";
    (groups[kind] ??= []).push(dish);
  }
  return groups;
}

/**
 * The "Хоол ба цэс" tab — RFP §989, plus `нэмэлт.md` §2's per-dish detail.
 *
 * ★ Kindergarten-wide, not child-scoped. The menu is the same for every
 * child at this kindergarten; what's specific to this child is only the
 * allergy cross-check, computed client-side against `healthNotes`.
 *
 * ★★ A week strip and one day's detail, not seven full cards stacked — see
 * git history for the original reasoning (this replaced seven always-open
 * `DayCard`s with the compact grid `AttendanceCalendar` already used).
 *
 * ★★★ Dishes group into sitting cards (Өглөөний цай / Үдийн хоол / …), each
 * with its own allergy badge and calorie/portion totals — 2026-08-28, once
 * `MenuDish` carried a `kind`, `calories` and `portions` of its own. Before
 * this, a day was one flat list with a single whole-day calorie figure typed
 * in separately from the dishes it was supposedly totalling; that field is
 * gone from the edit form now that the real total is summed from what staff
 * actually enter per dish.
 *
 * Whether a child *ate* what's shown here — `нэмэлт.md` §2's meal register
 * (`MealRecord`) — is recorded by staff on a separate, group-wide screen
 * (`/groups/[groupId]/meals`), the same way attendance and assessment are:
 * a teacher marks a whole sitting at once, not one child's menu page at a
 * time. The note below just says so.
 */
export function ChildMenu({
  kindergartenId,
  healthNotes,
  isStaff,
}: {
  kindergartenId: string;
  healthNotes: string | null | undefined;
  isStaff: boolean;
}) {
  const now = new Date();
  const todayIso = toIso(now);
  const tomorrow = addDays(now, 1);
  const tomorrowIso = toIso(tomorrow);

  const [monday, setMonday] = useState(() => mondayOf(now));
  // An offset into the week, not a stored date — so paging a week keeps the
  // same weekday selected (Wednesday stays Wednesday) instead of always
  // resetting to Monday.
  const [selectedOffset, setSelectedOffset] = useState(mondayFirstIndex(now));

  const weekDates = Array.from({ length: 7 }, (_, i) => toIso(addDays(monday, i)));
  const from = weekDates[0]!;
  const to = weekDates[6]!;
  const activeDate = weekDates[selectedOffset]!;

  // Derived from the selected date, not its own state — "Өнөөдөр" is
  // whichever segment matches what's actually showing, so paging the week
  // with the chevrons and landing back on today re-lights it on its own
  // instead of the two going out of sync.
  const quickView = activeDate === todayIso ? "today" : activeDate === tomorrowIso ? "tomorrow" : "week";

  const menu = useQuery({
    queryKey: ["kindergarten", kindergartenId, "menu", from, to],
    queryFn: () => get(`/kindergartens/${kindergartenId}/menu?from=${from}&to=${to}`, menuSchema),
  });

  if (menu.isPending) return <LoadingState rows={3} />;
  if (menu.isError) return <ErrorState description={errorMessage(menu.error)} />;

  // ★ `day.date` is a full ISO datetime from the API (`2026-08-27T00:00:00.000Z`),
  // not the plain `YYYY-MM-DD` this component works in — `attendance-calendar.tsx`
  // normalises the same way for the identical reason.
  const byDate = new Map(menu.data.map((day) => [day.date.slice(0, 10), day]));
  const hasAnyDish = menu.data.some((day) => day.dishes.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="menu-heading">
        <SectionHeader
          id="menu-heading"
          title="Долоо хоногийн цэс"
          lede={
            healthNotes
              ? "Эрүүл мэндийн тэмдэглэлтэй тохирсон орц бүхий хоол улаан тэмдгээр харагдана. Энэ бол баталгаат харшлын систем биш."
              : undefined
          }
          action={
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMonday((cur) => addDays(cur, -7))}
                aria-label="Өмнөх долоо хоног"
                className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className="min-w-[92px] text-center text-body font-medium text-ink">
                {formatDayMonth(from)}–{formatDayMonth(to)}
              </span>
              <button
                type="button"
                onClick={() => setMonday((cur) => addDays(cur, 7))}
                aria-label="Дараах долоо хоног"
                className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          }
        />

        {/*
          ★ A 3-way quick view, above the week nav rather than replacing it —
          "Өнөөдөр"/"Маргааш" jump straight to that day regardless of which
          week is currently open; "7 хоног" is not a third destination but a
          way back, resetting the open week to the current one without
          disturbing which weekday is selected.
        */}
        <div
          role="group"
          aria-label="Хугацаа сонгох"
          className="mb-3 grid grid-cols-3 gap-1 rounded-control bg-canvas p-1"
        >
          {(
            [
              ["today", "Өнөөдөр", () => { setMonday(mondayOf(now)); setSelectedOffset(mondayFirstIndex(now)); }],
              ["tomorrow", "Маргааш", () => { setMonday(mondayOf(tomorrow)); setSelectedOffset(mondayFirstIndex(tomorrow)); }],
              ["week", "7 хоног", () => setMonday(mondayOf(now))],
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

        <Card pad="roomy" className="flex flex-col gap-4">
          <div className="grid grid-cols-7 gap-1.5">
            {weekDates.map((date, i) => {
              const day = byDate.get(date);
              const filled = (day?.dishes.length ?? 0) > 0;
              const isToday = date === todayIso;
              const active = i === selectedOffset;

              return (
                <button
                  key={date}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${WEEKDAYS[i]}, ${formatDayMonth(date)}${filled ? " — цэстэй" : ""}`}
                  onClick={() => setSelectedOffset(i)}
                  className={cn(
                    "flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-row border px-1 py-2 text-caption font-semibold transition-colors",
                    active
                      ? "border-primary bg-primary-soft text-primary-strong"
                      : "border-border bg-surface text-ink hover:border-primary",
                    isToday && !active && "border-primary/50",
                  )}
                >
                  <span className="text-faint">{WEEKDAYS[i]}</span>
                  <span>{Number(date.slice(8, 10))}</span>
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 rounded-pill", filled ? "bg-mint" : "bg-transparent")}
                  />
                </button>
              );
            })}
          </div>

          {!isStaff && !hasAnyDish ? (
            <EmptyState
              icon={<Image src="/background/mascot-boy-orange.webp" alt="" width={96} height={96} />}
              title="Цэс оруулаагүй байна"
              description="Багш цэс оруулсны дараа энд харагдана."
            />
          ) : (
            <DayDetail
              kindergartenId={kindergartenId}
              date={activeDate}
              day={byDate.get(activeDate)}
              healthNotes={healthNotes}
              isStaff={isStaff}
            />
          )}
        </Card>
      </section>
    </div>
  );
}

/** The selected day's dishes — read, grouped by sitting, or (staff) edit. */
function DayDetail({
  kindergartenId,
  date,
  day,
  healthNotes,
  isStaff,
}: {
  kindergartenId: string;
  date: string;
  day?: z.infer<typeof menuDaySchema>;
  healthNotes: string | null | undefined;
  isStaff: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftDishes, setDraftDishes] = useState<DishDraft[]>(() => toDraft(day?.dishes ?? []));

  const save = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}`, menuDaySchema, {
        method: "PUT",
        body: { dishes: fromDraft(draftDishes) },
      }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["kindergarten", kindergartenId, "menu"] });
    },
  });

  const dishes = day?.dishes ?? [];
  const byKind = groupByKind(dishes);
  const kindsPresent = MEAL_KIND_ORDER.filter((kind) => (byKind[kind]?.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-ink">{formatLongDate(date)}</p>
        {isStaff && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraftDishes(toDraft(dishes));
              setEditing(true);
            }}
          >
            Засах
          </Button>
        ) : null}
      </div>

      {editing ? (
        <EditForm
          draftDishes={draftDishes}
          onChange={setDraftDishes}
          onSave={() => save.mutate()}
          onCancel={() => setEditing(false)}
          saving={save.isPending}
          error={save.isError ? errorMessage(save.error) : null}
        />
      ) : dishes.length === 0 ? (
        <p className="text-body text-muted">Хоол оруулаагүй.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {kindsPresent.map((kind) => (
            <MealCard key={kind} kind={kind} dishes={byKind[kind]!} healthNotes={healthNotes} />
          ))}

          {/*
            ★ Informational only, and only for a family — a teacher marks
            this on the meal register (`/groups/[groupId]/meals`), not here,
            so showing them the same note would point at a control that does
            not exist on this screen.
          */}
          {!isStaff ? (
            <div className="flex items-start gap-2.5 rounded-row border border-sky bg-sky/40 px-3.5 py-3">
              <Info size={18} className="mt-0.5 shrink-0 text-sky-ink" aria-hidden="true" />
              <p className="text-caption text-ink">
                Хүүхэд хоолноос татгалзсан эсэхийг багш тэмдэглэнэ.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * One sitting — an icon, its dishes, and what they add up to.
 *
 * ★ Portions is a representative figure, not a sum. Every dish in one
 * sitting is normally served at the same portion count (one breakfast is one
 * breakfast, however many components it has), so summing across dishes would
 * turn "1 порц" into "3 порц" for a three-dish breakfast — the first value
 * entered is what the card shows. Calories sum instead, because a meal's
 * energy really is the total of its dishes'.
 */
function MealCard({
  kind,
  dishes,
  healthNotes,
}: {
  kind: MealKind;
  dishes: MenuDish[];
  healthNotes: string | null | undefined;
}) {
  const style = MEAL_KIND_STYLE[kind];
  const allergens = matchedAllergens(dishes, healthNotes);
  const hasCalories = dishes.some((d) => d.calories !== null && d.calories !== undefined);
  const totalCalories = dishes.reduce((sum, d) => sum + (d.calories ?? 0), 0);
  const portions = dishes.find((d) => d.portions !== null && d.portions !== undefined)?.portions;
  const hasPortions = portions !== undefined;

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span
            className={cn("grid size-11 shrink-0 place-items-center rounded-control", style.tone)}
          >
            {style.icon}
          </span>
          <p className="font-semibold text-ink">{MEAL_KIND_LABEL[kind]}</p>
        </div>
        {allergens.length > 0 ? (
          <Badge tone="danger">⚠ {allergens.join(", ")} агуулсан</Badge>
        ) : null}
      </div>

      <ul className="flex flex-col gap-1 pl-1 text-body text-ink">
        {dishes.map((dish, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
            <span>• {dish.name}</span>
            {dish.ingredients ? (
              <span className="text-caption text-muted">{dish.ingredients}</span>
            ) : null}
          </li>
        ))}
      </ul>

      {hasCalories || hasPortions ? (
        <div className="flex flex-wrap gap-2">
          {hasCalories ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface px-2.5 py-1 text-caption font-medium text-ink">
              <Flame size={14} className="shrink-0 text-primary" aria-hidden="true" />
              {totalCalories} ккал
            </span>
          ) : null}
          {hasPortions ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface px-2.5 py-1 text-caption font-medium text-ink">
              <Utensils size={14} className="shrink-0 text-muted" aria-hidden="true" />
              {portions} порц
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ── Editing ──────────────────────────────────────────────────────────────────

interface DishDraft {
  /** Stable per-row identity for React's reconciliation — removing a middle
   * row must not shift focus onto whatever row inherits its array index. */
  key: string;
  name: string;
  kind: MealKind;
  allergenTags: string;
  ingredients: string;
  calories: string;
  portions: string;
}

function toDraft(dishes: MenuDish[]): DishDraft[] {
  return dishes.map((dish, i) => ({
    key: `${i}-${dish.name}`,
    name: dish.name,
    kind: dish.kind ?? "BREAKFAST",
    allergenTags: dish.allergenTags.join(", "),
    ingredients: dish.ingredients ?? "",
    calories: dish.calories === null || dish.calories === undefined ? "" : String(dish.calories),
    portions: dish.portions === null || dish.portions === undefined ? "" : String(dish.portions),
  }));
}

/** The inverse of `toDraft`. Blank names are dropped rather than saved as "". */
function fromDraft(drafts: DishDraft[]) {
  return drafts
    .filter((d) => d.name.trim())
    .map((d) => ({
      name: d.name.trim(),
      kind: d.kind,
      allergenTags: d.allergenTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      ingredients: d.ingredients.trim() || null,
      calories: d.calories.trim() ? Number(d.calories) : null,
      portions: d.portions.trim() ? Number(d.portions) : null,
    }));
}

function newDraft(kind: MealKind): DishDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    kind,
    allergenTags: "",
    ingredients: "",
    calories: "",
    portions: "",
  };
}

/**
 * A row per dish, structured rather than the free-text-with-a-parenthesis
 * syntax this used to be.
 *
 * ★ Replaced the single textarea on purpose. "Нэр (сүү, самар)" per line
 * worked when a dish was a name and a tag list; it has no honest way to also
 * carry which sitting a dish belongs to, its calories or its portion count
 * without inventing more punctuation a teacher has to remember the shape of.
 * A row of real fields is longer to build and shorter to use correctly.
 */
function EditForm({
  draftDishes,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  draftDishes: DishDraft[];
  onChange: (next: DishDraft[]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  function update(index: number, patch: Partial<DishDraft>) {
    onChange(draftDishes.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function remove(index: number) {
    onChange(draftDishes.filter((_, i) => i !== index));
  }

  function addRow() {
    const lastKind = draftDishes.at(-1)?.kind ?? "BREAKFAST";
    onChange([...draftDishes, newDraft(lastKind)]);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving) onSave();
      }}
      className="flex flex-col gap-3"
    >
      <FormError message={error} />

      {draftDishes.length === 0 ? (
        <p className="text-body text-muted">Хоол алга. Доор нэмнэ үү.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {draftDishes.map((dish, i) => (
            <Card key={dish.key} pad="compact" className="flex flex-col gap-2.5">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Хоолны нэр">
                    {({ id }) => (
                      <Input
                        id={id}
                        value={dish.name}
                        onChange={(e) => update(i, { name: e.target.value })}
                        autoFocus={i === draftDishes.length - 1}
                      />
                    )}
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Энэ хоолыг хасах"
                  onClick={() => remove(i)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Field label="Хоолны цаг">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={dish.kind}
                      onChange={(e) => update(i, { kind: e.target.value as MealKind })}
                    >
                      {MEAL_KIND_ORDER.map((kind) => (
                        <option key={kind} value={kind}>
                          {MEAL_KIND_LABEL[kind]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Илчлэг (ккал)">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={3000}
                      value={dish.calories}
                      onChange={(e) => update(i, { calories: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Порц">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      value={dish.portions}
                      onChange={(e) => update(i, { portions: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Харшлын орц" hint="Таслалаар тусгаарлана">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      placeholder="сүү, өндөг"
                      value={dish.allergenTags}
                      onChange={(e) => update(i, { allergenTags: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Button type="button" variant="secondary" size="sm" onClick={addRow} className="self-start">
        <Plus size={16} aria-hidden="true" />
        Хоол нэмэх
      </Button>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Цуцлах
        </Button>
      </div>
    </form>
  );
}
