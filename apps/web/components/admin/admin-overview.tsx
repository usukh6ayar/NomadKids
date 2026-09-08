"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";
import {
  adminDashboardSchema,
  developmentDomainSchema,
  type AdminDashboard,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { formatFileSize, formatLongDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { StatCard, StatTrend } from "@/components/ui/stat-card";
import { IconChip } from "@/components/ui/icon-chip";
import { Art } from "@/components/ui/art";
import { SurveySummary } from "@/components/dashboard/survey-summary";
import { BarRow } from "@/components/ui/chart/bar-row";
import { ColumnChart } from "@/components/ui/chart/columns";
import { Donut } from "@/components/ui/chart/donut";
import { Ring } from "@/components/ui/chart/ring";
import { SERIES_TONES } from "@/components/ui/chart/chart-tokens";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { GraduationCap, PieChart } from "lucide-react";
import { AssessmentCoverageSection, RecentActivitySection } from "./dashboard-sections";

/**
 * The administrator's own dashboard — RFP §12.2, and the reference system's
 * `/hyanalt/` screen.
 *
 * ★ It exists because `/dashboard` answered a different person's question.
 *
 * That screen is the teacher's class board — the client named it "Ангийн
 * самбар" on 2026-08-28 — and every figure on it is scoped by
 * `loadActiveTeachingGroupIds`, which reads TEACHER memberships. An
 * administrator holds none, so the register read "Хүүхэд 0 · Бүлэг 0" beside a
 * gender ring that had correctly found ten children: one screen contradicting
 * itself, because half its widgets are group-scoped and half are
 * kindergarten-scoped. Neither half was wrong; the screen was being shown to
 * the wrong person.
 *
 * ★★ It renders at `/admin`, and did not always — 2026-09-04.
 *
 * The first fix branched inside `/dashboard`: same URL, class board for a
 * teacher, this for an administrator. That was sound while `/admin` was a page
 * of tiles, and stopped being sound the day `/admin` grew figures of its own.
 * The product then had **two** administrator dashboards reading one endpoint —
 * `qk.dashboard.admin()` in both — and the login redirect only ever reached
 * the poorer of them, because `primaryDashboard()` sends an ADMIN to `/admin`
 * before it considers TEACHER. The branch inside `/dashboard` was unreachable
 * for the person it had been written for.
 *
 * So the richer screen moved to the URL that already receives them, and the
 * branch went. What is left is one rule with no second copy to disagree with:
 * `/dashboard` is the class board and requires TEACHER, so an administrator
 * who does not teach is redirected off it by `RequireRole`, through `/`, back
 * to here — the same place they would have landed by signing in.
 *
 * ★★★ An administrator who *also* teaches lands here, not on the class board.
 *
 * `primaryDashboard()` checks ADMIN before TEACHER, so signing in brings them
 * here and the register is one click away rather than the other way round.
 * The branch this replaced took the opposite view — its note argued that "a
 * director who has taken a group is a teacher for the purposes of this screen"
 * — but that branch was never reached, so the opinion was never in force and
 * moving it here would be a change of behaviour disguised as a refactor.
 * **The ordering is an open question for the client**, recorded rather than
 * silently decided: one line in `dashboard.service.ts` reverses it.
 *
 * ★★★★ What it does NOT include, and why that is deliberate.
 *
 * The reference's version carries two more panels. **Багш нарын гүйцэтгэл** is
 * an empty skeleton there and stays absent here: ranking teachers by a number
 * is a management decision with real consequences for real people, and nobody
 * has said which number. **Санхүүгийн тойм** reads "— ₮" there;
 * `docs/reference/FINANCE_SCOPE.md` records that the tariffs, age bands and the
 * definition of a funding day have not arrived from the client (D3, D4), so the
 * engine "will correctly calculate nothing" until they do. Drawing either panel
 * from data that does not exist is how a dashboard starts lying.
 */
export function AdminOverview() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
  });

  /*
    ★ All three branches render the same `PageHeader`, on the class board's own
    reasoning (`app/(app)/dashboard/page.tsx`): a title hand-rolled per branch
    is a different size from the one `PageHeader` renders, so it changes in
    place the moment the query resolves. Only the lede differs, and it is never
    empty, because a line that appears late moves everything below it.

    ★★ The lede is the active term, which `/admin` carried before this screen
    moved onto it. It is not decoration: "Улирал тохируулаагүй" is the state in
    which the assessment panels below have nothing to report, and an
    administrator who has not created one needs to read that at the top rather
    than infer it from an empty section further down.
  */
  const header = <PageHeader title="Удирдлагын самбар" />;

  if (isLoading) {
    return (
      <>
        {header}
        <LoadingState rows={4} />
      </>
    );
  }

  if (isError) {
    return (
      <>
        {header}
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </>
    );
  }

  const {
    counts,
    attendanceToday,
    attendanceByGroup,
    domainAveragesByGroup,
    assessmentCoverage,
    recentActivity,
    currentTerm,
    childrenAMonthAgo,
    storage,
  } = data!;

  return (
    <>
      {/* Outside the gap column below: `PageHeader` carries its own `mb-4
          lg:mb-6`, and inside it that margin would stack with `gap-6`. */}
      {header}

      <div className="flex flex-col gap-6">
        {/*
        ★ The register is one of the figures rather than a panel.

        The reference puts "Өнөөдрийн ирц" in the same row as the three counts,
        which is right: at nine in the morning it is the number an administrator
        opens this screen for, and by eleven it is context like the others.

        ★★ Six when the storage figures are there, four when they are not, and
        the column count follows — 2026-09-04.

        The two storage cards came from `/admin`'s own row when this screen
        moved onto that URL. `storage` is `.nullish()` in the contract for a
        deployed client talking to an older API, so the count is genuinely
        variable, and one fixed `lg:grid-cols-4` would orphan two cards in the
        six case while `lg:grid-cols-3` orphans one in the four case. Both
        counts divide by two, so the phone layout never changes; only the wide
        breakpoint has to choose, and it chooses by what it actually has.

        This is the arithmetic `/admin`'s tile grid used to do by hand, kept
        because the reasoning survived the move even though the tiles did not.

        ★★★ Four of the six navigate, and the two that do not are not an
        oversight — 2026-09-04.

        Each figure links to the screen that explains it: the children list, the
        kindergarten-wide register, the groups, the user list, the document
        library and — since 2026-09-09 — `Тайлан`. Every figure on the grid goes
        somewhere now.

        ★★★★★ `Тайлан` → `/reports`, at the client's request, and the screen
        had to be made reachable first. It resolved a group through `useMyGroup`
        and an administrator has every group and therefore no single one, so a
        director landed on "Бүлэг хараахан хуваарилагдаагүй байна" — a card
        pointing at a sentence telling them they were in the wrong place. It
        carries a `GroupSwitcher` for anybody with more than one group now.

        The figure and the destination answer *adjacent* questions rather than
        the same one: this counts `ReportJob` rows — the PDFs generated from a
        child's portfolio and from `/finance` — while the screen is the month's
        attendance by group. There is no kindergarten-wide list of generated
        reports to point at; `GET /children/:id/reports` is per child and
        nothing aggregates them. Worth revisiting if that endpoint is ever
        built, and worth stating rather than leaving for a reader to notice.

        ★★★★ `Хадгалсан файл` → `Баримт бичгийн сан` — 2026-09-09.

        The client asked what the card was ("Хадгалсан файл гэдэг юу билээ?
        Баримт бичгийн сан уу?"), which it was not, and then that it become
        that. So it did — including the number: it counted every `MediaFile`
        the kindergarten owns, photographs and artwork and avatars and the
        logo, and now counts the published documents. A figure and the label
        over it have to answer the same question, or they disagree in front of
        a reader who can open the screen and count.

        Total storage did not disappear with it. `totalBytes` and `fileCount`
        are still on the payload and still what RFP §12.2's "Хадгалалтын
        хэмжээ" asks for; they are simply no longer *this* card, which now has
        somewhere to go instead.
      */}
        <section
          aria-label="Товч мэдээлэл"
          className={cn("grid grid-cols-2 gap-3", storage ? "lg:grid-cols-3" : "lg:grid-cols-4")}
        >
          <StatCard
            label="Нийт хүүхэд"
            value={counts.children}
            unit="хүүхэд"
            href="/children"
            tone="cornflower"
            art={<Art name="child" size={36} />}
            artSurface={false}
            trend={
              <StatTrend
                current={counts.children}
                previous={childrenAMonthAgo}
                since="сүүлийн 30 хоногт"
              />
            }
          />
          <StatCard
            label="Өнөөдрийн ирц"
            value={
              <>
                {attendanceToday.present}
                <span className="text-muted"> / {attendanceToday.expected}</span>
              </>
            }
            unit={
              attendanceToday.recorded >= attendanceToday.expected && attendanceToday.expected > 0
                ? "бүртгэл бүрэн"
                : `${Math.max(0, attendanceToday.expected - attendanceToday.recorded)} бүртгээгүй`
            }
            tone={
              attendanceToday.recorded >= attendanceToday.expected && attendanceToday.expected > 0
                ? "mint"
                : "sun"
            }
            art={<Art name="attendance" size={36} />}
            artSurface={false}
            href="/attendance/journal"
          />
          <StatCard
            label="Бүлэг"
            value={counts.groups}
            unit="идэвхтэй"
            href="/admin/groups"
            tone="mint"
            art={<Art name="group" size={36} />}
            artSurface={false}
          />
          <StatCard
            label="Багш, ажилтан"
            value={counts.staff}
            unit={`${counts.guardians} эцэг эх`}
            href="/admin/users"
            tone="sky"
            art={<Art name="teacher" size={36} />}
            artSurface={false}
          />

          {/*
          RFP §12.2 — "Хадгалалтын хэмжээ" and "Тайлангийн статистик". Absent
          rather than zero when the API has not sent them: "0 MB" would be a
          claim about the bucket rather than a slower card.
        */}
          {storage ? (
            <>
              {/*
              ★ The figure counts documents; their size is the caption under it.

              It was the other way round once, and on a kindergarten that had
              uploaded nothing the card read "—" over "0 файл":
              `formatFileSize` returns an em dash for zero bytes, which is right
              where a size is unknown and wrong where it is known to be nothing.
              A count has an honest zero; a size does not.
            */}
              <StatCard
                label="Баримт бичгийн сан"
                value={storage.documents.count}
                unit={
                  storage.documents.totalBytes > 0
                    ? formatFileSize(storage.documents.totalBytes)
                    : "хоосон"
                }
                href="/documents"
                tone="teal"
                /*
                  ★ `Art`, not a lucide glyph — #69 turned this grid 3D while
                  #70 was replacing this card's icon for a different reason, and
                  the merge kept one of the two. `register` is the ledger; the
                  set has no `document`, and `report` belongs to the card below.
                */
                art={<Art name="register" size={36} />}
                artSurface={false}
              />
              <StatCard
                label="Тайлан"
                href="/reports"
                value={storage.reports.done}
                unit={
                  storage.reports.failed > 0
                    ? `${storage.reports.total} нийт · ${storage.reports.failed} амжилтгүй`
                    : `${storage.reports.total} нийт`
                }
                tone="sun"
                art={<Art name="report" size={36} />}
              />
            </>
          ) : null}
        </section>

        {/*
        ★ These two are paired because they are the same shape, not because
        they are the same subject.

        Both render exactly one row per group, so they stay the same height at
        every kindergarten — two groups or twelve. The drawing pairs two panels
        of similar size; pairing by *row count* is how that stays true when the
        data changes, and the first attempt (the domain chart beside this list)
        put a ten-bar panel next to a two-row one and left half a screen empty.

        Below `xl` the content column is under 900px, where two columns start
        wrapping a Mongolian group name — so they stack rather than shrink, the
        same trade `/admin`'s tile grid makes at the same breakpoint.
      */}
        {/*
        ★ A dial and a ring, because these two questions have different shapes.

        Every panel on this screen was a horizontal bar, and a screen where
        every answer looks the same teaches a reader to stop distinguishing the
        questions. The two here are genuinely different kinds of fact and the
        chart primitives this codebase already owns say so:

          · "how full is the kindergarten today" is one number against a
            maximum — a `Ring`, which is what a dial is for
          · "what did the last month look like" is parts of a whole — a
            `Donut`, which is what `gender-ratio.tsx` uses for the same shape

        Neither was reachable while both were `BarRow`.
      */}
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <TodayDial today={attendanceToday} />
          <AttendanceMix groups={attendanceByGroup} />
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-2">
          <AttendanceByGroup groups={attendanceByGroup} />

          <AssessmentCoverageSection
            coverage={assessmentCoverage}
            hasCurrentTerm={Boolean(currentTerm)}
            href={(groupId) => `/groups/${groupId}/assessment`}
          />
        </div>

        {/* Full width: a column per domain plus a row of bars per group is the
          tallest panel here, and halving its width truncates every Mongolian
          domain name. */}
        <DomainAverages groups={domainAveragesByGroup} hasCurrentTerm={Boolean(currentTerm)} />

        {/*
        ★ The teacher board's own survey panel, unchanged, on the director's
        board too.

        This screen had no survey anywhere while the teacher's dashboard
        carried one, so the person who commissions a survey and reads its
        result was the one person the product never showed how it was going.
        The same component rather than a second version of it: it already
        reads `/kindergartens/:id/surveys` and `/surveys/:id/results`, both of
        which an administrator may call, and a copy adapted "for admins" is how
        two panels answering one question start disagreeing about the number.

        Half width, paired with nothing, because `SurveySummary` is a
        `BoardCard` sized for the teacher board's two-column grid and stretching
        it across this page would leave a bar chart in a field of white.
      */}
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <SurveySummary />
        </div>

        <RecentActivitySection entries={recentActivity} auditHref="/admin/audit" />
      </div>
    </>
  );
}

