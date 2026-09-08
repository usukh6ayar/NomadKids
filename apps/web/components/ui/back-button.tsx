"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { canGoBack, useGoBack } from "@/lib/nav-history";
import { cn } from "@/lib/utils";

/**
 * Буцах — one step back, from wherever the reader actually came from.
 *
 * ★ It used to be a link to the parent route, and that is a different thing.
 * A teacher who opened a child from their group's roster, or a director who
 * came from the ESIS panel on `/children`, pressed a button labelled with the
 * child's own record and landed somewhere they had never been — for a parent,
 * whose `/children` redirects, that is the home screen. The client's words
 * (2026-09-08): "буцах button дарахад хаанаас ч байсан нэг л ухрана".
 *
 * ★★ `href` stays, and is still a real `<a href>`. It is what Back means on a
 * page opened directly — a pasted URL, a new tab, a refresh — where there is no
 * history entry to return to and `router.back()` would do nothing at all,
 * stranding the reader on a screen whose only exit is the sidebar. It also
 * keeps ⌘-click and "open in new tab" meaningful, which a `<button>` cannot.
 *
 * ★★★ Which is why the label is "Буцах" rather than the destination's name.
 * The button no longer knows where it lands, so naming a screen would be a
 * guess printed as a fact — the failure this component exists to fix.
 */
export function BackButton({
  href,
  label = "Буцах",
  className,
}: {
  /** Where Back goes when this page was opened without any history behind it. */
  href: string;
  label?: string;
  className?: string;
}) {
  const goBack = useGoBack(href);

  return (
    <Button asChild variant="ghost" size="sm" className={cn("-ml-2 self-start", className)}>
      <Link
        href={href}
        onClick={(event) => {
          // A modified click is "open this somewhere else", and the somewhere
          // else is the href. Let the browser have it.
          if (
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            event.button !== 0
          ) {
            return;
          }
          // Nothing behind this page load: let the anchor do what it says.
          if (!canGoBack()) return;
          event.preventDefault();
          goBack();
        }}
      >
        <ArrowLeft size={18} aria-hidden />
        {label}
      </Link>
    </Button>
  );
}
