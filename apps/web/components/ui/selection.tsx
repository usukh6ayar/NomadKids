"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckControl } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Selecting rows in a list, and acting on the selection.
 *
 * ★ One implementation for two screens, which is the reason it is a module.
 *
 * The attendance register and the children roster both grew checkboxes on
 * 2026-09-04, and they are the same interaction with different verbs at the
 * end of it: tick some children, then do one thing to all of them. Written
 * twice they would have drifted the way this codebase's card padding once did
 * — a "select all" that counts the page on one screen and the filtered total
 * on the other is a bug nobody notices until somebody exports the wrong rows.
 *
 * ★★ The selection is always **a subset of what is on screen**.
 *
 * `useSelection` is handed the ids currently rendered and prunes anything else
 * out on every change. That is not tidiness: a register whose date moved to
 * yesterday, or a roster on page three, would otherwise carry ticks belonging
 * to rows the reader can no longer see — and then a bulk action would act on
 * children they had forgotten they chose. The count beside the buttons is
 * therefore always a count of visible ticks.
 */

export function useSelection(visibleIds: string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  /*
    Stable across renders that produce the same ids in the same order, so the
    effect below does not fire on every keystroke in the roster's search box.
  */
  const key = visibleIds.join(",");

  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;

      const visible = new Set(visibleIds);
      const kept = new Set([...current].filter((id) => visible.has(id)));
      // Same contents: return the old set so consumers do not re-render.
      return kept.size === current.size ? current : kept;
    });
    // `key` stands in for `visibleIds`, which is a fresh array on every render
    // and would therefore fire this effect on every render.
  }, [key, visibleIds]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /*
    ★ "Select all" clears when everything is already ticked.

    A header box that only ever selects is a control with no way back, and the
    obvious way back — untick twenty-four boxes — is the work the box exists to
    avoid.
  */
  const toggleAll = useCallback(() => {
    setSelected((current) =>
      current.size === visibleIds.length ? new Set() : new Set(visibleIds),
    );
  }, [visibleIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(
    () => ({
      selected,
      ids: [...selected],
      count: selected.size,
      has: (id: string) => selected.has(id),
      toggle,
      toggleAll,
      clear,
      /** Every visible row is ticked — and there is at least one. */
      allSelected: visibleIds.length > 0 && selected.size === visibleIds.length,
      /** Some but not all: what the header box renders as a dash. */
      someSelected: selected.size > 0 && selected.size < visibleIds.length,
    }),
    [selected, toggle, toggleAll, clear, visibleIds.length],
  );
}

/**
 * One row's checkbox.
 *
 * ★ A bare box with an `aria-label`, not `ui/field.tsx`'s `Checkbox`.
 *
 * That component renders its label as visible text beside the box, which is
 * right for a form field and wrong here: the row already says whose it is, and
 * repeating the name would put it on screen twice. The name still reaches a
 * screen reader through `aria-label`, so the control is never "checkbox,
 * unlabelled".
 *
 * ★★ The drawing is `CheckControl`, shared with that component.
 *
 * It was a second `<input>` with its own `accent-primary` and its own
 * indeterminate effect, which is how a product ends up with two checkboxes that
 * differ by a corner radius. One drawing, two wrappers — this one supplies the
 * 44px touch target, `Checkbox` supplies a visible label.
 */
export function SelectBox({
  checked,
  indeterminate = false,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  /** Renders the dash: some of the rows below are ticked, not all. */
  indeterminate?: boolean;
  onChange: () => void;
  /** The accessible name — "Батсайхан Дорж — сонгох". */
  label: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "-my-2 flex min-h-[44px] shrink-0 cursor-pointer select-none items-center px-1",
        className,
      )}
    >
      <CheckControl
        checked={checked}
        indeterminate={indeterminate}
        onChange={onChange}
        aria-label={label}
      />
    </label>
  );
}

/**
 * The bar that appears once something is ticked.
 *
 * ★ Sticky to the bottom of the viewport, and absent at zero.
 *
 * The actions are about the selection, so they have nowhere to live until
 * there is one — a permanently visible toolbar of disabled buttons is a row of
 * controls that teaches a reader to ignore that strip of the screen. Sticky
 * because the register is scrolled while ticking: a bar at the foot of a list
 * of twenty-four is a bar you have to scroll back to.
 *
 * ★★ `Цуцлах` is always the last control and always present.
 *
 * Unticking one at a time is the only other way out, and on a phone that is
 * twenty-four taps. It also gives the bar a way to disappear that does not
 * require performing one of the actions.
 */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  /** The actions — buttons, usually. */
  children: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label="Сонгосон хүүхдүүд"
      className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface px-3 py-2.5 shadow-lg md:px-4"
    >
      {/*
        `aria-live` so the count is announced as boxes are ticked. Without it a
        screen-reader user ticking a row hears the checkbox change and nothing
        about how many are now selected, which is the number the buttons act on.
      */}
      <span aria-live="polite" className="text-body font-semibold text-ink">
        {count} сонгосон
      </span>

      <span className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onClear}
          className="min-h-11 rounded-control border border-border bg-surface px-3 text-body font-medium text-muted transition-colors hover:border-faint hover:text-ink"
        >
          Цуцлах
        </button>
      </span>
    </div>
  );
}
