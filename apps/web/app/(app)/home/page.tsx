"use client";

import { useQuery } from "@tanstack/react-query";
import NextImage from "next/image";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { z } from "zod";
import { parentDashboardSchema, surveySchema, unreadCountSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
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
        ★ Profile and portfolio are peers rather than actions crowded into
        one card. The selected child's identity stays unboxed at the left;
        the portfolio gets the quiet illustrated banner from the reference.
        Both remain driven by the selected child — the sample name in the
        visual is content, not a value this screen may hard-code.
      */}
      <div className="mb-2 flex flex-col gap-6 px-1 sm:px-2 lg:mb-0 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-5">
          <ChildAvatar
            child={selected}
            size={96}
            className="shrink-0 border-2 border-white shadow-sm"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-display font-bold text-gray-900">{fullName(selected)}</h1>
            <p className="mt-1 text-compact font-medium text-gray-500">
              {[formatAge(selected.dateOfBirth), selected.group?.name].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <Link
          href={`/children/${selected.id}/portfolio`}
          className="group flex w-full items-center justify-between gap-5 overflow-hidden rounded-card border border-gray-100 bg-gradient-to-r from-white to-gray-100/80 px-6 py-4 shadow-sm transition-[border-color,box-shadow] hover:border-primary/30 hover:shadow-md lg:min-w-[390px] lg:max-w-[430px]"
        >
          <span className="text-title font-bold text-gray-800">{PORTFOLIO}</span>
          <span
            className="relative grid size-20 shrink-0 place-items-end overflow-hidden rounded-card bg-amber-100"
            aria-hidden="true"
          >
            <NextImage
              src="/background/mascot-girl-teal-b.webp"
              alt=""
              width={88}
              height={132}
              className="h-[76px] w-auto translate-y-2 object-contain transition-transform group-hover:scale-105"
            />
          </span>
        </Link>
      </div>

      {/*
        ★ A 3-column icon grid matching the parent's own mock-up: Ангийн
        самбар, Ирц, Хоол, Цэцэрлэг, Үнэлгээ, Судалгаа, Санхүү. The icon assets
        (icon-notice-3d.png, icon-attendance-3d.png, …) already carry their own
        colour per tile, so the grid reads as varied as the reference's
        icon-square grid without inventing a new colour system for it.
        `PORTFOLIO` is not a tile here — it is the illustrated banner
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
        enrollment history — sitting between Хоол and Үнэлгээ.
        Санхүү was a `ComingSoonTile` (a `<div>`, not a `<Link>`) while
        CLAUDE.md §7 kept finance a later phase; invoices are built now
        (`нэмэлт.md` §7–§10) and it is a real `QuickTile` to
        `/children/:id/finance`, the same route `(app)/layout.tsx`'s sidebar
        points its own "Төлбөр" row at.
      */}
      <section aria-label="Түргэн холбоос" className="rounded-card bg-blue-50/40 p-4 sm:p-5 lg:p-6">
        <QuickTileGrid className="gap-3 lg:gap-4">
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
            icon={<TileIcon name="food" />}
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
          <QuickTile
            href={`/children/${selected.id}/finance`}
            label="Санхүү"
            icon={<TileIcon name="finance" />}
          />
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
