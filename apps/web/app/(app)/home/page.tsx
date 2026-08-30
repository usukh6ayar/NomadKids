"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { z } from "zod";
import { parentDashboardSchema, surveySchema, unreadCountSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { QuickTile, QuickTileGrid, TileIcon } from "@/components/ui/quick-tile";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { useSelectedChild } from "@/lib/selected-child";
import { formatAge, fullName } from "@/lib/format";
import { PORTFOLIO } from "@/lib/vocabulary";

/**
 * A parent's home.
 *
 * ★ A feed, not a dashboard — but not a dashboard with the feed cut off
 * either. The term-assessment badges and the day-grouped "Сүүлийн мөчүүд"
 * rail that used to sit below the tile grid are gone on request: this screen
 * is the launch pad into a child's own record now, not a second copy of what
 * that record already shows. `recent` and `currentTerm` are still in
 * `parentDashboardSchema` — the endpoint answers more than this screen reads
 * — but nothing here destructures or renders them.
 */
export default function ParentHomePage() {
  const { selectedChildId } = useSelectedChild();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.parent(),
    queryFn: () => get("/dashboard/parent", parentDashboardSchema),
  });

  // Powers the "Ангийн самбар" tile below — the same count the header bell
  // and the bottom bar's badge show, reused here as a share reason to open
  // /notifications rather than a bare number.
  const { data: unread } = useQuery({
    queryKey: qk.unreadCount(),
    queryFn: () => get("/notifications/unread-count", unreadCountSchema),
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <HomeBackdrop>
        <LoadingState rows={3} />
      </HomeBackdrop>
    );
  }

  if (isError) {
    return (
      <HomeBackdrop>
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </HomeBackdrop>
    );
  }

  const { children } = data!;

  if (children.length === 0) {
    return (
      <HomeBackdrop>
        <EmptyState
          title="Хүүхэд холбогдоогүй байна"
          description="Танд холбогдсон хүүхэд байхгүй байна. Цэцэрлэгийн багштайгаа холбогдоно уу."
        />
      </HomeBackdrop>
    );
  }

  // Falls back to the first child until `SelectedChildProvider` has read
  // `localStorage` (or for an id it no longer resolves to a real child, say
  // after an unenrollment) — never "wait for it", since that would leave this
  // screen's own loading state blocked on a value that only ever matters for
  // *which* child renders, not whether the page can render at all.
  const selected = children.find((child) => child.id === selectedChildId) ?? children[0]!;

  return (
    <HomeBackdrop>
      {/*
        ★ A plain white card, and two actions — both buttons, neither a link
        styled to look like one. `PORTFOLIO` moved back in from the grid
        below: it still leads that grid *and* has the bottom bar's "Зураг"
        tab, but this card is where a parent's eye already is, so the single
        most important destination in the product earns a third, closest
        path rather than making them look away from the child they just
        confirmed. `Хуваалцах` (submitting an observation from home) has no
        tile or tab of its own, so it keeps its round button, sized a step
        above the switcher's own 44px control since it is the one thing on
        this card meant to be pressed, not read.
      */}
      <Card pad="roomy" className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <ChildAvatar child={selected} size={72} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-heading font-semibold text-ink">{fullName(selected)}</p>
            <p className="text-lead text-muted">
              {[formatAge(selected.dateOfBirth), selected.group?.name].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 sm:ml-auto sm:shrink-0">
          <Button asChild className="flex-1 sm:flex-none">
            <Link href={`/children/${selected.id}/portfolio`}>
              <BookOpen size={20} aria-hidden="true" />
              {PORTFOLIO}
            </Link>
          </Button>
          <Link
            href={`/children/${selected.id}/observations/new`}
            aria-label="Ажиглалт хуваалцах"
            className="grid size-13 shrink-0 place-items-center rounded-pill bg-primary text-primary-ink shadow-md transition-colors hover:bg-primary-hover"
          >
            <Plus size={26} aria-hidden="true" />
          </Link>
        </div>
      </Card>

      {/*
        ★ A 3-column icon grid matching the parent's own mock-up: Ангийн
        самбар, Ирц, Хоол, Цэцэрлэг, Үнэлгээ, Судалгаа, Санхүү. The icon assets
        (icon-notice.png, icon-attendance.png, …) already carry their own
        colour per tile, so the grid reads as varied as the reference's
        icon-square grid without inventing a new colour system for it.
        `PORTFOLIO` is not a tile here — it is a button on the hero card
        above and the bottom bar's "Зураг" tab (`(app)/layout.tsx`'s
        `parentNav`); a third entry point on this grid would be the same
        destination three times on one screen.
        Судалгаа has its own permanent tile — `SurveyTile` below — landing on
        `/children/:id/surveys`, the list this grid's Судалгаа entry could
        not honestly point to before that page existed.
        Ирц, Хоол, Цэцэрлэг and Үнэлгээ each land on their own standalone
        route now (`/children/:id/attendance`, `/menu`, `/enrollment-archive`,
        `/assessments`) rather than a `?tab=` deep link into the child hub —
        the hub dropped those same tabs, so a deep link into them would no
        longer have opened anything.
        Цэцэрлэг is the client's own later addition — "Цэцэрлэг, бүлгийн
        архив", the current placement, its teacher, and the family's full
        enrollment history — sitting between Хоол and Үнэлгээ so the one
        `ComingSoonTile` (Санхүү) stays last in the grid.
        Санхүү is a `ComingSoonTile`, not a link: CLAUDE.md §7 keeps finance
        a later phase, and this screen does not get to pull it forward on
        its own — `(app)/layout.tsx`'s sidebar makes the same call there,
        naming it without a link rather than leaving it out entirely, which
        is the mock-up's own request for this tile specifically.
      */}
      <section aria-labelledby="board-heading">
        <SectionHeader id="board-heading" title="Түргэн холбоос" />
        <QuickTileGrid>
          <QuickTile
            href="/notifications"
            label="Ангийн самбар"
            badge={unread && unread.count > 0 ? unread.count : undefined}
            icon={<TileIcon name="notice" />}
          />
          <QuickTile
            href={`/children/${selected.id}/attendance`}
            label="Ирц"
            icon={<TileIcon name="attendance" />}
          />
          <QuickTile
            href={`/children/${selected.id}/menu`}
            label="Хоол"
            icon={<TileIcon name="menu" />}
          />
          <QuickTile
            href={`/children/${selected.id}/enrollment-archive`}
            label="Цэцэрлэг"
            icon={<TileIcon name="kindergarten" />}
          />
          <QuickTile
            href={`/children/${selected.id}/assessments`}
            label="Үнэлгээ"
            icon={<TileIcon name="progress" />}
          />
          <SurveyTile childId={selected.id} />
          <ComingSoonTile label="Санхүү" icon={<TileIcon name="finance" />} />
        </QuickTileGrid>
      </section>
    </HomeBackdrop>
  );
}

