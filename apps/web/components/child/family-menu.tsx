"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Apple,
  CalendarDays,
  CalendarRange,
  Copy,
  FileSpreadsheet,
  Flame,
  Moon,
  Soup,
  PencilLine,
  Sun,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { MEAL_KIND_LABEL, type MealKind, type MenuDay, type MenuDish } from "@kinder/contracts";
import { MEAL_KIND_ORDER } from "@/components/menu/menu-dish-editor";
import { MediaThumb } from "@/components/media/media-image";
import { SingleImageUpload } from "@/components/media/single-image-upload";
import { RowMenu } from "@/components/ui/menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { formatDayMonth, formatLongDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The sitting's time of day.
 *
 * ★ A constant, and §2.3 says configuration belongs in a table — so this is a
 * deliberate exception with a short life expectancy.
 *
 * The client's 2026-09-11 design prints a time beside every sitting, and there
 * is nowhere in the product a kindergarten can set one: `MealKind` is an enum of
 * five sittings and carries no clock. Inventing a settings table they did not
 * ask for is the larger guess. The moment one kindergarten wants 08:00 this
 * becomes a column on a meal-times table and this map goes away — which is why
 * it is one object in one file rather than five strings scattered through the
 * markup.
 */
export const MEAL_KIND_TIME: Record<MealKind, string> = {
  BREAKFAST: "08:30",
  SNACK: "10:00",
  MID_MORNING_SNACK: "10:30",
  LUNCH: "12:30",
  AFTERNOON_SNACK: "15:00",
  EXTRA: "17:30",
};

/**
 * One colour and one glyph per sitting.
 *
 * ★ The tint washes the whole card, not just the icon — the client's design.
 *
 * Five white boxes with different headings is what this replaces: a parent
 * checking what their child eats at three o'clock finds the purple one without
 * reading anything. `dot` is the same meaning shrunk to a bullet for the week
 * table, where a full wash would make a grid unreadable.
 */
export const MEAL_KIND_STYLE: Record<
  MealKind,
  { icon: ReactNode; card: string; title: string; dot: string }
> = {
  BREAKFAST: {
    icon: <Sun size={18} aria-hidden="true" />,
    card: "bg-mint/40",
    title: "text-mint-ink",
    dot: "bg-mint-ink",
  },
  SNACK: {
    icon: <Apple size={18} aria-hidden="true" />,
    card: "bg-sun/30",
    title: "text-sun-ink",
    dot: "bg-sun-ink",
  },
  MID_MORNING_SNACK: {
    icon: <Apple size={18} aria-hidden="true" />,
    card: "bg-peach/40",
    title: "text-peach-ink",
    dot: "bg-peach-ink",
  },
  LUNCH: {
    icon: <UtensilsCrossed size={18} aria-hidden="true" />,
    card: "bg-sky/40",
    title: "text-sky-ink",
    dot: "bg-sky-ink",
  },
  AFTERNOON_SNACK: {
    icon: <Moon size={18} aria-hidden="true" />,
    card: "bg-cornflower/30",
    title: "text-cornflower-ink",
    dot: "bg-cornflower-ink",
  },
  EXTRA: {
    icon: <Soup size={18} aria-hidden="true" />,
    card: "bg-danger-soft",
    title: "text-danger",
    dot: "bg-danger",
  },
};

const WEEKDAY_NAME = ["Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба", "Ням"];

type View = "today" | "tomorrow" | "week";

/**
 * What a member of staff may do to a sitting without leaving the day.
 *
 * ★ The client's 2026-09-11 report: on the teacher's Өнөөдөр card they expect
 * "зураг оруулах, устгах 2 жижиг товч" on the picture and "засах, хуулах,
 * устгах" behind a ⋮ beside the time.
 *
 * ★★ Passed in, never derived here. This component is what a *parent* reads and
 * must stay exactly that for them — the client said so in as many words
 * ("эцэг эхийн хоолны цэсний харагдац огт өөрчлөгдөж болохгүй"). Omitted, not a
 * single one of these controls renders, and the markup is what it always was.
 */
