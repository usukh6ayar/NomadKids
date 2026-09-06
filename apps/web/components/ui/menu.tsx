"use client";

import Link from "next/link";
// Aliased: an unqualified `KeyboardEvent` would shadow the DOM's inside this
// module, and the two `addEventListener` calls below need the DOM one.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { cn } from "@/lib/utils";

export interface MenuItem {
  href: string;
  label: string;
  /** The line under the label — what the entry actually does. */
  hint?: string;
  icon?: ReactNode;
}

/**
 * A button that opens a short list of destinations.
 *
 * ★ Hand-written rather than another Radix package.
 *
 * `@radix-ui/react-dropdown-menu` is not a dependency here, and a menu of three
 * links does not earn one: what it would add over this is type-ahead and
 * collision-aware positioning, neither of which a 3-item menu anchored to a
 * header button needs. What it must not skip is the accessibility contract, so
 * that part is implemented in full — `aria-haspopup`/`aria-expanded` on the
 * trigger, `role="menu"`/`menuitem` on the list, arrow-key movement, Escape to
 * close, and focus returned to the trigger when it does.
 *
 * ★★ Every entry goes somewhere real.
 *
 * The same rule the sidebar is held to (`app-shell.tsx`): a menu entry that
 * opens nothing teaches a teacher the product is broken. That is why this takes
 * `MenuItem[]` with a required `href` and has no disabled variant — an action
 * whose screen does not exist yet cannot be expressed in this component at all.
 */
