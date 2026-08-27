"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { z } from "zod";
import { menuDaySchema, type MenuDish } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { formatDayMonth, formatLongDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const menuSchema = z.array(menuDaySchema);

const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

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

/**
 * Whether a dish's declared allergen tags match anything in a child's
 * freeform health notes.
 *
 * ★ Best-effort, not a guarantee. There is no structured allergy field —
 * `Child.healthNotes` is free text — so this is a case-insensitive substring
 * match, deliberately conservative in what it claims. The UI says so.
 */
function matchesHealthNotes(dish: MenuDish, healthNotes: string | null | undefined): boolean {
  if (!healthNotes || dish.allergenTags.length === 0) return false;
  const notes = healthNotes.toLowerCase();
  return dish.allergenTags.some((tag) => notes.includes(tag.toLowerCase()));
}

/**
 * The "Хоол ба цэс" tab — RFP §989.
 *
 * ★ Kindergarten-wide, not child-scoped. The menu is the same for every
 * child at this kindergarten; what's specific to this child is only the
 * allergy cross-check, computed client-side against `healthNotes`.
 *
 * ★★ A week strip and one day's detail, not seven full cards stacked.
 *
 * The previous version rendered all seven `DayCard`s open at once — correct
 * data, but a phone screen of "2026.08.24 / Хоол оруулаагүй" repeated seven
 * times before a parent reached anything to actually read. A week is a row
 * you scan, not a list you scroll; `AttendanceCalendar`
 * (`attendance-calendar.tsx`) already made the same call for the month view,
 * so this reuses its shape — a compact grid of days, one open detail below
 * it — rather than inventing a second pattern for the other date-scoped tab.
 *
 * ★★★ Week navigation is new, not cosmetic. The old version could only ever
 * show `weekStart()` — literally the current week — with no way to look
 * ahead or back, so a teacher entering next week's menu in advance, or a
 * parent checking what was served last week, had no way to get there. The
 * chevron pair mirrors `AttendanceCalendar`'s month nav for the same reason
 * the day grid does: one visual language for "step through a date range" on
 * this page, not two.
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
  const todayOffset = (now.getUTCDay() + 6) % 7; // Monday-first: 0..6

  const [monday, setMonday] = useState(() => mondayOf(now));
  // An offset into the week, not a stored date — so paging a week keeps the
  // same weekday selected (Wednesday stays Wednesday) instead of always
  // resetting to Monday.
  const [selectedOffset, setSelectedOffset] = useState(todayOffset);

  const weekDates = Array.from({ length: 7 }, (_, i) => toIso(addDays(monday, i)));
  const from = weekDates[0]!;
  const to = weekDates[6]!;

  const menu = useQuery({
    queryKey: ["kindergarten", kindergartenId, "menu", from, to],
    queryFn: () => get(`/kindergartens/${kindergartenId}/menu?from=${from}&to=${to}`, menuSchema),
  });

  if (menu.isPending) return <LoadingState rows={3} />;
  if (menu.isError) return <ErrorState description={errorMessage(menu.error)} />;

  // ★ `day.date` is a full ISO datetime from the API (`2026-08-27T00:00:00.000Z`),
  // not the plain `YYYY-MM-DD` this component works in — `attendance-calendar.tsx`
  // normalises the same way for the identical reason. Keying by the raw value
  // here previously meant a saved dish never matched any `weekDates` entry, so
  // it vanished from the display the instant the save that just wrote it
  // refetched — the data was always correct in Postgres, only unreachable by
  // this lookup.
  const byDate = new Map(menu.data.map((day) => [day.date.slice(0, 10), day]));
  const hasAnyDish = menu.data.some((day) => day.dishes.length > 0);
  const activeDate = weekDates[selectedOffset]!;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="menu-heading">
        <SectionHeader
          id="menu-heading"
          title="Долоо хоногийн цэс"
          lede={
            healthNotes
              ? "Эрүүл мэндийн тэмдэглэлтэй тохирсон орц улаан тэмдгээр харагдана. Энэ бол баталгаат харшлын систем биш."
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
                    className={cn(
                      "size-1.5 rounded-pill",
                      filled ? "bg-mint" : "bg-transparent",
                    )}
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

/** The selected day's dishes — read, or (staff) edit. */
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
  const [text, setText] = useState(dishesToText(day?.dishes ?? []));
  const [calories, setCalories] = useState(caloriesToText(day?.totalCalories));

  const save = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}`, menuDaySchema, {
        method: "PUT",
        body: {
          dishes: textToDishes(text),
          totalCalories: calories.trim() ? Number(calories) : null,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({
        queryKey: ["kindergarten", kindergartenId, "menu"],
      });
    },
  });

  const dishes = day?.dishes ?? [];

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-ink">{formatLongDate(date)}</p>
        {isStaff && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText(dishesToText(dishes));
              setCalories(caloriesToText(day?.totalCalories));
              setEditing(true);
            }}
          >
            Засах
          </Button>
        ) : null}
      </div>

      {/*
        ★ A whole-day figure, typed in directly — not summed from `dishes`.
        There is no per-dish calorie field (the dish list is freeform text,
        one line each), so this is staff's own count for the day as served,
        the same way a printed menu names one calorie total per day rather
        than per dish.
      */}
      {!editing && day?.totalCalories ? (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-border bg-surface px-3 py-1 text-caption font-medium text-ink">
          <Flame size={14} className="shrink-0 text-primary" aria-hidden="true" />
          {day.totalCalories} ккал
        </span>
      ) : null}

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          <Field
            label="Хоол"
            hint='Мөр тус бүрт нэг хоол. Харшлын орцыг хаалтанд бичнэ: "Будаатай шөл (сүү)".'
          >
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Field label="Илчлэг (ккал)" hint="Тухайн өдрийн нийт илчлэг. Заавал биш.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                inputMode="numeric"
                min={0}
                max={5000}
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={save.isPending}
            >
              Цуцлах
            </Button>
          </div>
        </form>
      ) : dishes.length === 0 ? (
        <p className="text-body text-muted">Хоол оруулаагүй.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {dishes.map((dish, i) => {
            const flagged = matchesHealthNotes(dish, healthNotes);
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className={flagged ? "font-medium text-danger" : "text-ink"}>
                  {dish.name}
                </span>
                {dish.allergenTags.length > 0 ? (
                  <span className="text-caption text-muted">({dish.allergenTags.join(", ")})</span>
                ) : null}
                {flagged ? <Badge tone="danger">Анхаарна уу</Badge> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** `""` for "not entered" rather than the string `"null"` an edit form would show. */
function caloriesToText(totalCalories: number | null | undefined): string {
  return totalCalories === null || totalCalories === undefined ? "" : String(totalCalories);
}

/** `"Будаатай шөл (сүү, самар)"` per line, from stored dishes. */
function dishesToText(dishes: MenuDish[]): string {
  return dishes
    .map((d) => (d.allergenTags.length > 0 ? `${d.name} (${d.allergenTags.join(", ")})` : d.name))
    .join("\n");
}

/** The inverse of `dishesToText`. Blank lines are dropped. */
function textToDishes(text: string): MenuDish[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(line);
      if (!match) return { name: line, allergenTags: [] };
      const [, name, tags] = match;
      return {
        name: name!.trim(),
        allergenTags: tags!
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
    });
}