export interface MenuRowActions {
  /**
   * Writes the sitting's dish names back.
   *
   * ★ Засах edits in place — 2026-09-11, at the client's request: "засах гэдэг
   * дээр дарахаар өөр цонх руу үсрэхгүй байх, бичвэрийг засаж болох болго."
   *
   * It opened the day's form, which is the right destination for portions,
   * calories and a технологийн карт and the wrong one for fixing a typo in
   * "Тарагтай мюсли". One line per dish, so a line added or removed adds or
   * removes one.
   */
  onSaveNames: (kind: MealKind, date: string, names: string[]) => void;
  /** Duplicates the sitting's dishes so the cook can re-time the copy. */
  onDuplicate: (kind: MealKind, date: string) => void;
  onDelete: (kind: MealKind, date: string) => void;
  /** `POST` target for a dish photograph — `SingleImageUpload`'s endpoint. */
  photoEndpoint: string;
  onPhotoUploaded: (kind: MealKind, date: string, mediaId: string) => void;
  onPhotoRemoved: (kind: MealKind, date: string) => void;
  /** Opens the compact add-meal form for this day. */
  onAdd?: (date: string) => void;
  /** Opens the Excel panel — drawn above the week table. */
  onImport: () => void;
}

/**
 * The family's view of the kitchen — the client's 2026-09-11 design.
 *
 * ★ Three destinations, not a calendar.
 *
 * The screen this replaces gave a parent a week strip, a pager over previous
 * weeks and a "Хоолны цаг" dropdown that scrolled to a card already on screen.
 * A family asks two questions — what is my child eating today, and what is
 * coming — so the design answers exactly those: today, tomorrow, and the week
 * laid out at once.
 *
 * ★★ Reading only. Editing stays on the staff path in `ChildMenu`, which is
 * untouched: the cook and the teacher need portions, calories, recipes and an
 * approve step, and none of that belongs on a parent's screen.
 */
export function FamilyMenu({
  byDate,
  weekDates,
  todayIso,
  tomorrowIso,
  healthNotes,
  actions,
}: {
  byDate: Map<string, MenuDay>;
  /** Monday-first, seven ISO dates. */
  weekDates: string[];
  todayIso: string;
  tomorrowIso: string;
  healthNotes: string | null | undefined;
  /** Staff controls on each sitting. Omitted for a family — see `MenuRowActions`. */
  actions?: MenuRowActions;
}) {
  const [view, setView] = useState<View>("today");
  /** Whether the week table's cells are editable — staff only, off by default. */
  const [editingWeek, setEditingWeek] = useState(false);
  const activeDate = view === "tomorrow" ? tomorrowIso : todayIso;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Цэсний харагдац" className="grid grid-cols-3 gap-2">
        <ViewTab current={view} value="today" onSelect={setView} icon={<CalendarDays size={16} />}>
          Өнөөдөр
        </ViewTab>
        <ViewTab
          current={view}
          value="tomorrow"
          onSelect={setView}
          icon={<CalendarRange size={16} />}
        >
          Маргааш
        </ViewTab>
        <ViewTab current={view} value="week" onSelect={setView}>
          7 хоног
        </ViewTab>
      </div>

      {view === "week" ? (
        <div role="tabpanel" aria-label="7 хоног" className="flex flex-col gap-2">
          {/*
            ★ Excel оруулах and Засах above the week — 2026-09-11, at the
            client's request, and Засах edits the table itself rather than
            sending anyone to another screen.
          */}
          {actions ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="border-mint bg-mint/30 text-mint-ink hover:bg-mint/50"
                onClick={actions.onImport}
              >
                <FileSpreadsheet size={16} aria-hidden="true" />
                Excel оруулах
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditingWeek((current) => !current)}
                aria-pressed={editingWeek}
              >
                <PencilLine size={16} aria-hidden="true" />
                {editingWeek ? "Засварыг хаах" : "Засах"}
              </Button>
            </div>
          ) : null}

          <WeekTable
            byDate={byDate}
            weekDates={weekDates}
            todayIso={todayIso}
            onSaveCell={editingWeek && actions ? actions.onSaveNames : undefined}
          />
        </div>
      ) : (
        <div role="tabpanel" aria-label={view === "today" ? "Өнөөдөр" : "Маргааш"}>
          <DayView
            date={activeDate}
            day={byDate.get(activeDate)}
            healthNotes={healthNotes}
            actions={actions}
            allowAdd={view === "today"}
          />
        </div>
      )}
    </div>
  );
}