export function Menu({
  label,
  items,
  ariaLabel,
  variant = "primary",
  className,
}: {
  label: ReactNode;
  items: MenuItem[];
  /** Names the menu itself, for a screen reader listing it. */
  ariaLabel: string;
  /**
   * The trigger's weight. `primary` is right where the menu *is* the screen's
   * call to action, as on the dashboard. An overflow menu beside a real primary
   * button is not that, and two filled buttons side by side is the hierarchy
   * problem this component was used to solve.
   */
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  /** Set when the menu was opened from the keyboard, so focus follows it in. */
  const [focusFirst, setFocusFirst] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // ★ An effect rather than a callback after `setOpen`.
  //
  // The entries do not exist until the state change has rendered, so focusing
  // them has to wait for the DOM. Waiting on `requestAnimationFrame` was the
  // first attempt and it is the wrong instrument: the frame can land after the
  // component unmounts, and nothing sequences it against React's commit.
  useEffect(() => {
    if (!open || !focusFirst) return;
    root.current?.querySelector<HTMLAnchorElement>("[role='menuitem']")?.focus();
    setFocusFirst(false);
  }, [open, focusFirst]);

  // Closing on an outside press uses `pointerdown` rather than `click`: a click
  // fires after the press completes, so a press that started outside and ended
  // on the menu would count as a selection.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** Arrow keys walk the entries; Home/End jump to the ends. */
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(
      root.current?.querySelectorAll<HTMLAnchorElement>("[role='menuitem']") ?? [],
    );
    if (entries.length === 0) return;

    const index = entries.indexOf(document.activeElement as HTMLAnchorElement);
    const focus = (next: number) => {
      event.preventDefault();
      entries[(next + entries.length) % entries.length]?.focus();
    };

    if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(entries.length - 1);
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <Button
        ref={trigger}
        size="sm"
        variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          // Opening with the keyboard should land inside the menu, not leave
          // the user pressing Tab to find out where it went.
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
          setFocusFirst(true);
        }}
      >
        {label}
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={onListKeyDown}
          /*
           * Right-aligned and wide enough for the longest entry. `z-30` clears
           * the sidebar (`z-20`), which a header menu on a desktop overlaps at
           * narrow widths.
           */
          className="absolute right-0 z-30 mt-2 w-[268px] overflow-hidden rounded-row border border-border bg-surface py-1 shadow-[0_8px_28px_rgba(15,23,42,.12)]"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              role="menuitem"
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex min-h-[52px] items-center gap-3 px-3 py-2 text-left text-ink hover:bg-canvas focus:bg-canvas focus:outline-none"
            >
              {item.icon ? <IconChip icon={item.icon} tone="primary" /> : null}
              <span className="min-w-0">
                <span className="block text-body font-medium leading-tight">{item.label}</span>
                {item.hint ? (
                  <span className="mt-0.5 block text-caption text-muted">{item.hint}</span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One entry of a `RowMenu` — something that happens when you choose it.
 *
 * ★ Exactly one of `href` and `onSelect`, and the type does not enforce that;
 * `RowMenu` prefers `href` when both are given.
 *
 * `href` arrived 2026-09-06 for the groups list, where one menu has to hold
 * both the group's three registers (destinations) and the five things you can
 * do to the group (actions). Splitting those into two controls is what that row
 * had before, and it is what the client asked to be rid of.
 *
 * The guarantee this type exists to make is unchanged and is the one that
 * matters: **an entry always does something.** A `RowMenuItem` with neither
 * field is unusable, and there is still no disabled variant — an action that
 * cannot be taken right now says so in `hint` and is omitted when it can never
 * be taken at all.
 */
export interface RowMenuItem {
  label: string;
  /** A destination. Renders a `<Link>`. */
  href?: string;
  /** An action. Renders a `<button>` and runs after the menu closes. */
  onSelect?: () => void;
  icon?: ReactNode;
  /** A second line — why an action is unavailable, or what it will do. */
  hint?: string;
  /** Paints the entry as a removal. Reserve it for what cannot be undone. */
  tone?: "default" | "danger";
  /** Draws a rule above this entry, separating two kinds of entry. */
  separated?: boolean;
}

/**
 * The overflow menu at the end of a list row — "⋯".
 *
 * ★ A second component rather than a `MenuItem` with an optional `onSelect`.
 *
 * `Menu` above is deliberately links-only, and its docblock says why: an entry
 * that goes nowhere teaches a teacher the product is broken, and the type is
 * what enforces it. A row menu is the opposite case — every entry *is* an
 * action, opening a dialog against the record on that row — so the same
 * guarantee is expressed the other way round: `onSelect` is required and there
 * is no `href` at all. One component cannot promise both.
 *
 * ★★ It closes before the handler runs.
 *
 * Every caller opens a dialog, and a menu still mounted underneath one steals
 * the outside-press that should dismiss the dialog. It also means the entry
 * cannot be a `Dialog.Trigger` — see the note on `ConfirmDialog`'s `trigger`.
 *
 * The accessibility contract is `Menu`'s, unchanged: `aria-haspopup`,
 * `aria-expanded`, `role="menu"`/`menuitem`, arrow keys, Escape, and focus
 * returned to the trigger.
 */
export function RowMenu({
  items,
  ariaLabel,
  className,
}: {
  items: RowMenuItem[];
  /** Names *this row's* menu — include the person or record. */
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focusFirst, setFocusFirst] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !focusFirst) return;
    root.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    setFocusFirst(false);
  }, [open, focusFirst]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // `HTMLElement`, not `HTMLButtonElement`: an entry is a button *or* a link
    // since `href` arrived, and the arrow keys have to walk both.
    const entries = Array.from(
      root.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
    );
    if (entries.length === 0) return;

    const index = entries.indexOf(document.activeElement as HTMLElement);
    const focus = (next: number) => {
      event.preventDefault();
      entries[(next + entries.length) % entries.length]?.focus();
    };

    if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(entries.length - 1);
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <Button
        ref={trigger}
        size="icon"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="text-muted hover:bg-canvas hover:text-ink"
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
          setFocusFirst(true);
        }}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={onListKeyDown}
          /*
           * Anchored to the row's right edge. `z-30` clears the sidebar for the
           * same reason `Menu`'s panel does; `bottom-full` is not used because
           * a list row is rarely the last thing on the screen and a menu that
           * flips direction is harder to predict than one that scrolls.
           */
          className="absolute right-0 z-30 mt-1 w-[232px] overflow-hidden rounded-row border border-border bg-surface py-1 text-left shadow-[0_8px_28px_rgba(15,23,42,.12)]"
        >
          {items.map((item) => {
            const className = cn(
              "flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-body hover:bg-canvas focus:bg-canvas focus:outline-none",
              item.tone === "danger" ? "text-danger" : "text-ink",
              item.separated && "mt-1 border-t border-border-soft pt-2.5",
            );

            const body = (
              <>
                {item.icon ? <span className="shrink-0 text-muted">{item.icon}</span> : null}
                <span className="min-w-0">
                  <span className="block truncate">{item.label}</span>
                  {item.hint ? (
                    <span className="block truncate text-caption text-muted">{item.hint}</span>
                  ) : null}
                </span>
              </>
            );

            return item.href ? (
              <Link
                key={item.label}
                role="menuitem"
                href={item.href}
                onClick={() => setOpen(false)}
                className={className}
              >
                {body}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={className}
              >
                {body}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
