"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

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
      void queryClient.invalidateQueries({ queryKey: ["group", groupId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <Stepper
        label="Зорилтот хүүхэд"
        srLabel="Зорилтот хүүхдийн тоо"
        value={current}
        min={1}
        max={ceiling}
        disabled={save.isPending}
        onCommit={(next) => save.mutate({ monthlyNoteGoal: next })}
      />

      <Stepper
        label="Нэг хүүхдэд"
        srLabel="Нэг хүүхдэд бичих тэмдэглэлийн тоо"
        value={currentNotesPerChild}
        min={1}
        max={10}
        disabled={save.isPending}
        onCommit={(next) => save.mutate({ monthlyNotesPerChildGoal: next })}
      />

      <span className="sr-only" role="status" aria-live="polite">
        {save.isPending ? "Зорилтыг хадгалж байна" : ""}
      </span>
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
  onCommit,
}: {
  label: string;
  srLabel: string;
  value: number | null;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The server's value wins whenever it changes — a refetch after somebody
  // else's edit must not be overwritten by a stale local number.
  useEffect(() => setDraft(value), [value]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function step(delta: number) {
    const next = Math.min(max, Math.max(min, (draft ?? min - delta) + delta));
    if (next === draft) return;

    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(next), 600);
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
          disabled={disabled || (draft ?? min) <= min}
          onClick={() => step(-1)}
          className={cn(button, "border-0")}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <output className="min-w-0 flex-1 text-center text-body font-semibold tabular-nums text-ink">
          {draft ?? "—"}
        </output>
        <button
          type="button"
          aria-label={`${srLabel} — нэмэх`}
          disabled={disabled || (draft ?? 0) >= max}
          onClick={() => step(1)}
          className={cn(button, "border-0")}
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </label>
  );
}
