"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { NavTile, TileGrid } from "@/components/ui/tile";
import { cn } from "@/lib/utils";

export interface ChildTab {
  /** Also the `?tab=` value. Keep it stable — it appears in shared links. */
  value: string;
  label: string;
  content: ReactNode;
  /**
   * Kept out of the tab strip and reached through "Бусад" instead.
   *
   * ★ Ten tabs is not a tab bar, it is a horizontal scroll nobody scrolls.
   *
   * The strip grew one tab at a time as Phase III landed — attendance, growth,
   * health, incidents, artwork, menu — and each addition was individually
   * reasonable. At ten, the sixth through tenth are off the right edge of a
   * 375px screen with no indication they exist, which is the same failure as
   * hiding them: a teacher who has never scrolled a tab strip does not know
   * the artwork section is there.
   *
   * Five primary plus a "more" pane is what a phone app does, and it costs
   * nothing here because `?tab=` still addresses every section directly — a
   * link to `?tab=artwork` opens artwork whether or not it is in the strip.
   */
  secondary?: boolean;
  /** Shown on the tile in the "Бусад" pane. */
  icon?: ReactNode;
  /** One short line under the tile's label. */
  note?: string;
}

/** The value of the pane that holds the secondary tabs. */
const MORE = "more";

/**
 * The child profile's four sections.
 *
 * ★ This screen used to scroll rather than tab, deliberately, and the reason is
 * still true: on a phone a tab bar hides three quarters of a record behind
 * taps. The client asked for tabs on 2026-08-23 and that is their call — what
 * makes the cost recoverable is the URL.
 *
 * `?tab=` is the source of truth, not component state. Without it, refreshing
 * on a child's assessments drops you back on "Ерөнхий", the browser's Back
 * button leaves the page entirely instead of returning to the previous tab, and
 * a teacher cannot send a colleague a link to what they are looking at. Those
 * are the three things a tab bar costs when it is built out of `useState`, and
 * all three are what a scrolling page never had to pay.
 *
 * `router.replace`, not `push`: switching tabs is not a navigation someone
 * wants to unwind one step at a time, and `scroll: false` keeps the hero in
 * place — re-anchoring to the top on every tab press is disorienting on a
 * phone, where the tab strip itself is what you just touched.
 *
 * ★★ Radix rather than a hand-rolled strip. It brings the roving tabindex,
 * arrow-key movement and the `tab`/`tabpanel` wiring — the parts that are
 * invisible until someone navigates without a mouse. This file only decides
 * what the tabs look like and where their state lives.
 */
export function ChildTabs({ tabs, paramName = "tab" }: { tabs: ChildTab[]; paramName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get(paramName);
  // An unknown `?tab=` falls back to the first rather than rendering nothing:
  // a hand-edited or stale link should open the record, not an empty page.
  const active =
    tabs.some((t) => t.value === requested) || requested === MORE ? requested! : tabs[0]!.value;

  const primary = tabs.filter((tab) => !tab.secondary);
  const secondary = tabs.filter((tab) => tab.secondary);

  /*
   * A secondary section is open, so "Бусад" is the lit tab.
   *
   * Radix needs the active value to match a trigger it rendered; without this
   * the strip would show nothing lit while `?tab=artwork` was open, and the
   * keyboard's arrow keys would have no starting point.
   */
  const activeIsSecondary = secondary.some((tab) => tab.value === active);
  const stripValue = activeIsSecondary ? MORE : active;

  const onValueChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    // The default tab leaves no parameter behind, so the canonical URL of a
    // child is the bare path rather than `?tab=general`.
    if (next === tabs[0]!.value) params.delete(paramName);
    else params.set(paramName, next);

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <TabsPrimitive.Root value={stripValue} onValueChange={onValueChange}>
      {/*
        Horizontally scrollable below `sm`. Four Mongolian labels do not fit in
        375px, and the alternatives are both worse: wrapping to two rows pushes
        the content down on the smallest screen, and shrinking the type puts the
        labels under the 16px floor. `-mx-4 px-4` lets the strip bleed to the
        screen edge so it is visibly scrollable rather than looking clipped.
      */}
      <TabsPrimitive.List
        aria-label="Хүүхдийн мэдээллийн хэсгүүд"
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {primary.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              // -1px pulls the underline onto the list's own border so the two
              // read as one rule rather than as a double line.
              "relative -mb-px min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-3.5 text-body font-medium transition-colors",
              "border-transparent text-muted hover:text-ink",
              "data-[state=active]:border-primary data-[state=active]:text-primary-strong",
            )}
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}

        {secondary.length > 0 ? (
          <TabsPrimitive.Trigger
            value={MORE}
            className={cn(
              "relative -mb-px min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-3.5 text-body font-medium transition-colors",
              "border-transparent text-muted hover:text-ink",
              "data-[state=active]:border-primary data-[state=active]:text-primary-strong",
            )}
          >
            Бусад
          </TabsPrimitive.Trigger>
        ) : null}
      </TabsPrimitive.List>

      {/*
        The "more" pane: a tile per secondary section.
        
        Real links to `?tab=`, not buttons — right-click, middle-click and
        "copy link" all work, and a section stays shareable. The page already
        reads the parameter, so following one lands on the section itself.
      */}
      {secondary.length > 0 ? (
        <TabsPrimitive.Content value={MORE} className="pt-5 focus-visible:outline-none">
          <TileGrid>
            {secondary.map((tab) => (
              <NavTile
                key={tab.value}
                href={`${pathname}?${paramName}=${tab.value}`}
                label={tab.label}
                note={tab.note}
                icon={tab.icon ?? <LayoutGrid size={24} aria-hidden />}
              />
            ))}
          </TileGrid>
        </TabsPrimitive.Content>
      ) : null}

      {tabs.map((tab) => (
        <TabsPrimitive.Content
          key={tab.value}
          value={tab.value}
          // Radix removes the focus ring's usual reason to exist here — the
          // panel is focusable so a keyboard user lands in the content after
          // the tab strip, and `outline-none` would silently remove that.
          className="pt-5 focus-visible:outline-none"
        >
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
