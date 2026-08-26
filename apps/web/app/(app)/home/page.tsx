"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, ChevronRight, HeartPulse, Plus, Ruler } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { parentDashboardSchema, surveySchema, unreadCountSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { NavTile, TileGrid } from "@/components/ui/tile";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { useSession } from "@/lib/auth/session";
import { excerpt, formatAge, fullName, groupByDay } from "@/lib/format";
import { GALLERY, PORTFOLIO } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";

/**
 * A parent's home.
 *
 * ★ A feed, not a dashboard. The question a parent opens this to answer is
 * "what happened with my child today", and counts do not answer it. So: who
 * they are, what the teacher shared, and a way into the portfolio.
 *
 * The observations here are already filtered by the API to what this family may
 * see — a private teaching note is not in the response. This screen does no
 * filtering of its own, which is what keeps the rule in one place.
 */
export default function ParentHomePage() {
  const { session } = useSession();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.parent(),
    queryFn: () => get("/dashboard/parent", parentDashboardSchema),
  });

  // Powers the "Ангийн самбар" preview row below — the same count the header
  // bell and the bottom bar's badge show, reused here as a share reason to
  // open /notifications rather than a bare number.
  const { data: unread } = useQuery({
    queryKey: qk.unreadCount(),
    queryFn: () => get("/notifications/unread-count", unreadCountSchema),
    staleTime: 60_000,
    retry: false,
  });

  /**
   * Which child's summary is expanded.
   *
   * `null` means "the first one". A family with one child — most of them —
   * never sees a switcher at all; with two or more it becomes a row of chips,
   * which is one tap and no menu.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /*
   * ★ `PageHeader`, and a title that says something.
   *
   * Four branches of this component each hand-rolled `<h1>Нүүр</h1>` — a
   * navigation label used as a page title, which tells a parent nothing they
   * did not already know from tapping it, in typography that matched neither
   * `PageHeader` nor the other branches.
   *
   * `AppLayout` holds the whole tree behind a loading state until the session
   * resolves, so the name is present on the first render here and the greeting
   * does not appear a beat late.
   */
  const header = (
    <PageHeader
      title={session?.user.firstName ? `Сайн байна уу, ${session.user.firstName}` : "Сайн байна уу"}
      lede="Хүүхдийнхээ сүүлийн мэдээллийг эндээс харна."
    />
  );

  if (isLoading) {
    return (
      <HomeBackdrop>
        {header}
        <LoadingState rows={3} />
      </HomeBackdrop>
    );
  }

  if (isError) {
    return (
      <HomeBackdrop>
        {header}
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

  const { children, recent, currentTerm } = data!;

  if (children.length === 0) {
    return (
      <HomeBackdrop>
        {header}
        <EmptyState
          title="Хүүхэд холбогдоогүй байна"
          description="Танд холбогдсон хүүхэд байхгүй байна. Цэцэрлэгийн багштайгаа холбогдоно уу."
        />
      </HomeBackdrop>
    );
  }

  const selected = children.find((c) => c.id === selectedId) ?? children[0]!;

  return (
    <HomeBackdrop>
      {header}

      {/*
        ★ A group of toggles, not a tab set.

        These carried `role="tablist"` and `role="tab"` with `aria-selected`, and
        none of what those roles promise was here: no `tabpanel`, no
        `aria-controls`, no roving tabindex, no arrow-key movement. A screen
        reader announced "tab, 1 of 3" and then the arrow keys did nothing, and a
        keyboard user had to Tab past every child instead of one stop for the
        group. Claiming a pattern is worse than not claiming one — it tells
        somebody a structure exists and then withholds it.

        `aria-pressed` is what these actually are: buttons that stay in.
      */}
      {children.length > 1 ? (
        <div
          role="group"
          aria-label="Хүүхэд сонгох"
          // Scrolls inside itself rather than widening the page — four children
          // with long names would otherwise push the layout sideways at 375px.
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
        >
          {children.map((child) => {
            const active = child.id === selected.id;
            return (
              <button
                key={child.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedId(child.id)}
                className={cn(
                  "flex min-h-[44px] shrink-0 items-center gap-2 rounded-pill border px-3 py-2 text-body font-medium",
                  active
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border bg-surface text-muted",
                )}
              >
                <ChildAvatar child={child} size={28} />
                <span className="max-w-[140px] truncate">{child.firstName}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <Card pad="roomy" className="flex flex-wrap items-center gap-4">
        <ChildAvatar child={selected} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-title font-semibold text-ink">{fullName(selected)}</p>
          <p className="text-body text-muted">
            {[formatAge(selected.dateOfBirth), selected.group?.name].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button asChild size="sm">
            <Link href={`/children/${selected.id}/portfolio`}>
              <BookOpen size={18} />
              {PORTFOLIO}
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/children/${selected.id}/observations/new`}>
              <Plus size={18} />
              Хуваалцах
            </Link>
          </Button>
        </div>
      </Card>

      {/*
        ★ Entry points, restyled to the reference's icon-circle row —
        `RowCard`'s own radius and border, applied straight to the `Link` since
        the whole row is the click target, matching `ChildRow` elsewhere.
        Every reference card that names an out-of-MVP feature (Санхүү, Чат —
        CLAUDE.md §7) is left out rather than dimmed or marked "удахгүй": the
        sidebar's own rule already forbids a menu entry that goes nowhere, and
        the same reasoning holds here. Ирц and Хоол ба цэс are no longer
        among them — both shipped 2026-08-24. Судалгаа shipped the same day
        too, but earns no permanent slot here at all — see `SurveyPrompt`
        below, which renders only while an unanswered one actually exists,
        matching the reference's own "Бөглөх судалгаа" card.
      */}
      <section aria-labelledby="board-heading">
        <SectionHeader id="board-heading" title="Ангийн самбар" />
        <div className="flex flex-col gap-2">
          <Link
            href="/notifications"
            className="flex min-h-16 items-center gap-3 rounded-row border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
          >
            <Image
              src="/icons/icon-notice.webp"
              alt=""
              width={40}
              height={40}
              className="size-10 shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">
                {unread && unread.count > 0
                  ? `${unread.count} шинэ мэдээ байна`
                  : "Шинэ мэдээ алга"}
              </span>
              <span className="block text-body text-muted">Ангийн сүүлийн мэдээллийг харах</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden />
          </Link>

          <SurveyPrompt childId={selected.id} />
        </div>
      </section>

      {/*
        ★ An icon grid, not a column of rows — 2026-08-25.
        
        This was five full-width rows, each an icon, a title, a subtitle and a
        chevron. On a phone that is five screenfuls of scrolling to reach the
        fifth destination, and the subtitles were doing the work a label should
        do on its own. The grid puts every destination one thumb-reach away and
        makes the set scannable as a shape rather than read as a list.

        `NavTile`'s `icon` is a slot, which is what let the illustrations land
        here without touching the component: four of the six now carry the
        artwork from `public/icons/`, and the two with no illustration yet keep
        a lucide glyph. See the note on those two below.
      */}
      <section aria-labelledby="highlights-heading">
        <SectionHeader id="highlights-heading" title={`${selected.firstName}-ийн мэдээлэл`} />

        <TileGrid>
          <NavTile
            href={`/children/${selected.id}/portfolio`}
            label={PORTFOLIO}
            note={`${GALLERY}, "Миний тухай"`}
            tone="cornflower"
            icon={<Image src="/icons/icon-portfolio.webp" alt="" width={48} height={48} />}
          />
          <NavTile
            href={`/children/${selected.id}`}
            label="Хөгжил"
            note="Ажиглалт, ахиц"
            tone="mint"
            icon={<Image src="/icons/icon-progress.webp" alt="" width={48} height={48} />}
          />
          <NavTile
            href={`/children/${selected.id}?tab=attendance`}
            label="Ирц"
            note="Өдөр тутам, чөлөөний хүсэлт"
            tone="sun"
            icon={<Image src="/icons/icon-attendance.webp" alt="" width={48} height={48} />}
          />
          <NavTile
            href={`/children/${selected.id}?tab=menu`}
            label="Хоол ба цэс"
            note="Долоо хоног"
            tone="peach"
            icon={<Image src="/icons/icon-menu.webp" alt="" width={48} height={48} />}
          />
          {/*
            ★ These two still carry lucide glyphs while the four above carry the
            illustrations, and the mix is deliberate rather than unfinished
            work: `public/icons/` has no health or growth illustration yet.
            Substituting a near-enough one — `icon-checklist` for Эрүүл мэнд —
            would teach a parent the wrong symbol and be harder to correct later
            than an obviously provisional glyph. `NavTile.icon` is a slot for
            exactly this reason; swapping them is a change at this call site.
          */}
          <NavTile
            href={`/children/${selected.id}?tab=health`}
            label="Эрүүл мэнд"
            note="Харшил, эм"
            tone="teal"
            icon={<HeartPulse size={24} aria-hidden />}
          />
          <NavTile
            href={`/children/${selected.id}?tab=growth`}
            label="Өсөлт"
            note="Өндөр, жин"
            tone="sky"
            icon={<Ruler size={24} aria-hidden />}
          />
        </TileGrid>
      </section>

      {selected.assessments.length > 0 ? (
        <section aria-labelledby="development-heading">
          <SectionHeader
            id="development-heading"
            title={currentTerm ? `${currentTerm.name} — хөгжлийн үнэлгээ` : "Хөгжлийн үнэлгээ"}
          />
          <Card className="flex flex-wrap gap-2 px-4 py-4">
            {selected.assessments.map((assessment, index) => (
              <Badge key={`${assessment.domain?.id}-${index}`} tone="sky">
                {assessment.domain?.name}: {assessment.level?.label}
              </Badge>
            ))}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="recent-heading">
        <SectionHeader id="recent-heading" title="Сүүлийн мөчүүд" />

        {recent.length === 0 ? (
          <EmptyState
            title="Одоогоор шинэ мэдээлэл алга"
            description="Багш ажиглалт хуваалцахад энд харагдана."
          />
        ) : (
          /*
           * ★ A day-grouped rail, not a flat list.
           *
           * The question this whole page exists to answer is "what happened
           * with my child today" — recency ordered by day, not by row, is
           * the actual shape of that answer. Each entry used to carry its own
           * relative timestamp ("3 хоногийн өмнө") on every row; grouped by
           * day, that fact belongs to the day once, not to each row inside
           * it, so the rail's label replaces it rather than duplicating it.
           * `formatRelative` already returns exactly this vocabulary —
           * Өнөөдөр / Өчигдөр / an absolute date past a fortnight — reused
           * here as the group's label instead of a per-row stamp.
           */
          <div className="flex flex-col">
            {groupByDay(recent, (item) => item.observedOn).map((group, index, all) => (
              <div key={group.key} className="flex gap-3">
                <div className="flex w-5 shrink-0 flex-col items-center" aria-hidden="true">
                  <span className="mt-2 size-2.5 shrink-0 rounded-pill bg-primary ring-4 ring-primary-soft" />
                  {index < all.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
                </div>
                <div className={cn("min-w-0 flex-1", index < all.length - 1 && "pb-5")}>
                  <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">
                    {group.label}
                  </h3>
                  <Card className="divide-y divide-border">
                    {group.items.map((item) => (
                      <Link
                        key={item.id}
                        href={item.child ? `/children/${item.child.id}` : "/children"}
                        className="flex min-h-[64px] items-start gap-3 px-4 py-3 hover:bg-canvas"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink">
                              {item.type?.name ?? "Ажиглалт"}
                            </span>
                            {/* A family's own submission, so they can tell it apart. */}
                            {item.source === "PARENT" ? (
                              <Badge tone="sky">Таны хуваалцсан</Badge>
                            ) : null}
                            {item.reviewStatus === "PENDING" ? (
                              <Badge tone="sun">Хүлээгдэж буй</Badge>
                            ) : null}
                            {item.reviewStatus === "RETURNED" ? (
                              <Badge tone="peach">Буцаагдсан</Badge>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-body text-muted">
                            {excerpt(item.situation, 100) || "Тайлбаргүй"}
                          </span>
                          {children.length > 1 && item.child ? (
                            <span className="mt-0.5 block text-caption text-muted">
                              {fullName(item.child)}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    ))}
                  </Card>
                </div>
              </div>
            ))}
          </div>
        )}
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
 * "Бөглөх судалгаа" — present only while it is true.
 *
 * ★ Renders nothing (not a disabled or greyed row) when there is no
 * unanswered survey for the selected child. A permanent card here would be
 * exactly the dead menu entry `(app)/layout.tsx`'s sidebar rule forbids;
 * this is the same rule applied to a card instead of a nav item.
 */
function SurveyPrompt({ childId }: { childId: string }) {
  const { data } = useQuery({
    queryKey: qk.childSurveys(childId),
    queryFn: () => get(`/children/${childId}/surveys`, activeSurveysSchema),
    staleTime: 60_000,
    retry: false,
  });

  const pending = data?.find((survey) => !survey.respondedByMe);
  if (!pending) return null;

  return (
    <Link
      href={`/children/${childId}/surveys/${pending.id}`}
      className="flex items-center gap-3 rounded-row border border-border bg-surface px-4 py-4 transition-colors hover:border-primary"
    >
      <Image
        src="/icons/icon-survey.webp"
        alt=""
        width={40}
        height={40}
        className="size-10 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">Бөглөх судалгаа</span>
        <span className="block truncate text-body text-muted">{pending.title}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden />
    </Link>
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
      <div className="relative flex flex-col gap-6 py-2 lg:gap-8">{children}</div>
    </div>
  );
}
