"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { teacherDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { formatDate, fullName } from "@/lib/format";
import { useSession } from "@/lib/auth/session";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState, Skeleton } from "@/components/ui/states";
import { Art, type ArtName } from "@/components/ui/art";
import { AttendanceToday } from "@/components/dashboard/attendance-today";
import { TodayMenu } from "@/components/dashboard/today-menu";
import { ClassBoardNotice } from "@/components/dashboard/class-board-notice";
import { MonthBirthdays } from "@/components/dashboard/month-birthdays";
import { WeeklyAttendance } from "@/components/dashboard/weekly-attendance";
import { AssessmentProgress } from "@/components/dashboard/assessment-progress";
import { DashboardChatPreview } from "@/components/dashboard/dashboard-chat-preview";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { ArrowRight, CalendarDays, UsersRound } from "lucide-react";

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
 *   Долоо хоногийн ирц    the same endpoint, five weekdays (WeeklyAttendance)
 *   Хоолны цэс + харшил   GET /kindergartens/:id/menu/with-warnings
 *   Судалгаа              GET /kindergartens/:id/surveys → /surveys/:id/results
 *   Бүлгийн хүүхдүүд      GET /children/summary
 *   Явцын үнэлгээ         observationsByType, from this endpoint
 *   Төрсөн өдөр           birthdaysThisMonth
 *   Сүүлийн нийтлэл       boardNotice + GET /notifications/:id for the photo
 *
 * ★★★★ The 2026-08-28 desktop pass restructured the first three bands to the
 * client's second sketch, and two of its labels are deliberate divergences:
 *
 *  - The sketch titles the week chart **"Сарын ирц"** (the month's attendance)
 *    while drawing five columns labelled Да–Ба, which is a week. The card is
 *    named for what it shows. A month would need
 *    `GET /groups/:id/attendance/summary?from=&to=`, which does not exist and
 *    which this pass was told not to add — twenty day-sheet requests from the
 *    client would be CLAUDE.md §3.4's N+1 moved somewhere the rule cannot see.
 *
 *  - The sketch's second card reads "Охид 17 / Хөвгүүд 18" as two plain
 *    figures. `GenderRatio` keeps its donut, which carries the same two counts
 *    plus the roster's size and their shares. Replacing a working chart with
 *    two numerals would be a regression dressed as fidelity.
 *
 * ★★★★ What is STILL held, and why — so the next person does not re-derive it:
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
    <RequireRole roles={["TEACHER"]}>
      <TeacherDashboard />
    </RequireRole>
  );
}

/*
 * ★ TEACHER only, and an administrator is redirected rather than branched
 *   — 2026-09-04.
 *
 * This route used to accept ADMIN too and choose between two screens inside a
 * `Home()` wrapper: the class board for a teacher, `AdminOverview` for an
 * administrator. The reason was sound — every figure below is scoped by
 * `loadActiveTeachingGroupIds`, which reads TEACHER memberships, so an
 * administrator holding none was shown a board reporting "Хүүхэд 0 · Бүлэг 0"
 * beside a gender ring that had correctly counted ten children.
 *
 * What made the branch wrong was not its reasoning but its reach. Signing in
 * as an ADMIN goes to `/admin` — `primaryDashboard()` checks that role first —
 * so the administrator half of this file was code nobody arrived at, while
 * `/admin` drew a poorer version of the same endpoint. `AdminOverview` now
 * lives at `/admin` and this route is the one screen its name says it is.
 *
 * The guard replaces the branch and lands in the same place: an administrator
 * who does not teach is sent to `/` by `RequireRole`, and `app/page.tsx`
 * forwards by role to `/admin`. One redirect instead of a second landing page,
 * and no URL that means two different things.
 *
 * ★★ An administrator who *also* teaches still gets this board when they open
 * it — `hasRole("TEACHER")` passes — which is what the old branch wanted for
 * them. It is no longer where signing in puts them; see `admin-overview.tsx`,
 * where that ordering is recorded as an open question rather than settled here.
 */
