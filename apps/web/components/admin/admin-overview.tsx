"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { adminDashboardSchema, type AdminDashboard } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { formatLongDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { StatCard } from "@/components/ui/stat-card";
import { Art } from "@/components/ui/art";
import { BarRow } from "@/components/ui/chart/bar-row";
import { Donut } from "@/components/ui/chart/donut";
import { Ring } from "@/components/ui/chart/ring";
import { TONE_VAR, type Tone } from "@/components/ui/tone";

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

  const { counts, attendanceToday, attendanceByGroup, storage } = data!;

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
          {/* ★ "Суралцагч", not "хүүхэд" — 2026-09-17, at the client's request,
              and the same word the roster this card links to now uses. */}
          <StatCard
            label="Нийт суралцагч"
            value={counts.children}
            href="/children"
            tone="cornflower"
            art={<Art name="child" size={36} />}
            artSurface={false}
          />
          <StatCard
            label="Өнөөдрийн ирц"
            value={
              <>
                {attendanceToday.present}
                <span className="text-muted"> / {attendanceToday.expected}</span>
              </>
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
            href="/admin/groups"
            tone="mint"
            art={<Art name="group" size={36} />}
            artSurface={false}
          />
          <StatCard
            label="Багш, ажилтан"
            value={counts.staff}
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
                href="/documents"
                tone="teal"
                art={<Art name="adminDocuments" size={36} />}
                artSurface={false}
              />
              <StatCard
                label="Тайлан"
                href="/reports"
                value={storage.reports.done}
                tone="sun"
                art={<Art name="adminReport" size={36} />}
                artSurface={false}
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
        <AttendanceSection today={attendanceToday} groups={attendanceByGroup} />
      </div>
    </>
  );
}

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
 * The four statuses shown in the administrator's attendance summary.
 *
 * ★ Present first, absent last, and the order is fixed rather than sorted by
 * size — a legend that reorders itself between renders makes a reader re-learn
 * it every time, and the colours are handed out by position in this list.
 * `HALF_DAY` and `OTHER` remain valid API values for historical records, but
 * are intentionally omitted from this frontend summary.
 */
const STATUS_ORDER = ["PRESENT", "EXCUSED", "SICK", "ABSENT"] as const;

/**
 * A tone per status, chosen by meaning rather than by position.
 *
 * Naming them instead also uses `tone.ts` as documented — a tone is a meaning:
 * present is `mint` (complete), illness is `sun` (waiting) and an unexplained
 * absence is `peach` (attention), which is the one an administrator is looking
 * for. Colour is never the only signal; every segment is named and counted in
 * the legend beside it.
 */
const STATUS_TONE: Record<string, Tone> = {
  PRESENT: "mint",
  EXCUSED: "cornflower",
  SICK: "sun",
  ABSENT: "peach",
};

const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Ирсэн",
  EXCUSED: "Чөлөөтэй",
  SICK: "Өвчтэй",
  ABSENT: "Тасалсан",
};

type AttendanceView = "today" | "month" | "group";

const ATTENDANCE_VIEWS: { value: AttendanceView; label: string }[] = [
  { value: "today", label: "Өнөөдөр" },
  { value: "month", label: "Сар" },
  { value: "group", label: "Бүлэг" },
];

/**
 * "Ирц" — the three attendance panels behind one title — client, 2026-09-25:
 * "Ирц гэж гарчиглаад Өнөөдөр|Сар|Бүлэг гэж арагш цувуулан сонгож хардаг
 * болго". One panel at a time, chosen from a row of three beside the title.
 */
function AttendanceSection({
  today,
  groups,
}: {
  today: AdminDashboard["attendanceToday"];
  groups: AdminDashboard["attendanceByGroup"];
}) {
  const [view, setView] = useState<AttendanceView>("today");

  return (
    <section aria-labelledby="attendance-heading">
      <SectionHeader
        id="attendance-heading"
        title="Ирц"
        action={
          <div
            role="tablist"
            aria-label="Ирцийн харагдац"
            className="inline-flex gap-1 rounded-control bg-canvas p-1"
          >
            {ATTENDANCE_VIEWS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={cn(
                  "min-h-9 rounded-control px-3.5 text-body font-medium transition-colors",
                  view === value
                    ? "bg-surface text-primary shadow-sm"
                    : "text-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      <div role="tabpanel" aria-label={ATTENDANCE_VIEWS.find((v) => v.value === view)!.label}>
        {view === "today" ? (
          <TodayDial today={today} />
        ) : view === "month" ? (
          <AttendanceMix groups={groups} />
        ) : (
          <AttendanceByGroup groups={groups} />
        )}
      </div>
    </section>
  );
}

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
    <div className="flex flex-col gap-2">
      <p className="text-caption text-muted">{formatLongDate(new Date())}</p>

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
    </div>
  );
}

/**
 * The last 30 days as one ring — "what does a month here look like".
 *
 * ★ A `Donut`, because these are parts of a whole.
 *
 * Every status shown here is one part of the displayed total, so the reader
 * can trust the proportions without reading a single number.
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
    <div className="flex flex-col gap-2">
      <p className="text-caption text-muted">Сүүлийн 30 хоног, бүх бүлгээр.</p>

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
    </div>
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
    <div className="flex flex-col gap-2">
      <p className="text-caption text-muted">Сүүлийн 30 хоног.</p>

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
    </div>
  );
}
