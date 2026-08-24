"use client";

import { useQuery } from "@tanstack/react-query";
import { Megaphone, NotebookPen, Plus, UserPlus } from "lucide-react";
import { teacherDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import { GroupsSection } from "@/components/dashboard/groups-section";
import { NeedsAttentionAlerts } from "@/components/dashboard/needs-attention-alerts";
import { ObservationMix } from "@/components/dashboard/observation-mix";
import { RecentObservations } from "@/components/dashboard/recent-observations";
import { TermProgress } from "@/components/dashboard/term-progress";

/**
 * "What needs my attention today."
 *
 * ★ Not statistics. A teacher opening this at 8am needs to know what to *do*,
 * not how many observations were filed last month. Four compact counts for
 * context, then sections that are each an action.
 *
 * ★★ This file assembles; it does not render.
 *
 * Everything below the query lives in `components/dashboard/`. The split is not
 * cosmetic — each of those pieces has its own empty case, its own tint rules and
 * its own reason to exist, and when they shared a file the reasons were 400
 * lines apart from the markup they governed. What stays here is the one thing
 * that genuinely belongs to the page: fetching `GET /dashboard/teacher` once and
 * deciding between loading, error and content.
 *
 * ★★★ What this screen deliberately does NOT show, and why.
 *
 * The requested design called for attendance (30/35), medication reminders, a
 * Smart Pick-Up feed, today's lunch menu with an allergy warning, parent
 * messages and a term radar chart. Every one of those is excluded from the MVP
 * by CLAUDE.md §7 — they are RFP Module 2 and Phase III/IV — and the client
 * confirmed on 2026-08-22 that the dashboard stays in scope. Each tile here is
 * backed by a real field of `GET /dashboard/teacher`; none of them is mock
 * data waiting for a backend, which is the state that makes a dashboard lie.
 *
 * Asked for again on 2026-08-23 — an urgent-alerts row (Smart Pick-Up,
 * medication), one-click Хооллосон/Унтсан/Тоглосон, today's lunch with an
 * allergy badge, and a radar chart — and held out again, deliberately, by the
 * same decision. What changed that day was the chrome, not the content: the
 * palette, the header's search and action menu, and the sidebar.
 *
 * ★★★★ Asked for a third time on 2026-08-24, and held again. Logged for Phase 2.
 *
 * The request: a radar chart of the five development domains with the child's
 * scores against the class average, attendance KPIs (30/35, 86%, a monthly
 * mean), per-type completion bars for Ажиглалт / Ярилцлага / Бүтээл, and a task
 * board. The client reviewed the scope and confirmed the hold the same day.
 *
 * Worth writing down, because the three requests are not equally hard to say no
 * to and the next person should not have to re-derive that:
 *
 *  - **The radar is a scope decision, not a data problem.** `DevelopmentDomain`,
 *    `AssessmentLevel` (1..4) and `Assessment` all exist and carry exactly the
 *    axes asked for. What is missing is a class-average aggregate endpoint and a
 *    charting dependency. CLAUDE.md §7 excludes "radar charts" and "analytics",
 *    so it is Phase 2 — but it is buildable on real data the day that changes.
 *
 *  - **Attendance is a data problem.** There is no model, no migration and no
 *    endpoint anywhere in the API; it is RFP Module 2. Any KPI on this screen
 *    could only render an invented number, and a teacher reading a fabricated
 *    86% is worse than a dashboard that never mentions attendance.
 *
 *  - **Per-type completion may be closer than it looks.** `ObservationType` is a
 *    real configuration table, so Ажиглалт / Ярилцлага / Бүтээл are real values
 *    rather than an invented taxonomy. It needs an aggregate endpoint, not a
 *    schema change.
 *
 * The birthdays and the term-progress bar this screen already renders are the
 * parts of that design that had data behind them, and they shipped.
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

  /*
   * ★ All three branches render the same `PageHeader`.
   *
   * They used to hand-roll `<h1 className="text-xl font-semibold">`, which is a
   * different size *and* a different weight from the one `PageHeader` renders —
   * so the title grew 4px and changed weight in place the moment the query
   * resolved. Three copies of one string, and the copy nobody looks at was the
   * one on screen while the screen was loading.
   *
   * The search and the action menu render in every branch: both are static
   * links, neither depends on the response, and holding their space is what
   * keeps the header from reflowing under the user's cursor. The lede is the
   * one part that genuinely differs, so it is the one part passed in — and it
   * is never empty, because a line that appears late moves everything below it.
   */
  const header = (lede: string) => (
    <PageHeader title="Хяналтын самбар" lede={lede} search actions={<CreateMenu />} />
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 lg:gap-8">
        {header("Ачаалж байна…")}
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6 lg:gap-8">
        {header("Мэдээлэл ачаалж чадсангүй")}
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
  const {
    counts,
    needsAttention,
    recentObservations,
    currentTerm,
    birthdaysToday,
    termProgress,
    observationsByType,
  } = dashboard;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {header(
        currentTerm ? `${currentTerm.name} · идэвхтэй улирал` : "Идэвхтэй улирал тохируулаагүй",
      )}

      <DashboardStats counts={counts} />

      {/*
        ★ What needs doing stays full width, above the grid.

        The wireframe lays this screen out as a grid of equal cards, and most of
        it can be — but not this. `NeedsAttentionAlerts` renders only when it
        has something to say, so its *presence* is the signal; put it in a
        column beside a progress bar and it becomes one card among several,
        which is the exact "wall of equally-weighted cards" this dashboard's
        own note argues against. It is the first thing a teacher reads at 8am.
      */}
      <NeedsAttentionAlerts birthdaysToday={birthdaysToday} needsAttention={needsAttention} />

      {/*
        ★★ Two columns from `lg`, one below it.

        These four sections are reference rather than instruction — how far the
        term has got, what the observations are made of, which groups exist,
        what was written lately. Side by side they fit a laptop without
        scrolling; stacked on a phone they keep the reading order the markup
        already has, because `grid` reflows without reordering.

        Not `columns-2`: CSS multi-column would break a single section across
        the fold, and a progress bar split down the middle is unreadable.
      */}
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        {currentTerm ? <TermProgress term={currentTerm.name} progress={termProgress} /> : null}

        <ObservationMix observationsByType={observationsByType} term={currentTerm?.name ?? null} />

        <GroupsSection />

        {/*
          The feed is the longest section and the least urgent, so it takes the
          full width at the foot rather than stretching one column to twice the
          height of its neighbour.
        */}
        <div className="lg:col-span-2">
          <RecentObservations observations={recentObservations} />
        </div>
      </div>
    </div>
  );
}

