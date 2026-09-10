"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { useToast } from "@/components/ui/toast";

type GoalPatch = {
  monthlyNoteGoal?: number | null;
  monthlyNotesPerChildGoal?: number | null;
};

/** Two compact, auto-saving goal selectors beside the month selector. */
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
  const ceiling = Math.max(maxChildren, 1);

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

  const controlClass =
    "h-10 w-full rounded-control border border-mint bg-surface px-3 text-body font-semibold text-ink disabled:opacity-60";

  return (
    <>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-caption font-medium text-muted">Зорилтот хүүхэд</span>
        <select
          aria-label="Зорилтот хүүхдийн тоо"
          value={current ?? ""}
          disabled={save.isPending}
          onChange={(event) =>
            save.mutate({ monthlyNoteGoal: event.target.value ? Number(event.target.value) : null })
          }
          className={controlClass}
        >
          <option value="">Сонгох</option>
          {Array.from({ length: ceiling }, (_, index) => index + 1).map((count) => (
            <option key={count} value={count}>
              {count} хүүхэд
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-caption font-medium text-muted">Нэг хүүхдэд</span>
        <select
          aria-label="Нэг хүүхдэд бичих тэмдэглэлийн тоо"
          value={currentNotesPerChild ?? ""}
          disabled={save.isPending}
          onChange={(event) =>
            save.mutate({
              monthlyNotesPerChildGoal: event.target.value ? Number(event.target.value) : null,
            })
          }
          className={controlClass}
        >
          <option value="">Сонгох</option>
          {Array.from({ length: 10 }, (_, index) => index + 1).map((count) => (
            <option key={count} value={count}>
              {count} тэмдэглэл
            </option>
          ))}
        </select>
      </label>

      <span className="sr-only" role="status" aria-live="polite">
        {save.isPending ? "Зорилтыг хадгалж байна" : ""}
      </span>
    </>
  );
}
