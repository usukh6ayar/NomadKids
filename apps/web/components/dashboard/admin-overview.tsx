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
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { StatCard, StatTrend } from "@/components/ui/stat-card";
import { IconChip } from "@/components/ui/icon-chip";
import { BarRow } from "@/components/ui/chart/bar-row";
import { CalendarCheck, GraduationCap, School, Users } from "lucide-react";
import {
  AssessmentCoverageSection,
  RecentActivitySection,
} from "@/components/admin/dashboard-sections";

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
 * So the URL stays and the content follows the viewer. `/dashboard` means
 * "your home"; what home *is* depends on whether you run a class or a
 * kindergarten. The reference system reached the same arrangement — its
 * `/hyanalt/` renders "Удирдлагын самбар" for an admin.
 *
 * ★★ What it does NOT include, and why that is deliberate.
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

  if (isLoading) return <LoadingState rows={4} />;

  if (isError) {
    return (
      <ErrorState
        description={errorMessage(error)}
        action={
          <Button variant="secondary" onClick={() => void refetch()}>
            Дахин оролдох
          </Button>
        }
      />
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
  } = data!;

  return (
    <div className="flex flex-col gap-6">
      {/*
        ★ Four figures, and the register is one of them rather than a panel.

        The reference puts "Өнөөдрийн ирц" in the same row as the three counts,
        which is right: at nine in the morning it is the number an administrator
        opens this screen for, and by eleven it is context like the others.
      */}
      <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Нийт хүүхэд"
          value={counts.children}
          unit="хүүхэд"
          tone="cornflower"
          art={<Users size={22} aria-hidden />}
          trend={
            <StatTrend
              current={counts.children}
              previous={childrenAMonthAgo}
              since="сүүлийн 30 хоногт"
            />
          }
        />
        <AttendanceTodayCard today={attendanceToday} />
        <StatCard
          label="Бүлэг"
          value={counts.groups}
          unit="идэвхтэй"
          tone="mint"
          art={<School size={22} aria-hidden />}
        />
        <StatCard
          label="Багш, ажилтан"
          value={counts.staff}
          unit={`${counts.guardians} эцэг эх`}
          tone="sky"
          art={<GraduationCap size={22} aria-hidden />}
        />
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
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <AttendanceByGroup groups={attendanceByGroup} />

        <AssessmentCoverageSection
          coverage={assessmentCoverage}
          hasCurrentTerm={Boolean(currentTerm)}
          href={(groupId) => `/groups/${groupId}/assessment`}
        />
      </div>

      {/* Full width: five bars per group is the tallest panel here, and halving
          its width truncates every Mongolian domain name. */}
      <DomainAverages groups={domainAveragesByGroup} hasCurrentTerm={Boolean(currentTerm)} />

      <RecentActivitySection entries={recentActivity} auditHref="/admin/audit" />
    </div>
  );
}

const domainsSchema = z.array(developmentDomainSchema);

/**
 * "Өнөөдрийн ирц — 12 / 14".
 *
 * ★ The figure is who came; the caption says whether anyone has looked.
 *
 * `recorded` and `present` answer different questions and the card shows both,
 * because at nine in the morning they are the two states that matter and a
 * single percentage cannot tell them apart: a register nobody has filled in and
 * a kindergarten nobody came to both read as 0%.
 *
 * ★★ `sun` while the register is incomplete, `mint` once it is done — the
 * tones' own meanings from `tone.ts`, "waiting" and "complete", used as
 * documented rather than for decoration.
 */
