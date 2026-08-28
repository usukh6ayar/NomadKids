"use client";

import { useQuery } from "@tanstack/react-query";
import { unreadCountSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { SectionHeader } from "@/components/ui/card";
import { QuickTile, QuickTileGrid, TileIcon } from "@/components/ui/quick-tile";
import { Skeleton } from "@/components/ui/states";
import { useMyGroup } from "./use-my-group";

/**
 * "Түргэн холбоос" — the staff launcher grid.
 *
 * ★ The parent's home grid, on the teacher's screen, on request. Same
 * component (`ui/quick-tile.tsx`), same illustrated icon set, same three
 * columns on a phone — what differs is the six destinations, because a teacher
 * and a parent do not open the same screens.
 *
 * ★★ It sits *above* the widgets, not instead of them.
 *
 * The register, today's menu, the survey panel and the rest each answer "what
 * is true right now"; this grid answers "where do I go". The client asked for
 * both, three times for the widgets (see `dashboard/page.tsx`'s ★★★), so the
 * grid is an addition and nothing below it was removed to make room.
 *
 * ★★★ Six tiles, and every one of them opens something that exists.
 *
 * `staffSections` (`(app)/layout.tsx`) states the rule flatly — "Every entry
 * goes somewhere. There are no 'удахгүй' placeholders" — and it is the reason
 * the parent grid's `Санхүү` tile has no counterpart here. A teacher reading a
 * dead tile every morning learns the product is broken; the parent shell
 * carries that one because the client's mock-up asks for it there
 * specifically.
 *
 * ★★★★ Ирц and Хоол are group-scoped, so they are conditional.
 *
 * Neither has a top-level route — `/groups/:id/attendance` and
 * `/groups/:id/meals` both need the group `useMyGroup()` resolves, which is
 * why the sidebar has never listed them. A teacher with no group assigned
 * simply does not get those two tiles, rather than getting a link to
 * `/groups/undefined/meals`. While the group is still loading they hold their
 * space as skeletons: four tiles resolving into six would reflow the whole
 * dashboard under the reader's thumb.
 */
export function QuickLinks() {
  const { group, isLoading: groupLoading } = useMyGroup();

  /*
   * The same count the header bell and the bottom bar's badge already show —
   * one shared query key, so this tile costs no extra request. `retry: false`
   * and no error branch: a badge that fails to load is a missing number, not a
   * reason to interrupt the screen.
   */
  const { data: unread } = useQuery({
    queryKey: qk.unreadCount(),
    queryFn: () => get("/notifications/unread-count", unreadCountSchema),
    staleTime: 60_000,
    retry: false,
  });

  return (
    <section aria-labelledby="quick-links-heading">
      <SectionHeader id="quick-links-heading" title="Түргэн холбоос" />

      {/*
        Three columns on a phone, six on a laptop — one row rather than two
        half-empty ones, in space the sidebar leaves over. The phone count is
        `QuickTileGrid`'s own and is not overridden here.
      */}
      <QuickTileGrid className="sm:grid-cols-6">
        <QuickTile
          href="/children"
          label="Хүүхдүүд"
          icon={<TileIcon src="/icons/icon-portfolio.png" />}
        />
        <QuickTile
          href="/observations/review"
          label="Ажиглалт хянах"
          icon={<TileIcon src="/icons/icon-checklist.png" />}
        />
        <QuickTile
          href="/notifications"
          label="Ангийн самбар"
          badge={unread && unread.count > 0 ? unread.count : undefined}
          icon={<TileIcon src="/icons/icon-notice.png" />}
        />

        {groupLoading ? (
          <>
            <TileSkeleton />
            <TileSkeleton />
          </>
        ) : group ? (
          <>
            <QuickTile
              href={`/groups/${group.id}/attendance`}
              label="Ирц"
              icon={<TileIcon src="/icons/icon-attendance.png" />}
            />
            <QuickTile
              href={`/groups/${group.id}/meals`}
              label="Хоол"
              icon={<TileIcon src="/icons/icon-menu.png" />}
            />
          </>
        ) : null}

        <QuickTile
          href="/surveys"
          label="Судалгаа"
          icon={<TileIcon src="/icons/icon-survey.png" />}
        />
      </QuickTileGrid>
    </section>
  );
}

/**
 * A tile's exact footprint, with nothing in it yet.
 *
 * The padding and the icon size are `QuickTile`'s own, so the row does not
 * change height when the group resolves.
 */
function TileSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col items-center gap-2 rounded-card border border-border bg-surface px-2 py-4"
    >
      <Skeleton className="size-11 rounded-control" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}