/**
 * "+ Үйлдэл" — one primary control, three real destinations.
 *
 * The requested menu was Add Photo / Text / Voice. Voice is voice-to-text, which
 * CLAUDE.md §7 puts outside the MVP, and a photo is not a standalone action in
 * this product: pictures attach to an observation, on the screen where you write
 * it, because a photo with no note attached to it is not a portfolio entry. So
 * the menu lists what a teacher can actually start, and each entry opens a
 * screen that exists — the rule the sidebar is held to as well.
 *
 * Every one of them still passes through choosing a child or a group first; that
 * is inherent, not a missing shortcut.
 */
function CreateMenu() {
  return (
    <Menu
      ariaLabel="Шинээр үүсгэх"
      label={
        <>
          <Plus size={18} aria-hidden="true" />
          Үйлдэл
        </>
      }
      items={[
        {
          href: "/children",
          label: "Ажиглалт бичих",
          hint: "Хүүхэд сонгоод бичнэ. Зургийг мөн тэндээс хавсаргана.",
          icon: <NotebookPen size={18} aria-hidden="true" />,
        },
        {
          href: "/notifications/new",
          label: "Зарлал нийтлэх",
          hint: "Бүлгийн эцэг эхэд мэдэгдэл илгээх.",
          icon: <Megaphone size={18} aria-hidden="true" />,
        },
        {
          href: "/children/new",
          label: "Хүүхэд бүртгэх",
          hint: "Шинэ хүүхдийг бүлэгт нэмэх.",
          icon: <UserPlus size={18} aria-hidden="true" />,
        },
      ]}
    />
  );
}
