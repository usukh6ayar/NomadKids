"use client";

import { useState } from "react";
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
  onSelect,
  onClose,
}: {
  /** Narrows the roster to one group; omitted, it is every child the actor sees. */
  groupId?: string;
  selectedId?: string;
  onSelect: (childId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(selectedId ?? "");

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
  const items = (roster.data?.items ?? []).filter(
    (child) => !term || fullName(child).toLocaleLowerCase("mn-MN").includes(term),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Хүүхдээ сонгох"
      className="fixed inset-0 z-50 grid items-end bg-ink/50 p-0 sm:place-items-center sm:p-4"
    >
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[480px] flex-col gap-3 rounded-t-card border border-border bg-surface p-4 shadow-lg sm:max-h-[calc(100vh-2rem)] sm:rounded-card sm:p-5">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-title font-semibold leading-heading text-ink">
            Хүүхдээ сонгох
          </h2>
          <Button variant="ghost" size="icon" aria-label="Хаах" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        </div>

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
            aria-label="Хүүхдээ сонгох"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {items.map((child) => {
              const chosen = pending === child.id;
              const group = child.enrollments?.find((row) => row.group)?.group?.name;

              return (
                <li key={child.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    onClick={() => setPending(child.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-card px-2.5 py-2.5 text-left transition-colors",
                      chosen ? "bg-primary-soft" : "hover:bg-canvas",
                    )}
                  >
                    <ChildAvatar child={child} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium leading-snug text-ink">
                        {fullName(child)}
                      </span>
                      <span className="block truncate text-caption text-muted">
                        {formatAge(child.dateOfBirth)}
                        {group ? ` · ${group}` : ""}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-pill border-2",
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
