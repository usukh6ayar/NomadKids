"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

/**
 * Зорилт тохируулах — the group's teacher sets the month's documentation goal.
 *
 * ★ How many *children* to document, not how many notes to write.
 *
 * A goal counted in notes is met by writing twenty about one child. This one
 * is only met by reaching twenty different children, which is what "хүүхэд
 * бүрийн хөгжлийн явц" asks for — and the card reads it back in those words.
 *
 * ★★ The teacher of the group sets it — client, 2026-09-10: "багш өөрөө
 * сонгох". That is why the number lives on the group rather than on the
 * kindergarten: a kindergarten-wide target set by one teacher would silently
 * change every other group's.
 */
export function GoalDialog({ groupId, current }: { groupId: string; current: number | null }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(current ?? 20));

  const save = useMutation({
    mutationFn: (goal: number | null) =>
      mutate(`/groups/${groupId}/assessments/monthly-note-goal`, z.unknown(), {
        method: "PUT",
        body: { monthlyNoteGoal: goal },
      }),
    onSuccess: () => {
      toast.success("Зорилт хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      setOpen(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Зорилт тохируулах
      </Button>
    );
  }

  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 20;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Сарын зорилт тохируулах"
      className="fixed inset-0 z-50 grid items-end bg-ink/50 p-0 sm:place-items-center sm:p-4"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !save.isPending) save.mutate(parsed);
        }}
        className="flex w-full max-w-[420px] flex-col gap-3.5 rounded-t-card border border-border bg-surface p-4 shadow-lg sm:rounded-card sm:p-5"
        noValidate
      >
        <h2 className="text-title font-semibold text-ink">Сарын зорилт</h2>

        <FormError message={save.isError ? errorMessage(save.error) : null} />

        <Field
          label="Сард хэдэн хүүхдийн явцыг баримтжуулах вэ?"
          hint="1–20 хооронд. Хоосон болговол зорилт харагдахаа болино."
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="number"
              min={1}
              max={20}
              inputMode="numeric"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button type="submit" disabled={!valid || save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Болих
          </Button>
          {/*
            ★ Clearing is a deliberate third action, not the empty field.

            A goal is a commitment somebody made; removing it should read as a
            decision rather than as having deleted the number by accident.
          */}
          {current !== null ? (
            <Button
              type="button"
              variant="ghost"
              className="ms-auto text-danger"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              Зорилт болих
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
