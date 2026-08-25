"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * One year of the portfolio, collapsible.
 *
 * ★ Why every age still renders, even the ones that have not happened.
 *
 * RFP §4.3 is explicit: "2, 3, 4, 5 нас тус бүрд тусдаа мэдээллийн хуудастай
 * байна" — each of ages 2 to 5 has its own page. So the sections are not
 * conditional and the anchors they carry are not conditional either; a link to
 * `#age-5` has to resolve for a two-year-old.
 *
 * What was wrong was rendering all four *expanded*. A newly registered
 * two-year-old's portfolio opened as nine empty boxes and nine "Засах" buttons,
 * three of them inviting staff to fill in years that are up to three years
 * away. A record that is mostly placeholders reads as unfinished rather than as
 * one being built — and the RFP's own field list is more than twice what is
 * implemented today, so the page gets longer from here, not shorter.
 *
 * ★★ `<details>` rather than state.
 *
 * It works before hydration, it keeps the platform's keyboard and
 * find-in-page behaviour, and `NavGroup` in the sidebar already uses it — one
 * disclosure primitive in the product rather than two. `open` is still mirrored
 * into state for the anchor case below.
 *
 * ★★★ An age that already has content opens regardless of the child's age.
 *
 * Whoever wrote into a future year meant it — a family filling in "5 нас" early,
 * or a record imported from paper. Collapsing writing that exists would hide
 * real content behind a rule about dates.
 */
export function AgeSectionShell({
  age,
  anchor,
  headingId,
  /** Whether anything has been written into this year yet. */
  filled,
  /** The child's age in whole years; `null` when the date of birth is unusable. */
  currentAge,
  /** The edit control, rendered inside the panel rather than in the summary. */
  action,
  children,
}: {
  age: number;
  anchor: string;
  headingId: string;
  filled: boolean;
  currentAge: number | null;
  action?: ReactNode;
  children: ReactNode;
}) {
  // An unknown date of birth opens everything: a missing birthday is a reason
  // to show the record, not to hide three quarters of it.
  const reached = currentAge === null || age <= currentAge;
  const [open, setOpen] = useState(filled || reached);

  /*
   * ★ `filled` is false on the first render, always.
   *
   * The age profiles are a separate request, enabled only once the child has
   * loaded, so this component mounts before its content exists. Seeding
   * `useState` with `filled` therefore seeded it with "empty" every time, and a
   * future year somebody had already written into stayed shut — the exact case
   * the rule above is for. `useState` does not re-seed; an effect is what
   * notices the answer arriving.
   *
   * It only ever opens. Forcing `open` to track `filled` in both directions
   * would re-open a section the reader had deliberately collapsed, every time
   * the query refetched.
   */
  useEffect(() => {
    if (filled) setOpen(true);
  }, [filled]);

  /*
   * ★ The age row links to `#age-4`; without this it would scroll a collapsed
   * section into view and show its summary.
   *
   * The fragment lands on the `<section>`, not inside the `<details>`, so the
   * browsers that auto-expand a disclosure containing the target do not fire
   * here. Listening to `hashchange` covers every jump after the first and the
   * initial check covers a link opened from outside.
   */
  useEffect(() => {
    const openIfTargeted = () => {
      if (window.location.hash === `#${anchor}`) setOpen(true);
    };

    openIfTargeted();
    window.addEventListener("hashchange", openIfTargeted);
    return () => window.removeEventListener("hashchange", openIfTargeted);
  }, [anchor]);

  const status = filled
    ? { label: "Бөглөсөн", tone: "mint" as const }
    : reached
      ? { label: "Хоосон", tone: "neutral" as const }
      : { label: "Ирээдүйд", tone: "neutral" as const };

  return (
    <section id={anchor} aria-labelledby={headingId} className="scroll-mt-20">
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="rounded-card border border-border bg-surface shadow-sm"
      >
        {/*
          `list-none` plus the webkit rule removes the native marker, since the
          chevron on the right is the one that rotates. 44px minimum: this is
          the control that opens the section, so it is a tap target like any
          other.
        */}
        <summary
          className={cn(
            "flex min-h-[44px] cursor-pointer list-none items-center gap-2.5 px-3 py-3 md:gap-3 md:px-5 md:py-3.5",
            "[&::-webkit-details-marker]:hidden",
          )}
        >
          <h2
            id={headingId}
            className="min-w-0 truncate text-lead font-semibold leading-tight text-ink md:text-title"
          >
            {age} нас
          </h2>
          {/* The label carries the state; the tint only reinforces it. */}
          <Badge tone={status.tone}>{status.label}</Badge>
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={cn("ml-auto shrink-0 text-faint transition-transform", open && "rotate-180")}
          />
        </summary>

        <div className="border-t border-border-soft px-3 py-3 md:px-5 md:py-4">
          {children}
          {action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </details>
    </section>
  );
}
