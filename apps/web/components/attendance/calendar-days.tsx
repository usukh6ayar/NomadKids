"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

const calendarSchema = z.array(
  z.object({ date: z.string(), name: z.string(), isWorkingDay: z.boolean() }),
);

/**
 * The working-week exceptions, edited where they are felt.
 *
 * ★ 2026-09-17, at the client's correction: a public holiday must not be
 * counted as a day the register was left unfilled, and a make-up Saturday must
 * be recordable ("улс нийтээр нөхөж ажиллах онцгой тохиолдолд л бүртгэх").
 *
 * The rule lives on the API (`workingDays`), which reads this table for every
 * register, every daily summary and every export — so what this screen edits
 * is the same list all three divide by, rather than a display filter that
 * would leave the figures underneath unchanged.
 *
 * ★★ On the director's own attendance screen rather than in a settings area.
 *
 * A holiday is noticed here, in the month it makes look unfinished, and a
 * setting three screens away is one nobody corrects while they are looking at
 * the number it explains. Folded shut, so it costs a row and not a section.
 *
 * ★★★ Administrator only, and that is the API's decision too: `POST` and
 * `DELETE` are `@Roles("ADMIN")` while the list is readable by whoever may
 * read the register, because an accountant reconciling funding needs to see
 * which days were closed.
 */
export function CalendarDays({
  kindergartenId,
  from,
  to,
  canEdit,
}: {
  kindergartenId: string;
  from: string;
  to: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [isWorkingDay, setIsWorkingDay] = useState(false);

  const path = `/kindergartens/${kindergartenId}/attendance/calendar`;

  const days = useQuery({
    queryKey: ["attendance-calendar", kindergartenId, from, to],
    queryFn: () => get(`${path}?from=${from}&to=${to}`, calendarSchema),
    enabled: Boolean(kindergartenId && from && to),
  });

  /*
    Both keys: the calendar itself, and every register that divides by it. A
    holiday added while the month is on screen has to change the figures
    above, or the two disagree until a reload.
  */
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["attendance-calendar", kindergartenId] }),
      queryClient.invalidateQueries({ queryKey: ["daily-attendance"] }),
      queryClient.invalidateQueries({ queryKey: ["attendance"] }),
    ]);
  };

  const save = useMutation({
    mutationFn: () =>
      mutate(path, z.unknown(), {
        method: "POST",
        body: { date, name: name.trim(), isWorkingDay },
      }),
    onSuccess: async () => {
      toast.success("Хадгаллаа.");
      setDate("");
      setName("");
      setIsWorkingDay(false);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (day: string) => mutate(`${path}/${day}`, z.unknown(), { method: "DELETE" }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items = days.data ?? [];
  const closed = items.filter((day) => !day.isWorkingDay).length;

  return (
    <Disclosure
      title="Амралт, баярын өдрүүд"
      hint={
        items.length === 0
          ? "Тохируулаагүй"
          : `${closed} амралт · ${items.length - closed} нөхөж ажилласан`
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-caption text-muted">
          Эдгээр өдрийг ирцийн тооцооллоос хасна. Улсаар нөхөж ажиллах өдрийг “Ажлын өдөр” гэж
          тэмдэглэвэл ирц бүртгэнэ.
        </p>

        {days.isError ? <FormError message={errorMessage(days.error)} /> : null}

        {items.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {items.map((day) => (
              <li
                key={day.date}
                className="flex items-center gap-3 rounded-row border border-border-soft px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink">{day.name}</span>
                  <span className="block text-caption text-muted">
                    {formatDate(day.date)}
                    {day.isWorkingDay ? " · ажлын өдөр" : " · амралт"}
                  </span>
                </span>

                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${day.name} — устгах`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(day.date)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted">Энэ хугацаанд онцгой өдөр бүртгэгдээгүй байна.</p>
        )}

        {canEdit ? (
          <form
            className="flex flex-col gap-2 border-t border-border-soft pt-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (date && name.trim() && !save.isPending) save.mutate();
            }}
          >
            <Field label="Огноо" className="sm:w-44">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              )}
            </Field>

            <Field label="Нэр" className="min-w-0 flex-1">
              {({ id }) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Цагаан сар"
                />
              )}
            </Field>

            <Checkbox
              label="Ажлын өдөр"
              checked={isWorkingDay}
              onChange={(event) => setIsWorkingDay(event.target.checked)}
              className="shrink-0 items-center"
            />

            <Button type="submit" disabled={!date || !name.trim() || save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Нэмэх"}
            </Button>
          </form>
        ) : null}
      </div>
    </Disclosure>
  );
}
