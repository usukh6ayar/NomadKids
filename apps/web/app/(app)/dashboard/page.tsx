"use client";

import { useQuery } from "@tanstack/react-query";
import { teacherDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { formatDate } from "@/lib/format";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { AttendanceToday } from "@/components/dashboard/attendance-today";
import { TodayMenu } from "@/components/dashboard/today-menu";
import { SurveySummary } from "@/components/dashboard/survey-summary";
import { ClassBoardNotice } from "@/components/dashboard/class-board-notice";
import { GenderRatio } from "@/components/dashboard/gender-ratio";
import { MonthBirthdays } from "@/components/dashboard/month-birthdays";
import { WeeklyAttendance } from "@/components/dashboard/weekly-attendance";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { AdminOverview } from "@/components/dashboard/admin-overview";
import { useSession } from "@/lib/auth/session";

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
      <Home />
    </RequireRole>
  );
}

/**
 * The staff landing screen, which is two screens.
 *
 * ★ Same URL, different content, because "home" means different things.
 *
 * Everything below this line is the teacher's class board — the client's own
 * name for it since 2026-08-28 — and every figure on it is scoped by
 * `loadActiveTeachingGroupIds`, which reads TEACHER memberships. An
 * administrator holds none, so they were shown a class board reporting "Хүүхэд
 * 0 · Бүлэг 0" beside a gender ring that had correctly counted ten children.
 * Half the widgets are group-scoped and half are kindergarten-scoped; the
 * screen was contradicting itself because it was being shown to the wrong
 * person, not because either half was wrong.
 *
 * ★★ Branching here rather than at the route.
 *
 * A separate `/admin/overview` would give an administrator two landing pages
 * and make "Нүүр" ambiguous in the sidebar. The reference system reached the
 * same arrangement from the other direction: its `/hyanalt/` is one URL that
 * renders "Удирдлагын самбар" for an admin.
 *
 * ★★★ An admin who also teaches gets the class board.
 *
 * `hasRole("TEACHER")` wins, and the order matters: a director who has taken a
 * group is a teacher for the purposes of this screen — they have children to
 * register this morning — and the kindergarten-wide figures are one click away
 * under Удирдлага. The reverse default would hide the register from the person
 * who has to take it.
 */
function Home() {
  const { hasRole } = useSession();

  if (hasRole("ADMIN") && !hasRole("TEACHER")) {
    return (
      <div className="flex flex-col gap-5 py-2">
        <PageHeader title="Удирдлагын самбар" lede="Цэцэрлэгийн өнөөдрийн байдал." />
        <AdminOverview />
      </div>
    );
  }

  return <TeacherDashboard />;
}

function TeacherDashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.teacher(),
    queryFn: () => get("/dashboard/teacher", teacherDashboardSchema),
  });

  // Shared with `TeacherHero`, `AttendanceToday` and `WeeklyAttendance` under
  // one query key, so naming the group in the lede costs nothing.
  const { group, count: groupCount } = useMyGroup();

  /*
   * ★ All three branches render the same `PageHeader`.
   *
   * They used to hand-roll `<h1 className="text-xl font-semibold">`, which is a
   * different size *and* a different weight from the one `PageHeader` renders —
   * so the title grew 4px and changed weight in place the moment the query
   * resolved. Three copies of one string, and the copy nobody looks at was the
   * one on screen while the screen was loading. Only the lede differs between
   * them, and it is never empty, because a line that appears late moves
   * everything below it.
   *
   * ★★ "Ангийн самбар", renamed from "Хяналтын самбар" on 2026-08-28. The
   * client's own name for this screen, and the reason `ClassBoardNotice`'s
   * heading moved to "Сүүлийн нийтлэл" in the same pass: the two would
   * otherwise have been the same string on the same page.
   *
   * The lede is the group and the date, in the sketch's own order — the two
   * facts that scope every figure below it. `useMyGroup()` resolves the group
   * the whole screen already speaks about, so this costs no request.
   *
   * ★★★ No header search and no "+ Үйлдэл" menu.
   *
   * Both went with the widgets on 2026-08-28. The sketch's header is a title
   * and a line under it, and neither control was reachable only from here: the
   * search submitted into `/children`, which has its own, and the menu's three
   * destinations are the primary actions of the three screens they open.
   */
  const header = (lede: string) => <PageHeader title="Ангийн самбар" lede={lede} />;

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

  /*
   * ★ Five of the ten fields `GET /dashboard/teacher` returns are read here now.
   *
   * `counts`, `needsAttention`, `recentObservations`, `termProgress` and
   * `observationsByType` belong to the nine widgets this screen dropped on
   * 2026-08-28 (see the docblock above). They are deliberately **not** removed
   * from `teacherDashboardSchema` or from the endpoint: the components that
   * read them still exist and still have tests, and narrowing a response to
   * match one screen's current layout is the coupling `GroupsSection` and
   * `DashboardStats` each decline in their own comments.
   */
  const { currentTerm, birthdaysThisMonth, boardNotice } = data!;

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
    <div className="flex flex-col gap-5 lg:gap-6">
      {header(
        /*
          Group · date, per the sketch — but only where naming one group is
          true. An admin sees every group in the kindergarten and
          `TeacherAssignment` permits a teacher covering two, so both fall back
          to the term rather than being told they run "Дэлбээ". Same rule
          `WhoAmI` (`app-shell.tsx`) applies to the sidebar's context line.
        */
        groupCount === 1 && group
          ? `${group.name} · ${formatDate(new Date())}`
          : currentTerm
            ? `${currentTerm.name} · идэвхтэй улирал`
            : "Идэвхтэй улирал тохируулаагүй",
      )}

      {/*
        ★ Two across from 375px up, not from a breakpoint.

        The sketch pairs these on a *phone*, and that is buildable: at 375px
        each card is about 168px, which fits a 96px dial over "30 / 35" (the
        card stacks its ring and figure below `sm`) and two counts either side
        of a rule. `AttendanceToday` and `GenderRatio` each carry that
        narrow-width handling themselves rather than the page guessing at it.

        ★★ Neither card can vanish, so this needs no hole-guard. Both render a
        quiet `BoardCardEmpty` on every failure and empty case — their
        docblocks record reversing `return null` for exactly this grid.
      */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:gap-5">
        <AttendanceToday />
        <GenderRatio />
      </div>

      {/* The week's register, full width — the sketch's own emphasis, and the
          only card on the screen that needs a horizontal axis. */}
      <WeeklyAttendance />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:gap-5">
        <MonthBirthdays birthdays={birthdaysThisMonth} />
        <SurveySummary />
      </div>

      {/* The latest post, full width. Stacked on a phone; text beside its
          photograph from `lg` — see `class-board-notice.tsx`. */}
      <ClassBoardNotice notice={boardNotice} />

      {/*
        ★★★ D — today's menu, restored 2026-08-29.

        It came off this screen with the eight other widgets the redesign
        removed, and unlike them it had nowhere else to go: `TodayMenu` is the
        only surface anywhere in the product for the allergy cross-check, which
        CLAUDE.md §7 lists as delivered ("§11 the allergy cross-check — done").
        Removing the dashboard from under it did not remove the feature from
        scope, it just made it unreachable — so it sits below the five cards the
        client drew rather than among them, which keeps their layout exactly as
        approved.
      */}
      <TodayMenu />
    </div>
  );
}