/**
 * A muted, looping video backdrop behind the whole page.
 *
 * ★ `absolute`, not `fixed` — and that choice is load-bearing, not stylistic.
 * `AppShell`'s outer `<div className="min-h-dvh bg-canvas">` wraps this whole
 * page, and it is a plain, non-positioned box: per the CSS painting order, its
 * own opaque background is a normal in-flow paint step, which always comes
 * *after* — i.e. on top of — a `position: fixed` negative-z-index descendant
 * in the same stacking context, no matter how deep that descendant is nested
 * or what z-index it carries. A `fixed -z-10` video here is invisible 100% of
 * the time, painted over by that ancestor's own background; this was verified
 * by sampling the composited page and getting the canvas colour back exactly,
 * with zero contribution from the video.
 *
 * `position: relative` on both this wrapper and the content sibling opens a
 * *local* stacking context that no ancestor can reach into, and DOM order
 * inside it (video div first, content div second) is what keeps the video
 * behind the cards — no z-index needed.
 *
 * ★★ Sized to the content sibling's own height, not a fixed banner height.
 * A fixed height (an earlier `h-56`, then `h-96`) cuts off mid-page
 * regardless of how much the query returns — for a family with two children,
 * or several recent moments, the cutoff landed inside a section (behind a
 * heading, un-faded) instead of between two of them, which read as a layout
 * bug rather than a banner edge. Sizing to the sibling instead means the
 * backdrop always ends exactly where the page does, however long that is.
 *
 * ★★★ Bled past this wrapper's own box with negative insets, not `inset-0`.
 * `<main>` in `AppShell` (app-shell.tsx) pads its content — `px-4 sm:px-6
 * lg:pl-8 lg:pr-8`, `pt-[22px] lg:pt-10` — so a plain `inset-0` here left the
 * backdrop sitting inside that padding: a band of bare canvas on both sides
 * and above, with the video's own rounded corners visible inside it. The
 * negative offsets below are `main`'s padding values themselves, so the
 * backdrop's top/left/right edges land exactly on `main`'s own border box —
 * flush against the sidebar on a desktop, edge-to-edge on a phone — with
 * nothing left over to round a corner against. If `main`'s padding scale
 * changes, these must change with it.
 *
 * The fade is a percentage gradient for the same reason: fixed pixel stops
 * only fade correctly for one content length. The video stays visible behind
 * nearly the whole page — every section sits on its own opaque `Card`, so
 * there is no legibility cost to the backdrop behind them staying video
 * rather than clearing to canvas early. Only the last stretch, `to-canvas`
 * from 92% to 100%, fades it out — a hard cut at the very bottom would read
 * as the clip being cropped rather than the page ending.
 *
 * Paused under `prefers-reduced-motion`: autoplay is otherwise unconditional,
 * and a looping background video is exactly the motion that preference exists
 * to suppress.
 */