function AttendanceTodayCard({ today }: { today: AdminDashboard["attendanceToday"] }) {
  const complete = today.expected > 0 && today.recorded >= today.expected;
  const outstanding = Math.max(0, today.expected - today.recorded);

  return (
    <StatCard
      label="Өнөөдрийн ирц"
      value={
        <>
          {today.present}
          <span className="text-muted"> / {today.expected}</span>
        </>
      }
      unit={complete ? "бүртгэл бүрэн" : `${outstanding} хүүхэд бүртгээгүй`}
      tone={complete ? "mint" : "sun"}
      art={<CalendarCheck size={22} aria-hidden />}
    />
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

const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Ирсэн",
  HALF_DAY: "Хагас өдөр",
  EXCUSED: "Чөлөөтэй",
  SICK: "Өвчтэй",
  ABSENT: "Тасалсан",
  OTHER: "Бусад",
};

/**
 * "Ирцийн нэгтгэл" — each group's attendance over the last 30 days.
 *
 * ★ A percentage *and* the counts behind it.
 *
 * A bar alone invites the reading "Ахлах бүлэг is at 78%" without saying of
 * what: 78% of a fortnight is a different fact from 78% of one recorded day.
 * The breakdown underneath names every status with a row, so a group whose
 * absences are all `SICK` is not read as a group with an attendance problem.
 */
function AttendanceByGroup({ groups }: { groups: AdminDashboard["attendanceByGroup"] }) {
  const withRows = groups.filter((g) => Object.values(g.counts).some((n) => n > 0));

  return (
    <section aria-labelledby="attendance-by-group">
      <SectionHeader
        id="attendance-by-group"
        title="Ирцийн нэгтгэл"
        lede="Сүүлийн 30 хоног, бүлгээр."
        icon={<IconChip icon={<CalendarCheck size={20} aria-hidden />} tone="primary" />}
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
              <div key={group.groupId} className="flex flex-col gap-1.5 px-4 py-3">
                <BarRow
                  inline
                  label={group.name}
                  percent={percent}
                  value={`${percent}%`}
                  accessibleLabel={`${group.name} — ирц ${percent}%`}
                />
                <p className="text-caption leading-relaxed text-muted sm:pl-[116px] md:pl-[144px]">
                  {Object.entries(group.counts)
                    .filter(([, n]) => n > 0)
                    .map(([status, n]) => `${STATUS_LABEL[status] ?? status} ${n}`)
                    .join(" · ")}
                </p>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

/**
 * "Бүлгүүдийн явцын үнэлгээ" — RFP §12.3's "Хөгжлийн чиглэлийн дундаж".
 *
 * ★ Bars, not the radar the reference sketched.
 *
 * `DevelopmentRadar` exists and is used on a child's page, where it compares
 * *one* child against their group — two shapes on one set of axes, which is
 * what a radar is good at. Here there are up to twenty groups and five domains,
 * and twenty overlaid polygons is a diagram nobody can read. Bars grouped by
 * domain answer the question this panel is actually asked ("is any group
 * behind, and in what?") by letting the eye run down a column.
 *
 * ★★ A domain with no assessments renders "—", never a zero-length bar. The
 * endpoint leaves it out of the map for the same reason: zero is a real score
 * on a 1–4 scale, and drawing "not assessed" as zero accuses a group of failing
 * at something nobody has looked at.
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

  return (
    <section aria-labelledby="domain-averages">
      <SectionHeader
        id="domain-averages"
        title="Бүлгүүдийн явцын үнэлгээ"
        lede="Хөгжлийн чиглэл тус бүрийн дундаж, 1–4 оноогоор."
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
        <Card pad="roomy" className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          {assessed.map((group) => (
            <div key={group.groupId}>
              <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-lead font-semibold text-ink">
                {group.name}
                <span className="text-caption font-normal text-muted">
                  {group.sampleSize} үнэлгээ
                </span>
              </p>

              <div className="flex flex-col gap-1.5">
                {domains.map((domain) => {
                  const average = group.averageByDomain[domain.id];
                  return (
                    <BarRow
                      key={domain.id}
                      inline
                      labelWidth="w-[136px] lg:w-[152px] xl:w-[200px]"
                      label={domain.name}
                      /* The scale is 1–4, so a bar is drawn against 4 rather
                         than against the largest value in the set — a group at
                         3.9 beside one at 4.0 must not look half as far along. */
                      percent={average === undefined ? 0 : (average / 4) * 100}
                      value={average === undefined ? "—" : average.toFixed(1)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