const domainsSchema = z.array(developmentDomainSchema);

/**
 * Statuses that count as the child having been at the kindergarten.
 *
 * ★ Named here rather than computed in the API, and `dashboard.repository.ts`
 * explains why: which statuses count is a policy question the funding rules
 * answer differently, so the endpoint returns raw counts and each reader states
 * its own definition. This one is the head count.
 */
const ATTENDED = ["PRESENT", "HALF_DAY"] as const;

/**
 * The register's six statuses, in the order a reader thinks about them.
 *
 * ★ Present first, absent last, and the order is fixed rather than sorted by
 * size — a legend that reorders itself between renders makes a reader re-learn
 * it every time, and the colours are handed out by position in this list.
 */
const STATUS_ORDER = ["PRESENT", "HALF_DAY", "EXCUSED", "SICK", "OTHER", "ABSENT"] as const;

/**
 * A tone per status, chosen by meaning rather than by position.
 *
 * ★ `seriesColor` hands these out by index, and two of the six collide.
 *
 * `SERIES_TONES` is `sky · mint · sun · peach · cornflower · teal`, and both
 * `sky-ink` (#1d4e89) and `cornflower-ink` (#2b5aa8) are blue — fine when a
 * chart has three categories, confusing when it has six and the first and
 * fifth are "Ирсэн" and "Бусад".
 *
 * Naming them instead also uses `tone.ts` as documented — a tone is a meaning:
 * present is `mint` (complete), illness is `sun` (waiting) and an unexplained
 * absence is `peach` (attention), which is the one an administrator is looking
 * for. Colour is never the only signal; every segment is named and counted in
 * the legend beside it.
 */
