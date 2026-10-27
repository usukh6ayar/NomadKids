"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  A79_LEVEL_KEYS,
  a79BaselineSetupSchema,
  type A79BaselineSetup,
  type A79LevelKey,
} from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { shortName } from "@/lib/format";

export const baselineSetupKey = (groupId: string) => ["group", groupId, "a79-baseline"] as const;

/** The group's «Гарааны үнэлгээ» surveys and children — `GET /groups/:id/a79-baseline`. */
export function useBaselineSetup(groupId: string) {
  return useQuery({
    queryKey: baselineSetupKey(groupId),
    queryFn: () => get(`/groups/${groupId}/a79-baseline`, a79BaselineSetupSchema),
  });
}

type Choice = A79LevelKey | "NONE";

const CHOICES: Choice[] = [...A79_LEVEL_KEYS, "NONE"];

/**
 * «Шинэ гарааны үнэлгээ» and «Хүүхэд нэмэх» — 2026-10-27, the user: each
 * child's level is suggested from their age («багшид хялбар байх үүднээс
 * бэлэн гаргаж болно») and the teacher may change it («хүсвэл сольж болно»),
 * or leave a child out. A survey per level is made for the group; a level
 * that already has one gains the children.
 *
 * ★ Only the children on none of the group's baselines are offered — one
 * child, one level, one assessment. A table, the teacher sheet's way (the
 * user, 2026-10-27: a group of forty): a child per row, I · II · III · IV · —
 * across, each column counting its children, the header kept in view.
 */
export function A79BaselineStartDialog({
  groupId,
  roster,
  adding,
  open,
  onOpenChange,
}: {
  groupId: string;
  roster: A79BaselineSetup["roster"];
  /** Children joining a baseline already started, rather than a new one. */
  adding: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { primaryKindergartenId } = useSession();
  const offered = roster.filter((child) => !child.surveyId);
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(offered.map((child) => [child.childId, child.suggestedLevel])),
  );
  const choiceOf = (childId: string): Choice =>
    choices[childId] ?? offered.find((c) => c.childId === childId)?.suggestedLevel ?? "NONE";

  const levels = A79_LEVEL_KEYS.map((level) => ({
    level,
    childIds: offered.filter((c) => choiceOf(c.childId) === level).map((c) => c.childId),
  })).filter((entry) => entry.childIds.length > 0);
  const chosen = levels.reduce((sum, entry) => sum + entry.childIds.length, 0);

  const create = useMutation({
    mutationFn: () =>
      mutate(`/groups/${groupId}/a79-baseline`, a79BaselineSetupSchema, {
        method: "POST",
        body: { levels },
      }),
    onSuccess: (setup) => {
      queryClient.setQueryData(baselineSetupKey(groupId), setup);
      void queryClient.invalidateQueries({ queryKey: baselineSetupKey(groupId) });
      void queryClient.invalidateQueries({
        queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
      });
      void queryClient.invalidateQueries({ queryKey: ["survey"] });
      toast.success(
        adding
          ? `${chosen} хүүхэд гарааны үнэлгээнд нэмэгдлээ.`
          : `Гарааны үнэлгээ үүслээ — ${chosen} хүүхэд.`,
      );
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={adding ? "Гарааны үнэлгээнд хүүхэд нэмэх" : "Гарааны үнэлгээ"}
      busy={create.isPending}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Болих
          </Button>
          <Button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || chosen === 0}
          >
            {create.isPending ? "Үүсгэж байна…" : adding ? "Нэмэх" : "Үүсгэх"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError message={create.isError ? errorMessage(create.error) : null} />
        {offered.length === 0 ? (
          <p className="text-body text-muted">Бүлгийн бүх хүүхэд гарааны үнэлгээнд орсон байна.</p>
        ) : (
          <div className="w-fit max-w-full rounded-control border border-border">
            <table className="border-collapse text-body">
              <caption className="sr-only">Хүүхэд бүрийн түвшин</caption>
              <thead className="sticky top-0 z-[1]">
                <tr className="bg-canvas">
                  <th
                    scope="col"
                    className="w-8 bg-canvas py-2 pl-2 text-left text-caption font-semibold text-muted sm:pl-3"
                  >
                    №
                  </th>
                  <th
                    scope="col"
                    className="bg-canvas px-2 py-2 text-left text-caption font-semibold text-muted"
                  >
                    Хүүхдийн нэр
                  </th>
                  {CHOICES.map((value) => (
                    <th
                      key={value}
                      scope="col"
                      className="w-10 bg-canvas px-0.5 py-2 text-center text-caption font-semibold text-ink sm:w-14"
                    >
                      {value === "NONE" ? "—" : value}
                      <span className="block font-normal tabular-nums text-muted">
                        {offered.filter((c) => choiceOf(c.childId) === value).length}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {offered.map((child, index) => {
                  const name = shortName(child);
                  return (
                    <tr key={child.childId} className="border-t border-border-soft">
                      <td className="py-2 pl-2 tabular-nums text-muted sm:pl-3">{index + 1}</td>
                      <th
                        scope="row"
                        className="px-2 py-2 text-left font-normal leading-snug text-ink"
                      >
                        {name}
                      </th>
                      {CHOICES.map((value) => (
                        <td key={value} className="px-0.5 py-2 text-center">
                          <input
                            type="radio"
                            name={`level-${child.childId}`}
                            aria-label={
                              value === "NONE" ? `${name} — үнэлэхгүй` : `${name} — ${value} түвшин`
                            }
                            checked={choiceOf(child.childId) === value}
                            onChange={() => setChoices((c) => ({ ...c, [child.childId]: value }))}
                            disabled={create.isPending}
                            className="size-5 cursor-pointer align-middle accent-primary disabled:cursor-default"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </FormDialog>
  );
}
