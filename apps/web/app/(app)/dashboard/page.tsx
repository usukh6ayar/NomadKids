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
import { TeacherHero } from "@/components/dashboard/teacher-hero";
import { AttendanceToday } from "@/components/dashboard/attendance-today";
import { TodayMenu } from "@/components/dashboard/today-menu";
import { SurveySummary } from "@/components/dashboard/survey-summary";
import { GroupsSection } from "@/components/dashboard/groups-section";
import { NeedsAttentionAlerts } from "@/components/dashboard/needs-attention-alerts";
import { ClassBoardNotice } from "@/components/dashboard/class-board-notice";
import { GenderRatio } from "@/components/dashboard/gender-ratio";
import { MonthBirthdays } from "@/components/dashboard/month-birthdays";
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
 * ★★★ The 2026-08-26 sketch, and what changed to let it be built.
 *
 * The client asked three times — 2026-08-22, 08-23, 08-24 — for attendance
 * (30/35), today's lunch with an allergy badge, a survey panel and a radar
 * chart. Each time it was held, and the stated reason for attendance was
 * specific: "there is no model, no migration and no endpoint anywhere in the
 * API; any KPI on this screen could only render an invented number."
 *
 * That reason expired on 2026-08-25. CLAUDE.md §7 was rewritten to pull RFP
 * Module 2 and Phase II–III into scope, and `Attendance`, `MenuDay`,
 * `MealRecord`, `AllergyRecord` and `Survey` all shipped with endpoints behind
 * them. The hold is not being overridden — its premise is gone, and leaving
 * the old argument here would be the "rule the codebase contradicts" that §7
 * itself warns teaches people to stop reading.
 *
 * So the sketch is now buildable on real data, and every tile below reads a
 * real response:
 *
 *   Өнөөдрийн ирц 30/35   GET /groups/:id/attendance?date=  (AttendanceToday)
 *   Хоолны цэс + харшил   GET /kindergartens/:id/menu/with-warnings
 *   Судалгаа              GET /kindergartens/:id/surveys → /surveys/:id/results
 *   Хүйсийн харьцаа       GET /children/summary
 *   Явцын үнэлгээ         observationsByType, from this endpoint
 *   Төрсөн өдөр           birthdaysThisMonth
 *   Ангийн самбар         boardNotice, readCount included
 *
 * ★★★★ What is STILL held, and why — so the next person does not re-derive it:
 *
 *  - **Чат.** The sketch draws a chat bubble bottom-right. Phase IV, no model,
 *    no endpoint. `app/(app)/layout.tsx` already carries a deliberate faint
 *    "Чат" nav entry with no href, which is the honest representation of a
 *    feature that does not exist. No affordance is added here.
 *
 *  - **The radar against a class average.** `DevelopmentDomain`,
 *    `AssessmentLevel` and `Assessment` carry the axes, and
 *    `components/assessment/development-radar.tsx` can draw one — but the
 *    *class average* it is meant to be compared against has no aggregate
 *    endpoint. `GET /children/:id/assessment-radar` is per child. Drawing the
 *    comparison would mean computing an average on the client from a roster
 *    the dashboard does not fetch, which is the invented-number failure this
 *    file was already avoiding. `TermProgress` reports the real, related fact:
 *    how many of the roster have been assessed.
 *
 * ★★★★★ One teacher, one group. `useMyGroup()` resolves it once and the whole
 * screen speaks about it — no switcher, no group picker, no "which class?"
 * step, because the product does not offer a second one.
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
    birthdaysThisMonth,
    boardNotice,
    termProgress,
    observationsByType,
  } = dashboard;

  /*
   * ★ Bands are spaced further apart than the cards inside them.
   *
   * Everything used to sit on one `gap-3 md:gap-4 lg:gap-5` rhythm, so the
   * distance between two tiles in a row and the distance between the tile row
   * and the menu section were identical — which is what made the screen read
   * as a bag of cards rather than as a structure. One step up (`gap-5 lg:gap-7`)
   * between bands and the grouping becomes visible without a single divider.
   */
  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      {header(
        currentTerm ? `${currentTerm.name} · идэвхтэй улирал` : "Идэвхтэй улирал тохируулаагүй",
      )}

      {/*
        ★ Who and which group, before anything is reported about them.

        The sketch opens with an avatar, "Багш" and the group name, and that
        ordering is right for a reason beyond the drawing: every figure below
        is scoped to one group, so naming it first is what makes "30/35" mean
        something. It fetches its own profile and group.
      */}
      <TeacherHero />

      {/*
        ★★ The alert next, and compact.

        `NeedsAttentionAlerts` renders only when it has something to say, so its
        presence is the signal — that argument still holds and it stays out of
        the grid. What was wrong was its weight: a full section heading over
        cards with a size-10 icon, occupying a third of the screen to report
        three birthdays. It reads as an inline notification now.
      */}
      <NeedsAttentionAlerts birthdaysToday={birthdaysToday} needsAttention={needsAttention} />

      {/*
        ★★★ B — today. One large card and two small ones, not four equal tiles.

        This band was `repeat(auto-fit, minmax(250px, 1fr))` holding the
        register, the sex split, the observation mix and the month's birthdays
        — four cards of one size, which is exactly the wall of identical cards
        this pass was asked to break. Two of the four were not even about
        today: an observation mix is a term's shape and a birthday list is a
        month's plan. Both moved to bands that are about those spans of time.

        What is left is what a teacher needs at 8am, and it is weighted rather
        than evenly divided. The register takes seven columns, a 96px dial, an
        illustrated identity and the `sky` wash; the roster's three counts and
        the sex split share the other five, stacked. `items-start`, so the
        short column ends where its content does instead of stretching to
        match the tall one.

        ★★★★ A stacked right-hand column rather than two more sibling cells,
        and that keeps the robustness the old `auto-fit` was buying.
        `GenderRatio` renders nothing when no child has a recorded sex. As a
        third grid cell its absence would leave a quarter of the most prominent
        row on the screen empty — the measured failure that put `auto-fit`
        there in the first place. Inside a column it only makes that column
        shorter.
      */}
      <div className="grid grid-cols-1 items-start gap-3 md:gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="lg:col-span-7">
          <AttendanceToday />
        </div>

        {/*
          The roster in three numbers and the sex split, stacked. Both read
          `/children/summary` under one query key, so the pair costs one
          request — which is the reason they belong in one column rather than
          on opposite sides of the screen.
        */}
        <div className="flex flex-col gap-3 md:gap-4 lg:col-span-5 lg:gap-5">
          <DashboardStats counts={counts} />
          <GenderRatio />
        </div>
      </div>

      {/*
        ★★ The menu takes the full width, on its own.

        The sketch stacks it beside the class board, and that is where it went
        first — but a 5-of-12 column is about 380px on a laptop, and three dish
        cards do not fit across it. They wrapped to a single column, which is
        the one shape the drawing is explicit about *not* being: three cards in
        a row. Full width restores that and makes the section read as primary,
        which is what it is — an allergy warning is the highest-stakes thing on
        this screen.
      */}
      <TodayMenu />

      {/*
        ★ D — what has been written this term, and how much has been assessed.

        The two analytical cards, which used to sit three bands apart: the mix
        was a quarter-tile in the row at the top and the progress a full-width
        rule near the foot. They answer the same kind of question — "how is the
        term going" — and neither is a task, so they read as a pair rather than
        as two interruptions of the daily flow.

        ★★ `auto-fit`, because both are conditional. `ObservationMix` renders
        nothing before the first observation, `TermProgress` nothing without an
        active term. An `auto-fit` track collapses when it is empty, so
        whichever survives takes the whole width instead of half of it with a
        hole beside it — the failure a fixed `lg:col-span-6` pair produced when
        this screen last used one. `items-stretch` plus the `h-full` both
        sections carry keeps them level when both are present.
      */}
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[repeat(auto-fit,minmax(320px,1fr))] md:gap-4 lg:gap-5">
        <ObservationMix observationsByType={observationsByType} term={currentTerm?.name ?? null} />
        {currentTerm ? <TermProgress term={currentTerm.name} progress={termProgress} /> : null}
      </div>

      {/*
        ★ E — communication, and the month ahead.

        `Ангийн самбар` is the only widget carrying a body of text rather than
        a number, and it takes the larger panel for that reason — a paragraph
        in a narrow column wraps to a column of two-word lines. The survey and
        the birthdays share the other span.

        `items-start` matters: without it the grid stretches both columns to
        the taller, and the white space moves inside the shorter card instead
        of below it.

        The board renders a compact empty state now rather than vanishing (see
        `class-board-notice.tsx`), which is what lets this stay a fixed 7/5
        split instead of becoming a third `auto-fit` row.
      */}
      <div className="grid grid-cols-1 items-start gap-3 md:gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="lg:col-span-7">
          <ClassBoardNotice notice={boardNotice} />
        </div>

        {/*
          The survey and the month's birthdays share the narrower column: one
          is what families have told this teacher, the other is what the
          teacher should be planning for. Both are secondary to the board, and
          stacking them under one span says so without shrinking either.

          `MonthBirthdays` still renders nothing in a month with none. Inside a
          column that only makes the column shorter — as a third grid cell it
          would have left a fifth of the band empty.
        */}
        <div className="flex flex-col gap-3 md:gap-4 lg:col-span-5 lg:gap-5">
          <SurveySummary />
          <MonthBirthdays birthdays={birthdaysThisMonth} />
        </div>
      </div>

      {/*
        ★★★★ The foot: the term's progress, the group's shortcuts, and the feed.

        `GroupsSection` renders a single action card, a list, or nothing at all
        depending on how many groups the teacher has, so it takes a span rather
        than assuming a height. `TermProgress` is the honest neighbour of the
        radar the sketch asked for — how much of the roster has been assessed.
      */}
      <RecentObservations observations={recentObservations} />

      <GroupsSection />
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