const STATUS_TONE: Record<string, Tone> = {
  PRESENT: "mint",
  HALF_DAY: "sky",
  EXCUSED: "cornflower",
  SICK: "sun",
  OTHER: "teal",
  ABSENT: "peach",
};

const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Ирсэн",
  HALF_DAY: "Хагас өдөр",
  EXCUSED: "Чөлөөтэй",
  SICK: "Өвчтэй",
  ABSENT: "Тасалсан",
  OTHER: "Бусад",
};

/**
 * Today's register as a dial — "how full is the kindergarten right now".
 *
 * ★ A `Ring`, because this is one number against a maximum.
 *
 * That is what a dial is for and what a bar is not: a bar invites comparison
 * with the bar beneath it, and there is nothing beneath this one. The
 * kindergarten's own roster is the maximum, so the arc is always read against
 * the same denominator.
 *
 * ★★ Two figures beside it, not one percentage inside it.
 *
 * `recorded` and `present` answer different questions — whether anyone has
 * taken the register, and how many children came — and the pair is the reason
 * this panel exists rather than a single percentage. At nine in the morning an
 * empty register and an empty kindergarten look identical to one number.
 */
function TodayDial({ today }: { today: AdminDashboard["attendanceToday"] }) {
  const complete = today.expected > 0 && today.recorded >= today.expected;
  const outstanding = Math.max(0, today.expected - today.recorded);
  const percent = today.expected > 0 ? (today.present / today.expected) * 100 : 0;

  return (
    <section aria-labelledby="today-dial">
      <SectionHeader
        id="today-dial"
        title="Өнөөдрийн ирц"
        lede={formatLongDate(new Date())}
        icon={<Art name="attendance" size={40} />}
      />

      <Card pad="roomy" className="flex flex-wrap items-center gap-6">
        <Ring
          percent={percent}
          size="lg"
          tone={complete ? "mint" : "sun"}
          muted={today.expected === 0}
          label={`Ирсэн ${today.present}, нийт ${today.expected}`}
        >
          <span className="text-title font-semibold tabular-nums text-ink">
            {Math.round(percent)}%
          </span>
        </Ring>

        <dl className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <dt className="text-caption text-muted">Ирсэн</dt>
            <dd className="text-figure font-semibold leading-none tabular-nums text-ink">
              {today.present}
              <span className="text-title text-muted"> / {today.expected}</span>
            </dd>
          </div>

          <div className="border-t border-border-soft pt-3">
            <dt className="text-caption text-muted">Бүртгэл</dt>
            <dd
              className={cn("text-lead font-medium", complete ? "text-mint-ink" : "text-sun-ink")}
            >
              {complete ? "Бүрэн бүртгэсэн" : `${outstanding} хүүхэд бүртгээгүй`}
            </dd>
          </div>
        </dl>
      </Card>
    </section>
  );
}

