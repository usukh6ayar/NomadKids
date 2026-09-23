"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * In-page tabs — one view of a screen at a time, without a route change.
 *
 * ★ Added 2026-09-23, modelled on `/admin/funding`'s private `TabButton` —
 * which is where the staff, group and group-detail screens would each have
 * copied it from otherwise. Four hand-rolled tab strips is how a product ends
 * up with four underline thicknesses and two different focus rings for one
 * control.
 *
 * ★★ **`/admin/funding` itself has not been migrated onto this**, and the
 * honest reason is that it is more than a substitution: its tab strip shares a
 * bordered row with a legend, so the `border-b` here would land in the wrong
 * place, and the file keeps a private `TableShell` of its own besides. Doing
 * it properly is its own change with its own review. Until then the two look
 * the same because this was copied from that, which is a debt rather than a
 * design — recorded so the next person can settle it deliberately.
 *
 * ★★ It is deliberately **not** a route. The tab a director is on is a view of
 * the same screen, not a place — `/admin/users` and `/admin/users?tab=esis`
 * would put the sidebar's active-row matching (which reads `pathname` and
 * carries no query string) in charge of a distinction it cannot see.
 *
 * ★★★ The same goes for `/reports`, `/children/import` and the respondents
 * screen. They are migrated when they are next touched rather than in a sweep,
 * so that a visual change to any of them is reviewable on its own.
 */
export function Tabs({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-6 border-b border-border">
      {children}
    </div>
  );
}

export function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Omitted where the tab has nothing countable behind it. */
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px min-h-[44px] border-b-2 px-1 text-lead font-semibold transition-colors",
        active ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
      {count === undefined ? null : (
        <span className="ml-2 text-body font-medium tabular-nums text-faint">{count}</span>
      )}
    </button>
  );
}
