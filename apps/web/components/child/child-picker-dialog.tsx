"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import { MAX_PAGE_SIZE, childSummarySchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ChildAvatar } from "@/components/media/media-image";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { formatAge, fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const childrenPageSchema = paginated(childSummarySchema);

/**
 * Хүүхдээ сонгох — the client's 2026-09-11 picker.
 *
 * ★ A screen of faces, not a dropdown of names.
 *
 * The three note doors used to sit beside a `<Select>`, which is fine for
 * choosing between two options and wrong for choosing a child: a teacher knows
 * the face before the name, a roster of twenty in a native listbox is a
 * scrolling column of text, and the age and group that distinguish two
 * Ануs are not there at all.
 *
 * ★★ Search is client-side, because the roster is already in memory.
 *
 * `MAX_PAGE_SIZE` children is one bounded request the shell usually has warm,
 * and asking the server again on every keystroke would be a round trip per
 * letter for a list of twenty rows.
 *
 * ★★★ The choice is confirmed, not applied on tap.
 *
 * The row shows a tick and the sheet stays open until Сонгох. Picking the
 * wrong child and landing on their file is a mistake that costs a navigation
 * to undo; picking the wrong row and seeing the tick move costs nothing.
 */
export function ChildPickerDialog({
  groupId,
  selectedId,
  title = "Хүүхдээ сонгох",
  summary,
  coverage,
  onSelect,
  onClose,
}: {
  /** Narrows the roster to one group; omitted, it is every child the actor sees. */
  groupId?: string;
  selectedId?: string;
  /** Names the kind of record when the picker is opened from one of its doors. */
  title?: string;
  /**
   * What the class as a whole has done — shown above the roster.
   *
   * ★ Optional, because the same picker is opened from Солих on a child's own
   * screen, where a group figure would answer a question nobody asked.
   */
  summary?: ReactNode;
  /** Per-child progress for the selected month and record kind. */
  coverage?: { counts: Record<string, number>; target: number; title?: string };
  onSelect: (childId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(selectedId ?? "");
  const [filter, setFilter] = useState<"all" | "incomplete" | "complete">("all");

  const roster = useQuery({
    queryKey: qk.children({ groupId, page: 1, pageSize: MAX_PAGE_SIZE }),
    queryFn: () =>
      get(
        `/children?${groupId ? `groupId=${groupId}&` : ""}page=1&pageSize=${MAX_PAGE_SIZE}`,
        childrenPageSchema,
      ),
    staleTime: 60_000,
  });

  const term = search.trim().toLocaleLowerCase("mn-MN");
  const items = (roster.data?.items ?? [])
    .filter((child) => !term || fullName(child).toLocaleLowerCase("mn-MN").includes(term))
    .filter((child) => {
      if (!coverage || filter === "all") return true;
      const complete = (coverage.counts[child.id] ?? 0) >= coverage.target;
      return filter === "complete" ? complete : !complete;
    })
    .sort((a, b) => {
      if (!coverage) return 0;
      const aComplete = (coverage.counts[a.id] ?? 0) >= coverage.target;
      const bComplete = (coverage.counts[b.id] ?? 0) >= coverage.target;
      return Number(aComplete) - Number(bComplete);
    });

  const rosterItems = roster.data?.items ?? [];
  const completeCount = coverage
    ? rosterItems.filter((child) => (coverage.counts[child.id] ?? 0) >= coverage.target).length
    : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 grid items-end bg-ink/50 p-0 sm:place-items-center sm:p-4"
    >
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[480px] flex-col gap-3 rounded-t-card border border-border bg-surface p-4 shadow-lg sm:max-h-[calc(100vh-2rem)] sm:rounded-card sm:p-5">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-title font-semibold leading-heading text-ink">
            {title}
          </h2>
          <Button variant="ghost" size="icon" aria-label="Хаах" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        </div>

        {summary}

        {coverage && rosterItems.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-caption">
              <span className="font-medium text-ink">{coverage.title ?? "Ажиглалтын хамралт"}</span>
              <span className="tabular-nums text-muted">
                {completeCount}/{rosterItems.length} хүүхэд
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-pill bg-border-soft">
              <div
                className="h-full rounded-pill bg-primary transition-[width]"
                style={{ width: `${Math.round((completeCount / rosterItems.length) * 100)}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-control bg-canvas p-1">
              {(
                [
                  ["all", "Бүгд"],
                  ["incomplete", "Дутуу"],
                  ["complete", "Биелсэн"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn(
                    "min-h-8 rounded-control px-2 text-caption font-semibold",
                    filter === value ? "bg-surface text-primary shadow-sm" : "text-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="relative">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Хүүхдийн нэрээр хайх…"
            aria-label="Хүүхдийн нэрээр хайх"
            className="border-border-soft bg-canvas pl-11 focus:bg-surface"
          />
        </div>

        {roster.isPending ? <LoadingState rows={4} /> : null}
        {roster.isError ? <ErrorState description={errorMessage(roster.error)} /> : null}

        {roster.data && items.length === 0 ? (
          <p className="py-6 text-center text-body text-muted">
            {term ? "Тохирох хүүхэд олдсонгүй." : "Бүлэгт идэвхтэй хүүхэд алга."}
          </p>
        ) : null}

        {items.length > 0 ? (
          <ul
            role="radiogroup"
            aria-label={title}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              coverage && "grid grid-cols-2 content-start gap-2",
            )}
          >
            {items.map((child) => {
              const chosen = pending === child.id;
              const group = child.enrollments?.find((row) => row.group)?.group?.name;
              const count = coverage?.counts[child.id] ?? 0;
              const complete = coverage ? count >= coverage.target : false;

              return (
                <li key={child.id} className={cn(coverage && "relative min-w-0")}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    onClick={() => setPending(child.id)}
                    className={cn(
                      "flex w-full rounded-card text-left transition-colors",
                      coverage
                        ? "min-h-[132px] flex-col items-center justify-center gap-1.5 border border-border-soft px-2 py-3 text-center"
                        : "items-center gap-3 px-2.5 py-2.5",
                      chosen ? "border-primary bg-primary-soft" : "bg-surface hover:bg-canvas",
                    )}
                  >
                    <ChildAvatar child={child} size={44} />
                    <span className={cn("min-w-0", coverage ? "w-full" : "flex-1")}>
                      <span className="block truncate text-body font-medium leading-snug text-ink">
                        {fullName(child)}
                      </span>
                      {coverage ? (
                        <span
                          className={cn(
                            "mt-1 block truncate text-caption font-medium",
                            complete ? "text-mint-ink" : count > 0 ? "text-sun-ink" : "text-muted",
                          )}
                        >
                          {complete
                            ? "Зорилт биелсэн"
                            : count > 0
                              ? `${count}/${coverage.target} тэмдэглэл`
                              : "Тэмдэглэлгүй"}
                        </span>
                      ) : (
                        <span className="block truncate text-caption text-muted">
                          {formatAge(child.dateOfBirth)}
                          {group ? ` · ${group}` : ""}
                        </span>
                      )}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-pill border-2",
                        coverage && "absolute right-2 top-2",
                        chosen ? "border-primary bg-primary text-white" : "border-border",
                      )}
                    >
                      {chosen ? <Check size={14} strokeWidth={3} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <Button
          size="lg"
          className="w-full"
          disabled={!pending}
          onClick={() => {
            onSelect(pending);
            onClose();
          }}
        >
          Сонгох
        </Button>
      </div>
    </div>
  );
}