function TeacherDashboard() {
  const { session } = useSession();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.teacher(),
    queryFn: () => get("/dashboard/teacher", teacherDashboardSchema),
  });

  // Shared with `TeacherHero`, `AttendanceToday` and `WeeklyAttendance` under
  // one query key. Still read here for the "Ирц" quick action's href below —
  // not for the header, which stopped naming the group when its `lede` line
  // was removed (2026-09-07, every page's header subtitle went at once).
  const { group } = useMyGroup();

  /*
   * ★ All three branches render the same `PageHeader`.
   *
   * They used to hand-roll `<h1 className="text-xl font-semibold">`, which is a
   * different size *and* a different weight from the one `PageHeader` renders —
   * so the title grew 4px and changed weight in place the moment the query
   * resolved. Three copies of one string, and the copy nobody looks at was the
   * one on screen while the screen was loading. Rendering the identical
   * `header` element in all three branches is what keeps them from drifting
   * apart again.
   *
   * ★★ The 2026-09-06 teacher mockup opens with a personal greeting rather
   * than the route name. The card below still names the class board's latest
   * post as "Сүүлийн нийтлэл", so the screen's title and the post widget do
   * not repeat one another.
   *
   * ★★★ Header search is back; "+ Үйлдэл" stays out.
   *
   * The new mockup puts search in the teacher shell's sticky desktop header,
   * where it submits to `/children?q=...`. The action menu's destinations are
   * the four illustrated quick tiles immediately under the greeting.
   */
  const teacherName = fullName(session?.user);
  const greetingName = teacherName === "—" ? "багш" : teacherName;
  const today = new Date();
  const weekday = new Intl.DateTimeFormat("mn-MN", { weekday: "long" }).format(today);
  const header = (
    <div className="teacher-dashboard-header">
      <PageHeader
        title={`Сайн байна уу, ${greetingName}!`}
        meta={
          <>
            {group ? (
              <span className="inline-flex min-h-7 items-center gap-1.5 rounded-pill bg-surface px-2.5 text-caption font-semibold text-ink shadow-sm">
                <UsersRound size={14} aria-hidden="true" className="text-primary" />
                {group.name}
              </span>
            ) : null}
            <span className="inline-flex min-h-7 items-center gap-1.5 rounded-pill bg-surface px-2.5 text-caption font-medium text-muted shadow-sm">
              <CalendarDays size={14} aria-hidden="true" className="text-mint-ink" />
              {formatDate(today)} · {weekday}
            </span>
          </>
        }
      />
      <div className="teacher-dashboard-banner">
        <Image
          src="/illustrations/teacher-reading-with-children.png"
          alt="Багш хоёр хүүхдэд ном уншиж байна"
          fill
          sizes="(min-width: 1280px) 420px, 100vw"
          className="object-cover"
        />
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="page-band">
        {header}
        {/*
          ★ Card-shaped, and paired at the top like the real thing.

          The skeleton used to be four identical 72px bars for a screen whose
          first band is two square tiles and whose rest is a stack of card
          bands — so the page visibly rearranged itself when the query landed.
          §4.1 asks loading and error to share the header so nothing shifts;
          the body has to hold up its half of that.
        */}
        {/* Six and three-across, matching the real tile band below. */}
        <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[112px] w-full rounded-card" />
          ))}
        </div>
        <LoadingState rows={3} shape="cards" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page-band">
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

  /*
   * The page combines this endpoint's term, birthday, notice and assessment
   * aggregates with focused widgets that fetch their own live registers.
   *
   * `counts`, `needsAttention`, `recentObservations`, `termProgress` and
   * `observationsByType` belong to the nine widgets this screen dropped on
   * 2026-08-28 (see the docblock above). They are deliberately **not** removed
   * from `teacherDashboardSchema` or from the endpoint: the components that
   * read them still exist and still have tests, and narrowing a response to
   * match one screen's current layout is the coupling `GroupsSection` and
   * `DashboardStats` each decline in their own comments.
   */
  const { birthdaysThisMonth, boardNotice, termProgress } = data!;

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
    // 20px between bands on a phone, 24px from `lg` — the brief's own section
    // rhythm, and a step above the 16/20px gap between cards inside a band so
    // the grouping is visible without a divider.
    <div className="page-band">
      {header}

      {/*
        ★ Six tiles, not four — 2026-09-10, at the client's request.

        `xl:grid-cols-3` rather than the previous `xl:grid-cols-4`: six tiles
        across four columns leaves a row of four above a row of two, and the
        two orphans read as an afterthought rather than as part of the set.
        Three columns give two even rows of three, and the phone's own
        `grid-cols-2` becomes three rows of two — even at both sizes.

        Both destinations already existed and are already in the sidebar
        (`staffSections`); what they lacked was a door on the screen a teacher
        actually starts from.
      */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3" data-testid="teacher-quick-actions">
        <QuickAction
          href={group ? `/groups/${group.id}/attendance` : "/attendance"}
          title="Ирц"
          description="Өнөөдрийн ирц бүртгэх"
          art="attendance"
        />
        <QuickAction
          href="/notifications/new"
          title="Мэдээ"
          description="Зураг, мэдээ нийтлэх"
          art="notice"
        />
        <QuickAction
          href="/surveys"
          title="Судалгаа"
          description="Шинэ судалгаа үүсгэх"
          art="survey"
        />
        <QuickAction
          href={group ? `/groups/${group.id}/assessment` : "/children"}
          title="Явцын үнэлгээ"
          description="Хүүхдийн үнэлгээ оруулах"
          art="progress"
        />
        <QuickAction
          href="/reports"
          title="Тайлан"
          description="Бүлгээ сараар харах"
          art="report"
        />
        <QuickAction
          href="/documents"
          title="Баримт бичгийн сан"
          description="Хөтөлбөр, арга зүй, журам"
          art="documents"
        />
      </div>

      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-[1.05fr_1.1fr_1fr_1.35fr]">
        <AttendanceToday />
        <WeeklyAttendance />
        <MonthBirthdays birthdays={birthdaysThisMonth} />
        <AssessmentProgress
          progress={termProgress}
          href={group ? `/groups/${group.id}/assessment` : "/children"}
        />
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-[1.05fr_1.3fr_1fr]">
        <TodayMenu />
        <ClassBoardNotice notice={boardNotice} />
        <DashboardChatPreview />
      </div>
    </div>
  );
}

function QuickAction({
  href,
  title,
  description,
  art,
}: {
  href: string;
  title: string;
  description: string;
  art: ArtName;
}) {
  return (
    <Link
      href={href}
      className="group relative flex min-h-[136px] flex-col items-start gap-2 rounded-card border border-border bg-surface/88 p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:min-h-[92px] sm:flex-row sm:items-center sm:gap-3 sm:p-3.5"
    >
      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center sm:size-14">
        <Art name={art} size={42} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lead font-semibold leading-heading text-ink">{title}</span>
        <span className="mt-0.5 block text-caption leading-snug text-muted">{description}</span>
      </span>
      <span className="absolute right-3 top-3 grid size-8 shrink-0 place-items-center rounded-pill bg-surface text-primary shadow-sm transition group-hover:bg-primary group-hover:text-white sm:static sm:size-9">
        <ArrowRight size={17} aria-hidden="true" />
      </span>
    </Link>
  );
}
