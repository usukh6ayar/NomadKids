"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, X } from "lucide-react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { RowMenu } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";

type GoalPatch = {
  monthlyNoteGoal?: number | null;
  monthlyNotesPerChildGoal?: number | null;
};

/**
 * The month's two goal figures, as steppers beside the month selector.
 *
 * ★ Digits, not "5 хүүхэд" — 2026-09-11, at the client's request.
 *
 * They were selects that spelled the unit into every option, which made each
 * control about 140px wide and forced the row to stack on a phone. The unit is
 * already on the label above; repeating it inside the control bought nothing
 * and cost the row.
 *
 * ★★ Steppers rather than a number input, and that is a phone decision.
 *
 * These are small numbers adjusted by one — five children, two notes — and a
 * numeric keyboard appearing over the figures below to type "5" is the worst
 * of the available interactions. Plus and minus are two 44px targets and no
 * keyboard at all.
 *
 * ★★★ Saved on a pause, not on every press.
 *
 * Walking from 2 to 6 is four presses; four PUTs would be three writes nobody
 * asked for and four toasts. The value moves immediately and the write follows
 * 600ms after the last one — which is also why the mutation is keyed on the
 * whole patch rather than fired per field.
 */
export function GoalDialog({
  groupId,
  current,
  currentNotesPerChild,
  maxChildren,
}: {
  groupId: string;
  current: number | null;
  currentNotesPerChild: number | null;
  maxChildren: number;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [childGoal, setChildGoal] = useState(current ?? 1);
  const [noteGoal, setNoteGoal] = useState(currentNotesPerChild ?? 1);

  /*
    ★ The children ceiling is the smaller of the roster and what the API
    accepts.

    `monthlyNoteGoalSchema` caps it at 20, and a group of twenty-five would
    otherwise offer a number the server refuses — a control that looks like it
    worked and did not.
  */
  const ceiling = Math.min(Math.max(maxChildren, 1), 20);

  const save = useMutation({
    mutationFn: (goal: GoalPatch) =>
      mutate(`/groups/${groupId}/assessments/monthly-note-goal`, z.unknown(), {
        method: "PUT",
        body: goal,
      }),
    onSuccess: () => {
      toast.success("Зорилт хадгалагдлаа.");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["group", groupId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useEffect(() => {
    if (!open) return;
    setChildGoal(current ?? 1);
    setNoteGoal(currentNotesPerChild ?? 1);
  }, [current, currentNotesPerChild, open]);

  const backdrop = useBackdropDismiss(() => setOpen(false), {
    dismissable: open,
    lockScroll: open,
  });

  return (
    <>
      <RowMenu
        ariaLabel="Сарын зорилгын үйлдэл"
        items={[{ label: "Засах", onSelect: () => setOpen(true) }]}
      />

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Зорилго засах"
          {...backdrop}
          className="fixed inset-0 z-50 grid items-end justify-items-center bg-ink/50 sm:place-items-center sm:p-4"
        >
          <div className="w-full max-w-[420px] rounded-t-card border border-border bg-surface p-5 shadow-lg sm:rounded-card">
            <div className="flex items-center gap-2 border-b border-border-soft pb-3">
              <h2 className="min-w-0 flex-1 text-title font-semibold text-ink">Зорилго засах</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Хаах"
                onClick={() => setOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </div>

            <div className="mt-4 flex flex-col gap-4">
              <Stepper
                label="Энэ сард үнэлэх хүүхэд"
                srLabel="Зорилтот хүүхдийн тоо"
                value={childGoal}
                min={1}
                max={ceiling}
                disabled={save.isPending}
                onChange={setChildGoal}
              />
              <Stepper
                label="Хүүхэд бүрт"
                srLabel="Нэг хүүхдэд бичих тэмдэглэлийн тоо"
                value={noteGoal}
                min={1}
                max={10}
                disabled={save.isPending}
                onChange={setNoteGoal}
              />

              <p className="rounded-control bg-sky px-3 py-2 text-caption text-sky-ink">
                {childGoal} хүүхдэд тус бүр {noteGoal} тэмдэглэл хөтөлнө.
              </p>

              <div className="grid grid-cols-2 gap-2 border-t border-border-soft pt-4">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  Болих
                </Button>
                <Button
                  type="button"
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({
                      monthlyNoteGoal: childGoal,
                      monthlyNotesPerChildGoal: noteGoal,
                    })
                  }
                >
                  {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * `− N +`, committed once the presses stop.
 *
 * ★ `null` shows a dash and the first press starts at `min`.
 *
 * "No goal set" is a real state — the card draws nothing without one — so it
 * has to be distinguishable from a goal of one, and a stepper sitting at "1"
 * would claim a target nobody chose.
 */
function Stepper({
  label,
  srLabel,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  srLabel: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  function step(delta: number) {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onChange(next);
  }

  const button =
    "grid size-9 shrink-0 place-items-center rounded-control border border-mint bg-surface text-ink transition-colors disabled:opacity-40";

  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-caption font-medium text-muted">{label}</span>
      <div
        role="group"
        aria-label={srLabel}
        className="flex h-10 items-center justify-between gap-1 rounded-control border border-mint bg-surface px-1"
      >
        <button
          type="button"
          aria-label={`${srLabel} — хасах`}
          disabled={disabled || value <= min}
          onClick={() => step(-1)}
          className={cn(button, "border-0")}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <output className="min-w-0 flex-1 text-center text-body font-semibold tabular-nums text-ink">
          {value}
        </output>
        <button
          type="button"
          aria-label={`${srLabel} — нэмэх`}
          disabled={disabled || value >= max}
          onClick={() => step(1)}
          className={cn(button, "border-0")}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </label>
  );
}
