"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Cake, ClipboardList, NotebookPen, Users } from "lucide-react";
import { groupSchema, paginated, teacherDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { excerpt, formatRelative, fullName } from "@/lib/format";

const groupsSchema = paginated(groupSchema);

/**
 * "What needs my attention today."
 *
 * ★ Not statistics. A teacher opening this at 8am needs to know what to *do*,
 * not how many observations were filed last month. Four compact counts for
 * context, then sections that are each an action.
 *
 * ★★ What this screen deliberately does NOT show, and why.
 *
 * The requested design called for attendance (30/35), medication reminders, a
 * Smart Pick-Up feed, today's lunch menu with an allergy warning, parent
 * messages and a term radar chart. Every one of those is excluded from the MVP
 * by CLAUDE.md §7 — they are RFP Module 2 and Phase III/IV — and the client
 * confirmed on 2026-08-22 that the dashboard stays in scope. Each tile here is
 * backed by a real field of `GET /dashboard/teacher`; none of them is mock
 * data waiting for a backend, which is the state that makes a dashboard lie.
 *
 * The assessment list reports **the gap, not the coverage**: children already
 * assessed need nothing, so they are not on it.
 */
export default function DashboardPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <TeacherDashboard />
    </RequireRole>
  );
}

function TeacherDashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.teacher(),
    queryFn: () => get("/dashboard/teacher", teacherDashboardSchema),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 lg:gap-7">
        <h1 className="text-xl font-semibold text-ink">Хяналтын самбар</h1>
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-2">
        <h1 className="mb-4 text-xl font-semibold text-ink">Хяналтын самбар</h1>
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

  const dashboard = data!;
  const { counts, needsAttention, recentObservations, currentTerm, birthdaysToday, termProgress } =
    dashboard;
  const missing = needsAttention.childrenMissingAssessment;

  // A genuinely quiet day gets said plainly, rather than shown as three empty
  // boxes that read like a loading failure.
  const allClear =
    counts.pendingReviews === 0 &&
    missing.length === 0 &&
    birthdaysToday.length === 0 &&
    recentObservations.length === 0;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Хяналтын самбар"
        lede={
          currentTerm ? `${currentTerm.name} · идэвхтэй улирал` : "Идэвхтэй улирал тохируулаагүй"
        }
        actions={
          <Button asChild size="sm">
            {/* A teacher writes an observation about a child, so the action has
                to pass through choosing one. A "+" in the global header would
                land on the same list one screen later. */}
            <Link href="/children">Ажиглалт бичих</Link>
          </Button>
        }
      />

      <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Хүүхэд" value={counts.children} />
        <Stat
          label="Төрсөн өдөр"
          value={birthdaysToday.length}
          tone={birthdaysToday.length > 0 ? "mint" : "neutral"}
        />
        <Stat
          label="Хянах"
          value={counts.pendingReviews}
          tone={counts.pendingReviews > 0 ? "sun" : "neutral"}
        />
        <Stat
          label="Үнэлгээ дутуу"
          value={missing.length}
          tone={missing.length > 0 ? "peach" : "neutral"}
        />
      </section>

      {allClear ? (
        <EmptyState
          title="Өнөөдөр хүлээгдэж буй ажил алга"
          description="Хянах ажиглалт байхгүй, үнэлгээ бүрэн байна. Шинэ ажиглалт бичихийн тулд хүүхэд сонгоно уу."
          action={
            <Button asChild>
              <Link href="/children">Хүүхдүүд</Link>
            </Button>
          }
        />
      ) : null}

      {birthdaysToday.length > 0 ? (
        <section aria-labelledby="birthdays-heading">
          <SectionHeader title="Өнөөдөр төрсөн өдөртэй" />
          <Card className="flex flex-wrap items-center gap-3 px-4 py-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-mint text-mint-ink">
              <Cake size={20} aria-hidden="true" />
            </span>
            <ul className="flex min-w-0 flex-wrap items-center gap-2">
              {birthdaysToday.map((child) => (
                <li key={child.id}>
                  <Link
                    href={`/children/${child.id}`}
                    className="flex min-h-[44px] items-center gap-2 rounded-[12px] border border-border px-3 py-1.5 hover:bg-canvas"
                  >
                    <ChildAvatar child={child} size={28} />
                    <span className="truncate font-medium text-ink">{fullName(child)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      {counts.pendingReviews > 0 ? (
        <section aria-labelledby="reviews-heading">
          <SectionHeader
            title="Эцэг эхийн ажиглалт хянах"
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/observations/review">Бүгдийг харах</Link>
              </Button>
            }
          />
          <Card className="flex items-center justify-between gap-4 px-4 py-4">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-[12px] bg-sun text-sun-ink">
                <ClipboardList size={20} aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium text-ink">
                  {counts.pendingReviews} ажиглалт хүлээгдэж байна
                </p>
                <p className="text-sm text-muted">Эцэг эхийн илгээсэн бичлэгүүд.</p>
              </div>
            </div>
            <Button asChild size="sm">
              <Link href="/observations/review">Хянах</Link>
            </Button>
          </Card>
        </section>
      ) : null}

      {currentTerm ? <TermProgress term={currentTerm.name} progress={termProgress} /> : null}

      {missing.length > 0 ? (
        <section aria-labelledby="assessment-gap-heading">
          <SectionHeader
            title="Энэ улиралд үнэлгээ хийгдээгүй"
            lede="Улирал хаагдахаас өмнө үнэлгээ шаардлагатай хүүхдүүд."
          />
          <Card className="divide-y divide-border">
            {missing.slice(0, 6).map((child) => (
              <Link
                key={child.id}
                href={`/children/${child.id}`}
                className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-canvas"
              >
                <ChildAvatar child={child} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{fullName(child)}</span>
                  {child.group ? (
                    <span className="block truncate text-sm text-muted">{child.group.name}</span>
                  ) : null}
                </span>
                <Badge tone="peach">Дутуу</Badge>
              </Link>
            ))}
            {missing.length > 6 ? (
              <p className="px-4 py-3 text-sm text-muted">Бусад {missing.length - 6} хүүхэд…</p>
            ) : null}
          </Card>
        </section>
      ) : null}

      <GroupsSection />

      {recentObservations.length > 0 ? (
        <section aria-labelledby="recent-heading">
          <SectionHeader
            title="Сүүлийн ажиглалт"
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/children">Хүүхдүүд</Link>
              </Button>
            }
          />
          <Card className="divide-y divide-border">
            {recentObservations.map((obs) => (
              <Link
                key={obs.id}
                href={obs.child ? `/children/${obs.child.id}` : "/children"}
                className="flex min-h-[64px] items-start gap-3 px-4 py-3 hover:bg-canvas"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-sky text-sky-ink">
                  {obs.source === "PARENT" ? (
                    <Users size={18} aria-hidden="true" />
                  ) : (
                    <NotebookPen size={18} aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{fullName(obs.child)}</span>
                  <span className="block text-sm text-muted">
                    {obs.type?.name ? `${obs.type.name} · ` : ""}
                    {excerpt(obs.situation, 70) || "Тайлбаргүй"}
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted">
                  {formatRelative(obs.observedOn)}
                </span>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

/**
 * This term's assessment progress — RFP §12.1 "улирлын үнэлгээний явц".
 *
 * ★ A bar, not a chart.
 *
 * The requested design put a radar chart here. Charts are excluded from the
 * MVP (CLAUDE.md §7) and a radar of one term's averages would need a charting
 * dependency to say something a sentence says better. This is one number, its
 * denominator, and a rule showing the ratio — readable at a glance and
 * announced properly to a screen reader, which a canvas chart is not.
 */
function TermProgress({
  term,
  progress,
}: {
  term: string;
  progress: { assessed: number; total: number };
}) {
  const { assessed, total } = progress;
  // Guard the divide: a group with no children is a real state on the first
  // day of a school year, and NaN% renders as "NaN%".
  const percent = total > 0 ? Math.round((assessed / total) * 100) : 0;

  return (
    <section aria-labelledby="term-progress-heading">
      <SectionHeader title="Улирлын үнэлгээний явц" lede={term} />
      <Card className="px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-muted">
            <span className="text-lg font-semibold tabular-nums text-ink">{assessed}</span>
            {" / "}
            <span className="tabular-nums">{total}</span> хүүхэд үнэлэгдсэн
          </p>
          <p className="text-sm font-medium tabular-nums text-primary-strong">{percent}%</p>
        </div>

        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-pill bg-canvas"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${term} үнэлгээний явц`}
        >
          {/* `primary-bright` (sky-500) rather than `primary`: this is the one
              place the brief's soft sky blue is the whole point, and nothing
              has to stay legible on top of it. */}
          <div
            className="h-full rounded-pill bg-primary-bright transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </Card>
    </section>
  );
}

/**
 * The way into assessment.
 *
 * ★ Assessment has no top-level menu item, because it cannot start without a
 * group — a menu entry would open a screen whose first act is to ask "which
 * group?". So the groups a teacher actually teaches are listed here, and each
 * one is a direct link into its assessment column.
 *
 * Without this the `/groups/[groupId]/assessment` route would be unreachable
 * through the UI, which is its own kind of dead route.
 */
function GroupsSection() {
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.groups({ pageSize: 20 }),
    queryFn: () => get("/groups?page=1&pageSize=20", groupsSchema),
  });

  // A failure here is not worth an error block on the dashboard: the section is
  // a shortcut, and the same screens are reachable from Хүүхдүүд.
  if (isLoading || isError || !data || data.items.length === 0) return null;

  return (
    <section aria-labelledby="groups-heading">
      <SectionHeader title="Бүлгүүд" lede="Хариуцсан бүлгүүд, улирлын үнэлгээ рүү шууд." />
      <Card className="divide-y divide-border">
        {data.items.map((group) => (
          <Link
            key={group.id}
            href={`/groups/${group.id}/assessment`}
            className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-canvas"
          >
            <span className="min-w-0 truncate font-medium text-ink">{group.name}</span>
            <span className="shrink-0 text-sm text-primary-strong">Үнэлгээ →</span>
          </Link>
        ))}
      </Card>
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "sun" | "peach" | "mint";
}) {
  const toneClass =
    tone === "sun"
      ? "bg-sun text-sun-ink"
      : tone === "peach"
        ? "bg-peach text-peach-ink"
        : tone === "mint"
          ? "bg-mint text-mint-ink"
          : "";

  return (
    <Card className="px-4 py-3.5">
      <p className="text-sm text-muted">{label}</p>
      <p
        className={`mt-1 inline-flex min-w-[2ch] justify-center rounded-[10px] px-1.5 text-2xl font-semibold tabular-nums ${
          toneClass || "text-ink"
        }`}
      >
        {value}
      </p>
    </Card>
  );
}
