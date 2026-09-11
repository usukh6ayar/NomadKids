"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Apple,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cookie,
  Flame,
  Info,
  Soup,
  Sun,
  Utensils,
  UtensilsCrossed,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { menuDaySchema, MEAL_KIND_LABEL, type MealKind, type MenuDish } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import {
  MEAL_KIND_ORDER,
  MenuDishEditor,
  fromDraft,
  toDraft,
  type DishDraft,
} from "@/components/menu/menu-dish-editor";
import { FamilyMenu } from "@/components/child/family-menu";
import { MenuNoteBox } from "@/components/child/menu-note-box";
import { formatDayMonth, formatLongDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const menuSchema = z.array(menuDaySchema);

const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

/** One colour and icon per sitting, so the cards read as different things at a
 * glance rather than five identical white boxes with different headings. */
const MEAL_KIND_STYLE: Record<MealKind, { icon: ReactNode; tone: string }> = {
  BREAKFAST: { icon: <Sun size={22} aria-hidden="true" />, tone: "bg-sun text-sun-ink" },
  MID_MORNING_SNACK: {
    icon: <Apple size={22} aria-hidden="true" />,
    tone: "bg-primary-soft text-primary",
  },
  LUNCH: { icon: <UtensilsCrossed size={22} aria-hidden="true" />, tone: "bg-mint text-mint-ink" },
  AFTERNOON_SNACK: {
    icon: <Cookie size={22} aria-hidden="true" />,
    tone: "bg-peach text-peach-ink",
  },
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
  childId,
  healthNotes,
  isStaff,
}: {
  kindergartenId: string;
  /**
   * Whose menu this is.
   *
   * ★ Optional, because the cook's own `(app)/menu` screen has no child at all —
   * it edits the kindergarten's week. Without one the family footer is not
   * drawn, which is right: a note box needs a child to be about.
   */
  childId?: string;
  healthNotes: string | null | undefined;
  isStaff: boolean;
}) {
  const now = new Date();
  const todayIso = toIso(now);
  const tomorrow = addDays(now, 1);

  const [monday, setMonday] = useState(() => mondayOf(now));
  // An offset into the week, not a stored date — so paging a week keeps the
  // same weekday selected (Wednesday stays Wednesday) instead of always
  // resetting to Monday.
  const [selectedOffset, setSelectedOffset] = useState(mondayFirstIndex(now));
  // ★ Its own state, not derived from `activeDate` — "7 хоног" only reveals
  // the weekday strip, it does not have to move `activeDate` off today's
  // date to do it. Deriving this from the date meant pressing "7 хоног"
  // while still viewing today did nothing, because the date it would have
  // matched against had not changed. Paging the week with the chevrons still
  // switches into "week" (below), so landing back on today via the strip
  // itself reads the same as it always did.
  const [quickView, setQuickView] = useState<"today" | "tomorrow" | "week">("today");

  const weekDates = Array.from({ length: 7 }, (_, i) => toIso(addDays(monday, i)));
  const from = weekDates[0]!;
  const to = weekDates[6]!;
  const activeDate = weekDates[selectedOffset]!;

  const menu = useQuery({
    queryKey: ["kindergarten", kindergartenId, "menu", from, to],
    queryFn: () => get(`/kindergartens/${kindergartenId}/menu?from=${from}&to=${to}`, menuSchema),
  });

  if (menu.isPending) return <LoadingState rows={3} />;
  if (menu.isError) return <ErrorState description={errorMessage(menu.error)} />;

  /*
    ★ A family gets a different screen entirely — 2026-09-11, the client's
    design: "эцэг дээр хоол ийм байна өмнөх загвар арилгаад ийм болго".

    Not a narrowed version of this one. The staff screen is a week pager over an
    editable day, and the questions a parent has are "what is my child eating
    today" and "what is coming" — so `FamilyMenu` answers those three (today,
    tomorrow, the week as a table) and carries none of the pager, the weekday
    strip, the "Хоолны цаг" jump list or the editor.

    Everything below this line is the staff path, unchanged.
  */
  if (!isStaff) {
    const family = new Map(menu.data.map((day) => [day.date.slice(0, 10), day]));

    return (
      <FamilyMenu
        byDate={family}
        weekDates={weekDates}
        todayIso={todayIso}
        tomorrowIso={toIso(tomorrow)}
        healthNotes={healthNotes}
        footer={childId ? <MenuNoteBox childId={childId} date={todayIso} /> : null}
      />
    );
  }

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
                onClick={() => {
                  setMonday((cur) => addDays(cur, -7));
                  setQuickView("week");
                }}
                aria-label="Өмнөх долоо хоног"
                className="grid size-11 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className="min-w-[92px] text-center text-body font-medium text-ink">
                {formatDayMonth(from)}–{formatDayMonth(to)}
              </span>
              <button
                type="button"
                onClick={() => {
                  setMonday((cur) => addDays(cur, 7));
                  setQuickView("week");
                }}
                aria-label="Дараах долоо хоног"
                className="grid size-11 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
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
              [
                "today",
                "Өнөөдөр",
                () => {
                  setMonday(mondayOf(now));
                  setSelectedOffset(mondayFirstIndex(now));
                  setQuickView("today");
                },
              ],
              [
                "tomorrow",
                "Маргааш",
                () => {
                  setMonday(mondayOf(tomorrow));
                  setSelectedOffset(mondayFirstIndex(tomorrow));
                  setQuickView("tomorrow");
                },
              ],
              [
                "week",
                "7 хоног",
                () => {
                  setMonday(mondayOf(now));
                  setQuickView("week");
                },
              ],
            ] as const
          ).map(([value, label, onClick]) => (
            <button
              key={value}
              type="button"
              onClick={onClick}
              aria-pressed={quickView === value}
              className={cn(
                "min-h-[44px] rounded-control text-caption font-semibold transition-colors",
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
          {/* The weekday strip is what "7 хоног" means — Өнөөдөр/Маргааш
              jump straight to a day without it, so it only shows once that's
              the actual quick view selected. */}
          {quickView === "week" ? (
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
          ) : null}

          {!isStaff && !hasAnyDish ? (
            <EmptyState
              icon={
                <Image src="/background/mascot-boy-orange.webp" alt="" width={96} height={96} />
              }
              title="Цэс оруулаагүй байна"
              description="Багш цэс оруулсны дараа энд харагдана."
            />
          ) : (
            <DayDetail
              key={activeDate}
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
  // The sitting picked in the "Хоолны цаг" dropdown below — every sitting's
  // card is always on screen, this just says which one to jump to and
  // highlight. Reset by React itself — `ChildMenu` keys this component on
  // `date`, so switching days remounts it rather than carrying a highlight
  // over to a day that may not have that sitting at all.
  const [pickedKind, setPickedKind] = useState<MealKind | null>(null);
  const cardRefs = useRef<Partial<Record<MealKind, HTMLDivElement | null>>>({});

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

  function jumpTo(kind: MealKind) {
    setPickedKind(kind);
    cardRefs.current[kind]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

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
        <MenuDishEditor
          draftDishes={draftDishes}
          onChange={setDraftDishes}
          onSave={() => save.mutate()}
          onCancel={() => setEditing(false)}
          saving={save.isPending}
          error={save.isError ? errorMessage(save.error) : null}
          /*
            ★ The photo control, on the teacher's quick edit too — 2026-09-11,
            at the client's request: "зураг оруулж болдог болго."

            `kitchen` used to be omitted here entirely, which turned off the
            технологийн карт picker *and* the dish photograph together. The
            recipe picker is still off — those are the kitchen's own planning
            documents and a teacher fixing a typo has no business choosing one —
            so `recipes` is empty and the photo is what this turns on.

            The upload is authorised by `assertCanEditMenu`, the same check that
            lets this screen save at all, so a teacher who can reach this form
            can reach the upload behind it.
          */
          kitchen={{ kindergartenId, recipes: [] }}
        />
      ) : dishes.length === 0 ? (
        <p className="text-body text-muted">Хоол оруулаагүй.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <MealTimePicker kinds={kindsPresent} selected={pickedKind} onSelect={jumpTo} />

          {kindsPresent.map((kind) => (
            <div
              key={kind}
              ref={(el) => {
                cardRefs.current[kind] = el;
              }}
            >
              <MealCard
                kind={kind}
                dishes={byKind[kind]!}
                healthNotes={healthNotes}
                highlighted={kind === pickedKind}
              />
            </div>
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
 * "Хоолны цаг" — narrows a day down to one sitting at a time rather than
 * stacking every `MealCard` the day has. Hand-written rather than pulling in
 * a Radix menu, the same call `components/ui/menu.tsx` makes for its own
 * dropdown: a handful of in-page choices does not earn the dependency, but
 * still gets the same accessibility contract — `aria-haspopup`/`aria-expanded`
 * on the trigger, `role="menu"`/`menuitem` on the list, outside-press and
 * Escape to close.
 */
function MealTimePicker({
  kinds,
  selected,
  onSelect,
}: {
  kinds: MealKind[];
  selected: MealKind | null;
  onSelect: (kind: MealKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center justify-between gap-2 rounded-row border border-border bg-surface px-3.5 py-2.5 text-left hover:border-primary"
      >
        <span className="text-body text-ink">
          <span className="font-semibold">Хоолны цаг</span>
          {selected ? <span className="text-muted"> — {MEAL_KIND_LABEL[selected]}</span> : null}
        </span>
        <ChevronDown
          size={18}
          className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Хоолны цаг сонгох"
          className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-row border border-border bg-surface py-1 shadow-[0_8px_28px_rgba(15,23,42,.12)]"
        >
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              aria-current={kind === selected}
              onClick={() => {
                onSelect(kind);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-body hover:bg-canvas focus:bg-canvas focus:outline-none",
                kind === selected ? "font-semibold text-primary" : "text-ink",
              )}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-control",
                  MEAL_KIND_STYLE[kind].tone,
                )}
              >
                {MEAL_KIND_STYLE[kind].icon}
              </span>
              {MEAL_KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      ) : null}
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
  highlighted,
}: {
  kind: MealKind;
  dishes: MenuDish[];
  healthNotes: string | null | undefined;
  /** Just jumped to from the "Хоолны цаг" dropdown — a ring, not a filter,
   * since every sitting's card stays on screen either way. */
  highlighted?: boolean;
}) {
  const style = MEAL_KIND_STYLE[kind];
  const allergens = matchedAllergens(dishes, healthNotes);
  const hasCalories = dishes.some((d) => d.calories !== null && d.calories !== undefined);
  const totalCalories = dishes.reduce((sum, d) => sum + (d.calories ?? 0), 0);
  const portions = dishes.find((d) => d.portions !== null && d.portions !== undefined)?.portions;
  const hasPortions = portions !== undefined;

  return (
    <Card
      pad="roomy"
      className={cn(
        "flex flex-col gap-3 transition-shadow",
        highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-canvas",
      )}
    >
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

// Dish drafting/editing lives in `components/menu/menu-dish-editor.tsx` now —
// `MenuDishEditor`, `DishDraft`, `toDraft`, `fromDraft` — shared with the
// Тогооч role's own `(app)/menu/page.tsx`, which needs the exact same fields.
