"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import { MAX_PAGE_SIZE, childSummarySchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { FilterButton } from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/field";
import { ChildAvatar } from "@/components/media/media-image";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Td, Th } from "@/components/ui/table";
import { formatAge, fullName, shortName, capitalize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";

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
  layout = "tiles",
  tabs,
  activeTab,
  onTabChange,
  onSelect,
  onClose,
}: {
  /**
   * Record kinds drawn as tabs above the search — Ажиглалт / Ярилцлага /
   * Бүтээл on the progress assessment's "+" (the client's 2026-10-01 design).
   * The caller recomputes `coverage` for the active tab.
   */
  tabs?: { key: string; label: string }[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /**
   * `table` lists the roster as a plain table with no photographs.
   *
   * ★ 2026-09-30, at the client's instruction: when a teacher picks a child to
   * write a progress-assessment note, the roster is shown in a formal table
   * and the children's photos are not needed. The other doors keep the tiles.
   */
  layout?: "tiles" | "table";
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
  coverage?: {
    counts: Record<string, number>;
    target: number;
    title?: string;
    columnLabel?: string;
  };
  onSelect: (childId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(selectedId ?? "");
  const [filter, setFilter] = useState<"all" | "incomplete" | "complete">("all");
  // In the table layout Бүгд / Дутуу / Биелсэн sit behind the search's filter icon.
  const [filterOpen, setFilterOpen] = useState(false);

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

  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      {...backdrop}
      /*
        ★ `justify-items-center` — 2026-09-16, at the client's request that
        this stop hugging the left edge on a phone.

        The sheet is `w-full max-w-[480px]`, and a grid item with a max-width
        resolves a `stretch` justification to *start*: at any width between
        480px and the `sm` breakpoint the sheet was 480px of dialog pinned to
        the left with a band of dimmed page beside it. Below 480 it filled the
        screen, which is why it read as correct on the narrowest phones and
        wrong on the large ones.
      */
      className="fixed inset-0 z-50 grid items-end justify-items-center bg-ink/50 p-0 sm:place-items-center sm:p-4"
    >
      <div
        className={cn(
          "flex max-h-[calc(100dvh-1rem)] w-full flex-col gap-3 rounded-t-card border border-border bg-surface p-4 shadow-lg sm:max-h-[calc(100vh-2rem)] sm:rounded-card sm:p-5",
          layout === "table" ? "max-w-[640px]" : "max-w-[480px]",
        )}
      >
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-title font-semibold leading-heading text-ink">
            {title}
          </h2>
          <Button variant="ghost" size="icon" aria-label="Хаах" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        </div>

        {/*
          The table layout is the client's 2026-09-30 design: title, filter,
          search, table, Сонгох — no class total and no coverage bar.
        */}
        {layout === "tiles" ? summary : null}

        {tabs && tabs.length > 0 ? (
          <div role="tablist" aria-label="Тэмдэглэлийн төрөл" className="grid grid-cols-3 gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => onTabChange?.(tab.key)}
                className={cn(
                  "min-h-10 truncate rounded-control border px-2 text-caption font-semibold transition-colors",
                  activeTab === tab.key
                    ? "border-primary-soft bg-primary-soft text-primary"
                    : "border-border bg-surface text-muted hover:bg-canvas",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        {coverage && rosterItems.length > 0 && (layout === "tiles" || filterOpen) ? (
          <div id="child-picker-coverage-filter" className="space-y-2">
            {layout === "tiles" ? (
              <>
                <div className="flex items-center justify-between gap-3 text-caption">
                  <span className="font-medium text-ink">
                    {coverage.title ?? "Ажиглалтын хамралт"}
                  </span>
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
              </>
            ) : null}
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
            className={cn(
              "border-border-soft bg-canvas pl-11 focus:bg-surface",
              layout === "table" && coverage && "pr-12",
            )}
          />
          {layout === "table" && coverage ? (
            <FilterButton
              expanded={filterOpen}
              controls="child-picker-coverage-filter"
              count={filter === "all" ? 0 : 1}
              onClick={() => setFilterOpen((open) => !open)}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 border-0 shadow-none"
            />
          ) : null}
        </div>

        {roster.isPending ? <LoadingState rows={4} /> : null}
        {roster.isError ? <ErrorState description={errorMessage(roster.error)} /> : null}

        {roster.data && items.length === 0 ? (
          <p className="py-6 text-center text-body text-muted">
            {term ? "Тохирох хүүхэд олдсонгүй." : "Бүлэгт идэвхтэй хүүхэд алга."}
          </p>
        ) : null}

        {items.length > 0 && layout === "table" ? (
          <div
            role="radiogroup"
            aria-label={title}
            className="min-h-0 flex-1 overflow-auto rounded-card border border-border"
          >
            <table className="w-full border-collapse text-body">
              <caption className="sr-only">{title}</caption>
              <thead className="sticky top-0 z-10">
                <tr>
                  <Th className="w-10">
                    <span className="sr-only">Сонгох</span>
                  </Th>
                  <Th numeric className="w-10">
                    №
                  </Th>
                  <Th>Овог, нэр</Th>
                  <Th>Нас</Th>
                  {groupId ? null : <Th>Бүлэг</Th>}
                  {coverage ? <Th numeric>{coverage.columnLabel ?? "Ажиглалт"}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((child, index) => {
                  const chosen = pending === child.id;
                  const group = capitalize(
                    child.enrollments?.find((row) => row.group)?.group?.name,
                  );
                  const count = coverage?.counts[child.id] ?? 0;
                  const complete = coverage ? count >= coverage.target : false;

                  return (
                    <tr
                      key={child.id}
                      onClick={() => setPending(child.id)}
                      className={cn(
                        "cursor-pointer",
                        chosen ? "bg-primary-soft" : "bg-surface hover:bg-canvas",
                      )}
                    >
                      <Td>
                        <input
                          type="radio"
                          name="child-picker"
                          checked={chosen}
                          onChange={() => setPending(child.id)}
                          aria-label={
                            coverage
                              ? `${fullName(child)} — ${
                                  complete
                                    ? "зорилт биелсэн"
                                    : `${count}/${coverage.target} тэмдэглэл`
                                }`
                              : fullName(child)
                          }
                          className="size-4 accent-primary"
                        />
                      </Td>
                      <Td numeric className="text-muted">
                        {index + 1}
                      </Td>
                      <Td className="font-medium text-ink">{fullName(child)}</Td>
                      <Td className="whitespace-nowrap text-muted">
                        {formatAge(child.dateOfBirth)}
                      </Td>
                      {groupId ? null : <Td className="text-muted">{group ?? "—"}</Td>}
                      {coverage ? (
                        <Td
                          numeric
                          className={cn(
                            "whitespace-nowrap font-medium",
                            complete ? "text-mint-ink" : count > 0 ? "text-sun-ink" : "text-muted",
                          )}
                        >
                          {complete ? "Биелсэн" : `${count}/${coverage.target}`}
                        </Td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {items.length > 0 && layout === "tiles" ? (
          <ul
            role="radiogroup"
            aria-label={title}
            /*
              ★ Three across on a phone, four from `sm` — 2026-09-16, at the
              client's request: "50 хүүхэдтэй анги байгаа".

              Two columns of 132px tiles is 25 rows of scrolling for a class
              that size, and the picker is a place a teacher passes through
              rather than reads. The tile lost the height it was spending on
              air, the avatar dropped to 36px and the name is `shortName`
              (`Б.Батзориг`) — a column about 110px wide on a 390px phone
              fits a given name and cannot fit a patronymic before it.
            */
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              coverage && "grid grid-cols-3 content-start gap-1.5 sm:grid-cols-4",
            )}
          >
            {items.map((child) => {
              const chosen = pending === child.id;
              const group = capitalize(child.enrollments?.find((row) => row.group)?.group?.name);
              const count = coverage?.counts[child.id] ?? 0;
              const complete = coverage ? count >= coverage.target : false;

              return (
                <li key={child.id} className={cn(coverage && "relative min-w-0")}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    /*
                      ★ The full name is still the accessible name, and the
                      `title` still spells it out on a pointer. A narrower tile
                      is a drawing decision; it must not take a child's name
                      away from a screen reader.
                    */
                    aria-label={
                      coverage
                        ? `${fullName(child)} — ${
                            complete ? "зорилт биелсэн" : `${count}/${coverage.target} тэмдэглэл`
                          }`
                        : fullName(child)
                    }
                    title={fullName(child)}
                    onClick={() => setPending(child.id)}
                    className={cn(
                      "flex w-full rounded-card text-left transition-colors",
                      coverage
                        ? "min-h-[100px] flex-col items-center justify-center gap-1 border border-border-soft px-1 py-2 text-center"
                        : "items-center gap-3 px-2.5 py-2.5",
                      chosen ? "border-primary bg-primary-soft" : "bg-surface hover:bg-canvas",
                    )}
                  >
                    <ChildAvatar child={child} size={coverage ? 36 : 44} />
                    <span className={cn("min-w-0", coverage ? "w-full" : "flex-1")}>
                      <span
                        className={cn(
                          "block truncate font-medium leading-snug text-ink",
                          coverage ? "text-caption" : "text-body",
                        )}
                      >
                        {coverage ? shortName(child) : fullName(child)}
                      </span>
                      {coverage ? (
                        <span
                          className={cn(
                            "mt-1 block truncate text-caption font-medium",
                            complete ? "text-mint-ink" : count > 0 ? "text-sun-ink" : "text-muted",
                          )}
                        >
                          {complete ? "Биелсэн" : `${count}/${coverage.target}`}
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
                        coverage && "absolute right-1 top-1 size-5",
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
          size={layout === "table" ? "sm" : "lg"}
          className={layout === "table" ? "self-end rounded-pill px-6" : "w-full"}
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