const activeSurveysSchema = z.array(surveySchema);

/**
 * "Судалгаа" — a permanent tile, unlike the card it replaces.
 *
 * ★ Always a real link now: `/children/:id/surveys` lists every survey for
 * this child, answered or not, so — unlike the old single-pending-survey
 * card — this tile is never one this family cannot act on. The badge counts
 * only the unanswered ones, the same "a number, not a dot" rule `UnreadDot`
 * and `QuickTile`'s own `badge` prop already follow.
 */
function SurveyTile({ childId }: { childId: string }) {
  const { data } = useQuery({
    queryKey: qk.childSurveys(childId),
    queryFn: () => get(`/children/${childId}/surveys`, activeSurveysSchema),
    staleTime: 60_000,
    retry: false,
  });

  const pendingCount = data?.filter((survey) => !survey.respondedByMe).length ?? 0;

  return (
    <QuickTile
      href={`/children/${childId}/surveys`}
      label="Судалгаа"
      badge={pendingCount > 0 ? pendingCount : undefined}
      icon={<TileIcon name="survey" />}
    />
  );
}

/**
 * A tile that names a feature without linking to it — Санхүү, currently.
 *
 * ★ The sidebar's own device (`(app)/layout.tsx`'s `parentSections` doc
 * comment), applied to a grid tile instead of a menu row: CLAUDE.md §7 keeps
 * finance a later phase, and there is no `/finance` screen for this tile to
 * open. A `<div>`, not a `<Link>` — a route that 404s teaches someone the
 * product is broken, same reasoning as every other no-dead-link spot in this
 * codebase. Muted and non-interactive (`aria-disabled`, no hover state) so it
 * reads as "not yet" rather than as a tile that failed to respond to a tap.
 */
function ComingSoonTile({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <div
      aria-disabled="true"
      className="flex flex-col items-center gap-1.5 rounded-card border border-dashed border-border bg-canvas px-2 py-3 text-center opacity-60"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="text-compact font-semibold leading-tight text-ink">{label}</span>
      <span className="text-caption text-muted">Удахгүй</span>
    </div>
  );
}

function HomeBackdrop({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
    } else {
      void video.play();
    }
  }, []);

  /*
   * ★ This screen no longer scrolls — the tile grid replaced a taller page
   * (assessment badges, the day-grouped feed) that used to need it, and with
   * those gone the remaining content fits one phone screen at a normal
   * viewport height. Locking the body while this page is mounted removes the
   * scroll gesture entirely rather than just resizing to fit it: a phone
   * browser's address bar can still collapse on an attempted scroll or an
   * overscroll bounce even when there is nothing left to reveal, and that
   * transition is what was making the bottom bar appear to disappear.
   * Nothing to scroll means nothing triggers that transition. Same recipe as
   * `ChildPickerModal` and `PhotoViewer` (`(app)/layout.tsx`,
   * `child-gallery.tsx`) lock the body while they are open; the cleanup
   * restores normal scrolling the instant this page unmounts, so no other
   * route inherits the lock.
   */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute -left-4 -right-4 -top-5.5 bottom-0 overflow-hidden sm:-left-6 sm:-right-6 lg:-left-8 lg:-right-8 lg:-top-10"
        aria-hidden="true"
      >
        <video
          ref={videoRef}
          className="h-full w-full object-cover object-top filter-[saturate(1.7)_contrast(1.25)_brightness(0.97)]"
          src="/video.mp4"
          autoPlay
          loop
          muted
          playsInline
        />
        <div className="absolute inset-0 bg-canvas/5" />
        <div className="absolute inset-0 bg-linear-to-b from-transparent from-92% to-canvas to-100%" />
      </div>
      <div className="relative flex flex-col gap-3 py-1 lg:gap-8 lg:py-2">{children}</div>
    </div>
  );
}
