"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { menuDaySchema, type MenuDish } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";

const menuSchema = z.array(menuDaySchema);

/** Monday of the current week, in UTC, as `YYYY-MM-DD`. */
function weekStart(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + diff);
  return monday;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
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
  const monday = weekStart();
  const from = toIso(monday);
  const to = toIso(new Date(monday.getTime() + 6 * 86_400_000));

  const menu = useQuery({
    queryKey: ["kindergarten", kindergartenId, "menu", from, to],
    queryFn: () => get(`/kindergartens/${kindergartenId}/menu?from=${from}&to=${to}`, menuSchema),
  });

  if (menu.isPending) return <LoadingState rows={3} />;
  if (menu.isError) return <ErrorState description={errorMessage(menu.error)} />;

  const byDate = new Map(menu.data.map((day) => [day.date, day]));
  const days = Array.from({ length: 7 }, (_, i) =>
    toIso(new Date(monday.getTime() + i * 86_400_000)),
  );
  const hasAnyDish = menu.data.some((day) => day.dishes.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="menu-heading">
        <SectionHeader
          id="menu-heading"
          title="Энэ долоо хоногийн цэс"
          lede={
            healthNotes
              ? "Эрүүл мэндийн тэмдэглэлтэй тохирсон орц улаан тэмдгээр харагдана. Энэ бол баталгаат харшлын систем биш."
              : undefined
          }
        />

        {/*
          Staff always sees all seven days, empty ones included — that is how
          a day gets its first entry. A parent with nothing to read yet gets
          one empty state instead of seven identical "no food" cards.
        */}
        {!isStaff && !hasAnyDish ? (
          <EmptyState
            title="Цэс оруулаагүй байна"
            description="Багш цэс оруулсны дараа энд харагдана."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {days.map((date) => (
              <DayCard
                key={date}
                kindergartenId={kindergartenId}
                date={date}
                day={byDate.get(date)}
                healthNotes={healthNotes}
                isStaff={isStaff}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DayCard({
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

  const save = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/menu/${date}`, menuDaySchema, {
        method: "PUT",
        body: { dishes: textToDishes(text) },
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
    <Card className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-ink">{formatDate(date)}</p>
        {isStaff && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText(dishesToText(dishes));
              setEditing(true);
            }}
          >
            Засах
          </Button>
        ) : null}
      </div>

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
    </Card>
  );
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
