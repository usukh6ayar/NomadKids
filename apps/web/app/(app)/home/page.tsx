"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { useState } from "react";
import { parentDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { useSession } from "@/lib/auth/session";
import { excerpt, formatAge, formatRelative, fullName } from "@/lib/format";
import { PORTFOLIO } from "@/lib/vocabulary";
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
      <div className="flex flex-col gap-6 py-2 lg:gap-8">
        {header}
        <LoadingState rows={3} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6 py-2 lg:gap-8">
        {header}
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </div>
    );
  }

  const { children, recent, currentTerm } = data!;

  if (children.length === 0) {
    return (
      <div className="flex flex-col gap-6 py-2 lg:gap-8">
        {header}
        <EmptyState
          title="Хүүхэд холбогдоогүй байна"
          description="Танд холбогдсон хүүхэд байхгүй байна. Цэцэрлэгийн багштайгаа холбогдоно уу."
        />
      </div>
    );
  }

  const selected = children.find((c) => c.id === selectedId) ?? children[0]!;

  return (
    <div className="flex flex-col gap-6 py-2 lg:gap-8">
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
                  <span className="mt-0.5 block text-body text-muted">
                    {excerpt(item.situation, 100) || "Тайлбаргүй"}
                  </span>
                  {children.length > 1 && item.child ? (
                    <span className="mt-0.5 block text-caption text-muted">
                      {fullName(item.child)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 whitespace-nowrap text-caption text-muted">
                  {formatRelative(item.observedOn)}
                </span>
              </Link>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