/**
 * The last 30 days as one ring — "what does a month here look like".
 *
 * ★ A `Donut`, because these are parts of a whole.
 *
 * Every recorded day falls into exactly one of six statuses, which is the
 * definition of a pie: the segments sum to the total by construction, so a
 * reader can trust the proportions without reading a single number.
 * `gender-ratio.tsx` uses the same component for the same reason.
 *
 * ★★ The whole kindergarten, not per group.
 *
 * Per-group attendance is the panel below this one, where a bar per group is
 * the right shape because the question there is comparison. This one answers a
 * different question — is the absence we have mostly illness, or mostly
 * unexplained? — and that is about the kindergarten, not about any one group.
 */
function AttendanceMix({ groups }: { groups: AdminDashboard["attendanceByGroup"] }) {
  const totals: Record<string, number> = {};
  for (const group of groups) {
    for (const [status, n] of Object.entries(group.counts)) {
      totals[status] = (totals[status] ?? 0) + n;
    }
  }

  const segments = STATUS_ORDER.filter((s) => (totals[s] ?? 0) > 0).map((status) => ({
    label: STATUS_LABEL[status] ?? status,
    value: totals[status]!,
    tone: STATUS_TONE[status]!,
  }));

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <section aria-labelledby="attendance-mix">
      <SectionHeader
        id="attendance-mix"
        title="Ирцийн бүтэц"
        lede="Сүүлийн 30 хоног, бүх бүлгээр."
        icon={<IconChip icon={<PieChart size={20} aria-hidden />} tone="primary" />}
      />

      {total === 0 ? (
        <Card pad="roomy" className="text-body text-muted">
          Сүүлийн 30 хоногт ирц бүртгээгүй байна.
        </Card>
      ) : (
        <Card pad="roomy" className="flex flex-wrap items-center gap-6">
          <Donut
            segments={segments}
            size={132}
            label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}
            centre={
              <span className="text-center">
                <span className="block text-title font-semibold tabular-nums leading-none text-ink">
                  {total}
                </span>
                <span className="block text-caption text-muted">өдөр</span>
              </span>
            }
          />

          {/*
            A legend with the numbers on it, not a key you have to match by
            colour. `tone.ts` records that colour must never be the only carrier
            of meaning; here every segment is named and counted in text, and the
            swatch only ties the row to its arc.
          */}
          <dl className="grid min-w-0 flex-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {segments.map((segment) => (
              <div key={segment.label} className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-2.5 shrink-0 rounded-pill"
                  style={{ background: TONE_VAR[segment.tone] }}
                />
                <dt className="min-w-0 flex-1 truncate text-body text-muted">{segment.label}</dt>
                <dd className="shrink-0 text-body font-medium tabular-nums text-ink">
                  {segment.value}
                  <span className="ml-1 text-caption font-normal text-muted">
                    {Math.round((segment.value / total) * 100)}%
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </section>
  );
}

