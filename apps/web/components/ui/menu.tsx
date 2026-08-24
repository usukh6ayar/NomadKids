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
import { Button } from "@/components/ui/button";
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
  className,
}: {
  label: ReactNode;
  items: MenuItem[];
  /** Names the menu itself, for a screen reader listing it. */
  ariaLabel: string;
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
              {item.icon ? (
                <span className="grid size-9 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
                  {item.icon}
                </span>
              ) : null}
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
