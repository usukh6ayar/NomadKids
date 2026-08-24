"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Bell, BookOpen, Plus, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { parentDashboardSchema, unreadCountSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { excerpt, formatAge, formatRelative, fullName } from "@/lib/format";
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
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.parent(),
    queryFn: () => get("/dashboard/parent", parentDashboardSchema),
  });

  // Powers the "Ангийн самбар" preview card below — the same count the
  // sidebar's unread dot shows, reused here as a share reason to open
  // /notifications rather than a bare number.
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

  if (isLoading) {
    return (
      <HomeBackdrop>
        <PageHeader title="Нүүр хуудас" />
        <LoadingState rows={3} />
      </HomeBackdrop>
    );
  }

  if (isError) {
    return (
      <HomeBackdrop>
        <PageHeader title="Нүүр хуудас" />
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
        <PageHeader title="Нүүр хуудас" />
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
      <PageHeader title="Нүүр хуудас" />

      {children.length > 1 ? (
        <div
          role="tablist"
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
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedId(child.id)}
                className={cn(
                  "flex min-h-[44px] shrink-0 items-center gap-2 rounded-[999px] border px-3 py-2 text-sm font-medium",
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

      <Card className="flex flex-col gap-3 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-4">
          <ChildAvatar child={selected} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-ink">{fullName(selected)}</p>
            <p className="text-sm text-muted">
              {[formatAge(selected.dateOfBirth), selected.group?.name].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/children/${selected.id}/observations/new`}>
              <Plus size={18} />
              Хуваалцах
            </Link>
          </Button>
        </div>

        <Link
          href={`/children/${selected.id}`}
          className="text-sm font-semibold text-primary hover:opacity-80"
        >
          Хүүхдийн дэлгэрэнгүй хуудас →
        </Link>
      </Card>

      <section aria-labelledby="board-heading">
        <SectionHeader
          title="Ангийн самбар"
          action={
            <Link href="/notifications" className="text-sm font-semibold text-primary hover:opacity-80">
              Бүгдийг харах →
            </Link>
          }
        />
        <Link
          href="/notifications"
          className="flex min-h-16 items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-card transition-colors hover:bg-canvas"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sky text-sky-ink">
            <Bell size={20} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-ink">
              {unread && unread.count > 0
                ? `${unread.count} шинэ мэдээ байна`
                : "Шинэ мэдээ алга"}
            </span>
            <span className="block text-sm text-muted">Ангийн сүүлийн мэдээллийг харах</span>
          </span>
        </Link>
      </section>

      <section aria-labelledby="highlights-heading">
        <SectionHeader title="Оюун-ийн мэдээлэл" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href={`/children/${selected.id}/portfolio`}
            className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-4 shadow-card transition-colors hover:bg-canvas"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
              <BookOpen size={20} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink">Хавтас</span>
              <span className="block text-sm text-muted">Зураг, бүтээл, тэмдэглэл</span>
            </span>
          </Link>

          <Link
            href={`/children/${selected.id}/observations`}
            className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-4 shadow-card transition-colors hover:bg-canvas"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-mint text-mint-ink">
              <TrendingUp size={20} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink">Хөгжил ба цэцэрлэгтээ</span>
              <span className="block text-sm text-muted">Ажиглалт, хөгжлийн ахиц</span>
            </span>
          </Link>
        </div>
      </section>

      {selected.assessments.length > 0 ? (
        <section aria-labelledby="development-heading">
          <SectionHeader
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
        <SectionHeader title="Сүүлийн мөчүүд" />

        {recent.length === 0 ? (
          <EmptyState
            title="Одоогоор шинэ мэдээлэл алга"
            description="Багш ажиглалт хуваалцахад энд харагдана."
          />
        ) : (
          <Card className="divide-y divide-border">
            {recent.map((item) => (
              <Link
                key={item.id}
                href={item.child ? `/children/${item.child.id}` : "/children"}
                className="flex min-h-[64px] items-start gap-3 px-4 py-3 hover:bg-canvas"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{item.type?.name ?? "Ажиглалт"}</span>
                    {/* A family's own submission, so they can tell it apart. */}
                    {item.source === "PARENT" ? <Badge tone="sky">Таны хуваалцсан</Badge> : null}
                    {item.reviewStatus === "PENDING" ? (
                      <Badge tone="sun">Хүлээгдэж буй</Badge>
                    ) : null}
                    {item.reviewStatus === "RETURNED" ? (
                      <Badge tone="peach">Буцаагдсан</Badge>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {excerpt(item.situation, 100) || "Тайлбаргүй"}
                  </span>
                  {children.length > 1 && item.child ? (
                    <span className="mt-0.5 block text-xs text-muted">{fullName(item.child)}</span>
                  ) : null}
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted">
                  {formatRelative(item.observedOn)}
                </span>
              </Link>
            ))}
          </Card>
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
 * or several recent moments, the cutoff landed inside a section (behind
 * "Ангийн самбар"'s heading, un-faded) instead of between two of them, which
 * read as a layout bug rather than a banner edge. Sizing to the sibling
 * instead means the backdrop always ends exactly where the page does,
 * however long that is.
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
      <div className="relative flex flex-col gap-6">{children}</div>
    </div>
  );
}