function ViewTab({
  current,
  value,
  onSelect,
  icon,
  children,
}: {
  current: View;
  value: View;
  onSelect: (next: View) => void;
  icon?: ReactNode;
  children: string;
}) {
  const active = current === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(value)}
      className={cn(
        "flex min-h-[48px] items-center justify-center gap-2 rounded-card px-2 text-body font-semibold transition-colors",
        active
          ? "bg-primary text-primary-ink shadow-sm"
          : "bg-canvas text-muted hover:bg-border-soft hover:text-ink",
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** One day: the date, then a card per sitting. */
function DayView({
  date,
  day,
  healthNotes,
  actions,
  allowAdd,
}: {
  date: string;
  day?: MenuDay;
  healthNotes: string | null | undefined;
  actions?: MenuRowActions;
  allowAdd?: boolean;
}) {
  const dishes = day?.dishes ?? [];
  const kinds = MEAL_KIND_ORDER.filter((kind) => dishesOf(dishes, kind).length > 0);

  return (
    /*
      ★ This one does not clip either, for the same reason: a menu opened on
      the last sitting would be cut by the day's own box. The header's rule is
      a border rather than a filled band, so there is nothing here that needed
      the corners clipped.
    */
    <div className="rounded-card border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
          <CalendarDays size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-ink">{formatLongDate(date)}</p>
          <p className="text-caption text-muted">{WEEKDAY_NAME[weekdayIndex(date)]} гараг</p>
        </div>
        {actions?.onAdd && allowAdd ? (
          <Button
            className="ml-auto shrink-0"
            size="icon"
            aria-label="Хоол нэмэх"
            title="Хоол нэмэх"
            onClick={() => actions.onAdd?.(date)}
          >
            <span className="text-lead leading-none" aria-hidden="true">
              +
            </span>
          </Button>
        ) : null}
      </div>

      {kinds.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="Цэс оруулаагүй байна"
            description="Багш цэс оруулсны дараа энд харагдана."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2 p-2">
          {kinds.map((kind) => (
            <li key={kind}>
              <MealRow
                kind={kind}
                date={date}
                dishes={dishesOf(dishes, kind)}
                healthNotes={healthNotes}
                actions={actions}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MealRow({
  kind,
  date,
  dishes,
  healthNotes,
  actions,
}: {
  kind: MealKind;
  date: string;
  dishes: MenuDish[];
  healthNotes: string | null | undefined;
  actions?: MenuRowActions;
}) {
  const style = MEAL_KIND_STYLE[kind];
  const photo = dishes.find((dish) => dish.photoMediaFileId)?.photoMediaFileId;
  const allergens = matchedAllergens(dishes, healthNotes);

  /**
   * The dish names being edited, one per line — or `null` while reading.
   *
   * ★ A textarea rather than an input per dish. The list *is* lines of text:
   * adding a dish is pressing Enter, removing one is deleting a line, and on a
   * phone that beats a column of little fields with their own add and remove
   * buttons beside each.
   */
  const [editingNames, setEditingNames] = useState<string | null>(null);

  /*
    ★ The sitting's energy, shown to the family — 2026-09-11, at the client's
    request: "хоол дээр килокалори нь харагдах ёстой."

    Summed across the sitting rather than printed per dish: a parent asks what
    the meal came to, and five numbers down the side of a card is a table nobody
    reads. Drawn only when the kitchen actually entered one — a bare "0 ккал"
    on a menu whose calories were never filled in is worse than silence.
  */
  const calories = dishes.reduce((sum, dish) => sum + (dish.calories ?? 0), 0);
  const hasCalories = dishes.some((dish) => dish.calories !== null && dish.calories !== undefined);

  return (
    /*
      ★ No `overflow-hidden` on this card — 2026-09-11, the client: "засах
      харагдаад устгах харагдахгүй байна."

      It was here to clip the photograph's corners, and it clipped the row
      menu with them: the card is 88px tall and the popup is about 150, so
      Засах showed and Хуулах and Устгах were cut off below the edge. On a
      phone that is the whole menu gone but its first line. The photograph
      rounds its own corners now, which is the only thing the clip was for.
    */
    <Card pad="none" className={cn("flex items-stretch gap-3", style.card)}>
      <div className="relative size-[88px] shrink-0 overflow-hidden rounded-l-card">
        {photo ? (
          <MediaThumb mediaId={photo} caption={dishes[0]?.name} flush className="size-[88px]" />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-[88px] place-items-center bg-surface/60 text-muted"
          >
            <UtensilsCrossed size={22} />
          </span>
        )}

        {/*
          ★ Two small buttons on the picture — the client's 2026-09-11 report.

          A teacher looking at today wants the photograph of today's breakfast
          on it; making them open the day's form to attach one is three presses
          for what is one. Устгах appears only when there is something to
          remove.
        */}
        {/*
          ★ 32px, not the 44px floor §5 asks for — a deliberate exception, and
          the only one on this card.

          Two 44px targets plus a gap is 92px across an 88px photograph: the
          controls would cover the thing they act on, which is the failure the
          floor exists to prevent, arrived at from the other side. 32px with
          `touch-manipulation` is the largest pair that leaves the picture
          readable, and the same two actions are also on the day's form at full
          size — this is the shortcut, not the only route.
        */}
        {actions ? (
          <div className="absolute inset-x-1 bottom-1 flex touch-manipulation items-center justify-center gap-1.5">
            <SingleImageUpload
              endpoint={actions.photoEndpoint}
              currentMediaId={photo ?? null}
              label={photo ? "Зураг солих" : "Зураг нэмэх"}
              alt={`${MEAL_KIND_LABEL[kind]} зураг`}
              hidePreview
              compactIcon
              onUploaded={(media) => actions.onPhotoUploaded(kind, date, media.id)}
            />
            {photo ? (
              <button
                type="button"
                aria-label={`${MEAL_KIND_LABEL[kind]} — зургийг устгах`}
                onClick={() => actions.onPhotoRemoved(kind, date)}
                className="grid size-8 place-items-center rounded-control bg-ink/70 text-white transition-colors hover:bg-danger"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1 py-2.5 pr-3">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("flex min-w-0 items-center gap-1.5 font-semibold", style.title)}>
            <span className="shrink-0">{style.icon}</span>
            <span className="truncate">{MEAL_KIND_LABEL[kind]}</span>
          </p>
          <span className="flex shrink-0 flex-col items-end">
            <span className="text-caption font-semibold tabular-nums text-muted">
              {dishes.find((dish) => dish.time)?.time ?? MEAL_KIND_TIME[kind]}
            </span>
            {hasCalories ? (
              <span className="inline-flex items-center gap-1 text-caption tabular-nums text-muted">
                <Flame size={12} aria-hidden="true" className="text-primary" />
                {calories} ккал
              </span>
            ) : null}
          </span>

          {/* ★ Засах · Хуулах · Устгах, beside the time — the client's report. */}
          {actions ? (
            <RowMenu
              ariaLabel={`${MEAL_KIND_LABEL[kind]} — үйлдэл`}
              items={[
                {
                  label: "Засах",
                  icon: <PencilLine size={16} aria-hidden="true" />,
                  onSelect: () => setEditingNames(dishes.map((dish) => dish.name).join("\n")),
                },
                {
                  label: "Хуулах",
                  icon: <Copy size={16} aria-hidden="true" />,
                  hint: "Хоолны цагийг хувилж, дараа нь цагийг нь солино",
                  onSelect: () => actions.onDuplicate(kind, date),
                },
                {
                  label: "Устгах",
                  icon: <Trash2 size={16} aria-hidden="true" />,
                  tone: "danger" as const,
                  separated: true,
                  onSelect: () => actions.onDelete(kind, date),
                },
              ]}
            />
          ) : null}
        </div>

        {editingNames === null ? (
          <ul className="mt-1 flex flex-col gap-0.5">
            {dishes.map((dish, index) => (
              <li key={index} className="flex gap-1.5 text-caption leading-snug text-ink">
                <span aria-hidden="true" className="text-faint">
                  •
                </span>
                <span className="min-w-0">{dish.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <Textarea
              aria-label={`${MEAL_KIND_LABEL[kind]} — хоолны нэрс`}
              rows={Math.max(2, editingNames.split("\n").length)}
              value={editingNames}
              autoFocus
              onChange={(event) => setEditingNames(event.target.value)}
            />
            <p className="text-caption text-muted">Мөр тутамд нэг хоол.</p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                onClick={() => {
                  actions?.onSaveNames(
                    kind,
                    date,
                    editingNames
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  );
                  setEditingNames(null);
                }}
              >
                Хадгалах
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditingNames(null)}>
                Болих
              </Button>
            </div>
          </div>
        )}

        {allergens.length > 0 ? (
          <Badge tone="danger" className="mt-1.5">
            ⚠ {allergens.join(", ")} агуулсан
          </Badge>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * The week at once — sittings down the side, days across the top.
 *
 * ★ Exported since 2026-09-11 — the staff menu screen's "Хүснэгтээр" view is
 * this exact table, and a second copy would be a second chance for the two to
 * disagree about what a week looks like.
 *
 * ★★ It scrolls inside its own box rather than widening the page.
 *
 * Seven days of dish names does not fit a phone and never will. The first
 * column is sticky so a parent scrolling to Ням still knows which sitting they
 * are reading, which is the whole reason a table beats seven stacked days here.
 */
export function WeekTable({
  byDate,
  weekDates,
  todayIso,
  onSaveCell,
}: {
  byDate: Map<string, MenuDay>;
  weekDates: string[];
  todayIso: string;
  /**
   * Makes each cell editable. Given, a cell is a text box of comma-separated
   * dish names that writes back on blur; omitted, the table is what it was.
   *
   * ★ On blur rather than behind a Хадгалах: a week is thirty-five cells, and
   * one save button for all of them is either thirty-five requests on one press
   * or a diff nobody can see. Leaving a cell is the smallest edit there is.
   */
  onSaveCell?: (kind: MealKind, date: string, names: string[]) => void;
}) {
  const kinds = MEAL_KIND_ORDER.filter((kind) =>
    weekDates.some((date) => dishesOf(byDate.get(date)?.dishes ?? [], kind).length > 0),
  );

  if (kinds.length === 0) {
    return (
      <EmptyState
        title="Энэ долоо хоногт цэс оруулаагүй байна"
        description="Багш цэс оруулсны дараа энд харагдана."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-caption">
        <caption className="sr-only">Долоо хоногийн цэс</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="sticky left-0 z-10 bg-canvas px-3 py-2.5 text-left text-ink">
              Хоолны цаг
            </th>
            {weekDates.map((date, index) => (
              <th
                key={date}
                scope="col"
                className={cn(
                  "px-2 py-2.5 text-center font-semibold",
                  date === todayIso ? "bg-primary-soft text-primary" : "bg-canvas text-ink",
                )}
              >
                <span className="block tabular-nums">{formatDayMonth(date)}</span>
                <span className="block text-faint">{WEEKDAY_NAME[index]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {kinds.map((kind) => (
            <tr key={kind} className="border-b border-border-soft last:border-0">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-surface px-3 py-2.5 text-left align-top font-medium text-ink"
              >
                <span className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("mt-1 size-2 shrink-0 rounded-pill", MEAL_KIND_STYLE[kind].dot)}
                  />
                  <span className="min-w-0">
                    <span className="block">{MEAL_KIND_LABEL[kind]}</span>
                    <span className="block tabular-nums text-muted">
                      {weekDates
                        .flatMap((date) => dishesOf(byDate.get(date)?.dishes ?? [], kind))
                        .find((dish) => dish.time)?.time ?? MEAL_KIND_TIME[kind]}
                    </span>
                  </span>
                </span>
              </th>

              {weekDates.map((date) => {
                const named = dishesOf(byDate.get(date)?.dishes ?? [], kind);
                const hasCalories = named.some(
                  (dish) => dish.calories !== null && dish.calories !== undefined,
                );
                const calories = named.reduce((sum, dish) => sum + (dish.calories ?? 0), 0);

                return (
                  <td
                    key={date}
                    className={cn(
                      "border-l border-border-soft px-2 py-2.5 text-center align-top leading-snug text-ink",
                      date === todayIso && "bg-primary-soft/40",
                    )}
                  >
                    {onSaveCell ? (
                      <CellEditor
                        value={named.map((dish) => dish.name).join(", ")}
                        label={`${formatDayMonth(date)} · ${MEAL_KIND_LABEL[kind]}`}
                        onCommit={(text) =>
                          onSaveCell(
                            kind,
                            date,
                            text
                              .split(",")
                              .map((part) => part.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                    ) : named.length > 0 ? (
                      <span className="flex flex-col items-center gap-1">
                        <span>{named.map((dish) => dish.name).join(", ")}</span>
                        {hasCalories ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-faint">
                            <Flame size={11} aria-hidden="true" className="text-primary" />
                            {calories} ккал
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A sitting's dishes.
 *
 * ★ `kind` is nullish on rows written before sittings existed, and those fall
 * to breakfast rather than disappearing — the same call `groupByKind` in
 * `child-menu.tsx` makes, so the two views of one day cannot disagree about
 * which card an old dish belongs on.
 */
function dishesOf(dishes: MenuDish[], kind: MealKind): MenuDish[] {
  return dishes.filter((dish) => (dish.kind ?? "BREAKFAST") === kind);
}

/** Monday-first: 0 = Monday … 6 = Sunday. */
function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Which allergen tags match the child's health notes — best-effort, and the
 * screen says so. Lifted from `child-menu.tsx` unchanged so the family card and
 * the staff card flag the same substances.
 */
function matchedAllergens(dishes: MenuDish[], healthNotes: string | null | undefined): string[] {
  if (!healthNotes) return [];
  const notes = healthNotes.toLowerCase();
  const hits = new Set<string>();

  for (const dish of dishes) {
    for (const tag of dish.allergenTags) {
      if (tag && notes.includes(tag.toLowerCase())) hits.add(tag);
    }
  }

  return [...hits];
}

/**
 * One cell of the editable week — comma-separated dish names.
 *
 * ★ Committed on blur, and only when it changed.
 *
 * Typing in a cell must not fire a request per keystroke, and a week of
 * thirty-five cells cannot wait behind one Хадгалах without either sending
 * thirty-five requests at once or hiding what is about to be saved. Leaving the
 * cell is the edit; unchanged text writes nothing.
 */
function CellEditor({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // The server's value wins when it changes — a refetch after somebody else's
  // edit must not be overwritten by a stale local string.
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() === value.trim()) return;
        onCommit(draft);
      }}
      placeholder="—"
      className="w-full rounded-control border border-border bg-surface px-1.5 py-1 text-center text-caption text-ink focus:border-primary focus:outline-none"
    />
  );
}