/**
 * "Ирцийн нэгтгэл" — each group's attendance over the last 30 days.
 *
 * ★ Bars here, because the question is comparison.
 *
 * The donut above answers "what is our absence made of"; this answers "which
 * group is behind", and a bar is the only shape that lets an eye rank things by
 * running down a column. The two panels use the same data and different charts
 * because they are asked different questions of it.
 */
function AttendanceByGroup({ groups }: { groups: AdminDashboard["attendanceByGroup"] }) {
  const withRows = groups.filter((g) => Object.values(g.counts).some((n) => n > 0));

  return (
    <section aria-labelledby="attendance-by-group">
      <SectionHeader
        id="attendance-by-group"
        title="Бүлгүүдийн ирц"
        lede="Сүүлийн 30 хоног."
        icon={<Art name="group" size={40} />}
      />

      {withRows.length === 0 ? (
        <Card pad="roomy" className="text-body text-muted">
          Сүүлийн 30 хоногт ирц бүртгээгүй байна. Бүлгийн ирцийг өдөр тутам бүртгэснээр энд
          харагдана.
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {withRows.map((group) => {
            const total = Object.values(group.counts).reduce((sum, n) => sum + n, 0);
            const attended = ATTENDED.reduce((sum, s) => sum + (group.counts[s] ?? 0), 0);
            const percent = total > 0 ? Math.round((attended / total) * 100) : 0;

            return (
              <div key={group.groupId} className="px-4 py-3">
                <BarRow
                  inline
                  label={group.name}
                  percent={percent}
                  value={`${percent}%`}
                  /* Green once a group is essentially always here, amber below —
                     the tones' own meanings, and the same threshold the client's
                     drawing marks with its own colour change. */
                  tone={percent >= 90 ? "mint" : percent >= 75 ? "sky" : "sun"}
                  accessibleLabel={`${group.name} — ирц ${percent}%`}
                />
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

/**
 * "Хөгжлийн чиглэлийн дундаж" — RFP §12.3, at the two granularities it needs.
 *
 * ★ Columns for the kindergarten, bars for the groups — and the pairing is the
 * point.
 *
 * The panel answers two questions that look alike and are not. "Which
 * development area is this kindergarten weakest in?" is a comparison across
 * five categories with no natural order, which is what a column chart is for —
 * the eye reads height against a shared baseline. "And is any one group
 * dragging that down?" is a comparison *within* each category, which needs a
 * row per group.
 *
 * Answering both with the same chart is what the first version did, and it
 * produced ten identical bars in two stacks with nothing to say which of them
 * mattered.
 *
 * ★★ The columns are the mean of the group means, not of every assessment.
 *
 * A group of twenty and a group of four would otherwise let the larger one
 * decide the kindergarten's figure — and the question is about the
 * kindergarten's *provision*, where each group is one unit of it. The
 * per-group rows below carry the sample size so a small group is visibly
 * small.
 *
 * ★★★ A domain nobody assessed is absent from the map rather than zero.
 *
 * Zero is a real score on a 1–4 scale's floor. A chart that plots "not
 * assessed" as zero accuses a group of failing at something nobody has looked
 * at yet, which is the opposite of what this panel is for.
 */
function DomainAverages({
  groups,
  hasCurrentTerm,
}: {
  groups: AdminDashboard["domainAveragesByGroup"];
  hasCurrentTerm: boolean;
}) {
  /*
    ★ The domain list, so a bar can be drawn for a domain with no score.

    `averageByDomain` is keyed by domain id and omits the unassessed ones by
    design, so it cannot name the rows on its own — a group with two of five
    domains assessed would render two bars and silently drop the other three.
    Same query key as `/admin/assessment-config`, so an administrator who has
    opened that screen this session pays nothing for it here.
  */
  const { primaryKindergartenId } = useSession();
  const { data: domains } = useQuery({
    queryKey: qk.configDomains(primaryKindergartenId ?? ""),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/development-domains`, domainsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  const assessed = groups.filter((g) => g.sampleSize > 0);

  /** The kindergarten-wide mean per domain — the mean of the group means. */
  const overall = (domains ?? []).map((domain) => {
    const scores = assessed
      .map((g) => g.averageByDomain[domain.id])
      .filter((v): v is number => v !== undefined);

    return {
      domain,
      average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    };
  });

  return (
    <section aria-labelledby="domain-averages">
      <SectionHeader
        id="domain-averages"
        title="Хөгжлийн чиглэлийн дундаж"
        lede="1–4 оноогоор. Багана нь цэцэрлэгийн дундаж, мөр нь бүлэг тус бүр."
        icon={<IconChip icon={<GraduationCap size={20} aria-hidden />} tone="primary" />}
      />

      {!hasCurrentTerm ? (
        <Card pad="roomy" className="text-body text-muted">
          Идэвхтэй улирал тохируулаагүй байна.{" "}
          <Link href="/admin/terms" className="text-primary hover:underline">
            Улирал нэмэх
          </Link>
        </Card>
      ) : assessed.length === 0 || !domains?.length ? (
        <Card pad="roomy" className="text-body text-muted">
          Энэ улиралд үнэлгээ хийгдээгүй байна.
        </Card>
      ) : (
        <Card pad="roomy" className="flex flex-col gap-6">
          {/*
            The scale is 1–4, so a column is drawn against 4 rather than against
            the largest value in the set — a kindergarten at 3.9 beside one at
            4.0 must not look half as far along. `tilted` because the domain
            names are sentences, not abbreviations.
          */}
          <ColumnChart
            height={132}
            /*
              The rules are the four steps of the scale, and the axis prints
              them as scores. A director reading "50%" against a domain scored
              2.0 has to do the conversion every time; the scale is 1–4 and the
              chart should say so.
            */
            gridlines={[0, 25, 50, 75, 100]}
            axisLabel={(percent) => String((percent / 100) * 4)}
            columns={overall.map(({ domain, average }, index) => ({
              label: domain.name,
              value: average === null ? null : (average / 4) * 100,
              /*
                A colour per domain, matching the order the per-group bars
                below run in — so a reader who spots the weakest column can
                find the same domain in each group's list without counting
                positions. `seriesColor` hands them out in a fixed order, so a
                domain keeps its colour between renders.
              */
              tone: SERIES_TONES[index % SERIES_TONES.length],
              accessibleLabel:
                average === null
                  ? `${domain.name} — үнэлгээгүй`
                  : `${domain.name} — ${average.toFixed(1)} оноо`,
            }))}
            emptyLabel="үнэлгээгүй"
          />

          <div className="grid gap-x-8 gap-y-6 border-t border-border-soft pt-5 lg:grid-cols-2">
            {assessed.map((group) => (
              <div key={group.groupId}>
                <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-lead font-semibold text-ink">
                  {group.name}
                  <span className="text-caption font-normal text-muted">
                    {group.sampleSize} үнэлгээ
                  </span>
                </p>

                <div className="flex flex-col gap-1.5">
                  {domains.map((domain, index) => {
                    const average = group.averageByDomain[domain.id];
                    return (
                      <BarRow
                        key={domain.id}
                        inline
                        labelWidth="w-[136px] lg:w-[152px] xl:w-[200px]"
                        label={domain.name}
                        percent={average === undefined ? 0 : (average / 4) * 100}
                        value={average === undefined ? "—" : average.toFixed(1)}
                        /* The same accent this domain has in the columns above,
                           which is what makes the two halves one panel. */
                        tone={SERIES_TONES[index % SERIES_TONES.length]}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}
