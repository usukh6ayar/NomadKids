"use client";

import { useQuery } from "@tanstack/react-query";
import {
  adminDashboardSchema,
  developmentDomainSchema,
  type AdminDashboard,
} from "@kinder/contracts";
import Link from "next/link";
import { ChevronRight, CircleAlert, ClipboardCheck, FileWarning, UsersRound } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { BarRow } from "@/components/ui/chart/bar-row";
import { Ring } from "@/components/ui/chart/ring";
import { SERIES_TONES } from "@/components/ui/chart/chart-tokens";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatCard } from "@/components/ui/stat-card";
import { TONE_VAR, type Tone } from "@/components/ui/tone";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";

const domainsSchema = z.array(developmentDomainSchema);
const GOOD_THRESHOLD = 95;
const ATTENTION_THRESHOLD = 80;

type Coverage = AdminDashboard["assessmentCoverage"][number];

function coveragePercent(group: Pick<Coverage, "children" | "assessed">) {
  if (group.children <= 0) return 0;
  return Math.min(100, Math.round((group.assessed / group.children) * 100));
}

function coverageTone(group: Pick<Coverage, "children" | "assessed">): Tone {
  if (group.children <= 0) return "sky";
  const percent = coveragePercent(group);
  if (percent >= GOOD_THRESHOLD) return "mint";
  if (percent >= ATTENTION_THRESHOLD) return "sun";
  return "peach";
}

function CoverageBar({ group }: { group: Pick<Coverage, "name" | "children" | "assessed"> }) {
  const percent = coveragePercent(group);
  const tone = coverageTone(group);

  return (
    <span
      role="img"
      aria-label={`${group.name} — үнэлгээний гүйцэтгэл ${percent}%`}
      className="block h-2 w-full overflow-hidden rounded-pill bg-track"
    >
      <span
        className="block h-full rounded-pill"
        style={{ width: `${percent}%`, background: TONE_VAR[tone] }}
      />
    </span>
  );
}

function GroupCoverageCard({ group }: { group: Coverage }) {
  const percent = coveragePercent(group);
  const missing = Math.max(0, group.children - group.assessed);

  return (
    <Link href={`/groups/${group.groupId}/assessment`} className="group block rounded-card">
      <Card
        tone={coverageTone(group)}
        pad="compact"
        className="h-full transition-transform group-hover:-translate-y-0.5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-lead font-semibold text-ink">{group.name}</p>
            <p className="mt-0.5 text-caption text-muted">
              {group.assessed} / {group.children} хүүхэд үнэлсэн
            </p>
          </div>
          <ChevronRight className="mt-1 shrink-0 text-muted" size={19} aria-hidden />
        </div>

        <p className="mt-3 text-figure font-semibold tabular-nums leading-none text-ink">
          {group.children > 0 ? `${percent}%` : "—"}
        </p>
        <div className="mt-3">
          <CoverageBar group={group} />
        </div>
        <p className="mt-2 text-caption text-muted">
          {group.children === 0
            ? "Бүртгэлтэй хүүхэдгүй"
            : missing === 0
              ? "Үнэлгээ бүрэн"
              : `${missing} хүүхдийн үнэлгээ дутуу`}
        </p>
      </Card>
    </Link>
  );
}

function RankedGroupRow({ group, rank }: { group: Coverage; rank: number }) {
  const percent = coveragePercent(group);

  return (
    <Link
      href={`/groups/${group.groupId}/assessment`}
      className="flex items-center gap-3 rounded-row px-2 py-2 transition-colors hover:bg-canvas"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-sunken text-caption font-semibold tabular-nums text-muted">
        {rank}
      </span>
      <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{group.name}</span>
      <span className="w-20 shrink-0 sm:w-28">
        <CoverageBar group={group} />
      </span>
      <span className="w-10 shrink-0 text-right text-body font-semibold tabular-nums text-ink">
        {percent}%
      </span>
    </Link>
  );
}

export function AdminAssessmentOverview() {
  const { primaryKindergartenId } = useSession();
  const dashboard = useQuery({
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
  });
  const domains = useQuery({
    queryKey: qk.configDomains(primaryKindergartenId ?? ""),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/development-domains`, domainsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  const header = <PageHeader title="Явцын үнэлгээ" />;

  if (dashboard.isLoading) {
    return (
      <>
        {header}
        <LoadingState rows={4} shape="cards" />
      </>
    );
  }

  if (dashboard.isError) {
    return (
      <>
        {header}
        <ErrorState
          description={errorMessage(dashboard.error)}
          action={
            <Button variant="secondary" onClick={() => void dashboard.refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </>
    );
  }

  const data = dashboard.data!;
  const coverage = data.assessmentCoverage;
  const totalChildren = coverage.reduce((sum, group) => sum + group.children, 0);
  const totalAssessed = coverage.reduce((sum, group) => sum + group.assessed, 0);
  const overallPercent =
    totalChildren > 0 ? Math.min(100, Math.round((totalAssessed / totalChildren) * 100)) : 0;
  const missingChildren = Math.max(0, totalChildren - totalAssessed);
  const groupsNeedingAttention = coverage
    .filter((group) => group.children > 0 && coveragePercent(group) < GOOD_THRESHOLD)
    .sort((a, b) => coveragePercent(a) - coveragePercent(b));
  const leadingGroups = coverage
    .filter((group) => group.children > 0 && coveragePercent(group) >= GOOD_THRESHOLD)
    .sort((a, b) => coveragePercent(b) - coveragePercent(a));
  const domainGroups = new Map(data.domainAveragesByGroup.map((group) => [group.groupId, group]));
  const activeDomains = (domains.data ?? []).filter((domain) => domain.isActive !== false);
  const assessedDomainGroups = data.domainAveragesByGroup.filter((group) => group.sampleSize > 0);
  const overallDomains = activeDomains.map((domain) => {
    const values = assessedDomainGroups
      .map((group) => group.averageByDomain[domain.id])
      .filter((value): value is number => value !== undefined);
    return {
      domain,
      average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    };
  });

  return (
    <>
      <PageHeader
        title="Явцын үнэлгээ"
        lede={`${coverage.length || data.counts.groups} бүлгийн хүүхдийн хөгжлийн явцын тойм`}
        actions={
          <Badge tone={data.currentTerm ? "sky" : "sun"}>
            {data.currentTerm?.name ?? "Улирал тохируулаагүй"}
          </Badge>
        }
      />

      <div className="flex flex-col gap-6 lg:gap-8">
        <section
          aria-label="Үнэлгээний товч мэдээлэл"
          className="grid grid-cols-2 gap-3 xl:grid-cols-4"
        >
          <StatCard
            label="Нийт бүлэг"
            value={coverage.length || data.counts.groups}
            unit="бүлэг"
            tone="cornflower"
            art={<UsersRound size={22} />}
          />
          <StatCard
            label="Үнэлгээний гүйцэтгэл"
            value={totalChildren > 0 ? `${overallPercent}%` : "—"}
            unit={`${totalAssessed} / ${totalChildren} хүүхэд`}
            tone={totalChildren > 0 && overallPercent >= GOOD_THRESHOLD ? "mint" : "sun"}
            art={<ClipboardCheck size={22} />}
            chart={
              <Ring
                percent={overallPercent}
                size="sm"
                tone={overallPercent >= GOOD_THRESHOLD ? "mint" : "sun"}
                muted={totalChildren === 0}
              />
            }
          />
          <StatCard
            label="Анхаарах бүлэг"
            value={groupsNeedingAttention.length}
            unit="бүлэг"
            tone="peach"
            art={<CircleAlert size={22} />}
          />
          <StatCard
            label="Үнэлгээ дутуу"
            value={missingChildren}
            unit="хүүхэд"
            tone="sky"
            art={<FileWarning size={22} />}
          />
        </section>

        <section aria-labelledby="assessment-groups-heading">
          <SectionHeader
            id="assessment-groups-heading"
            title="Бүлгүүдийн харьцуулалт"
            lede="Бүлэг дээр дарж үнэлгээний дэлгэрэнгүй рүү орно."
            action={
              <div aria-label="Гүйцэтгэлийн тайлбар" className="flex flex-wrap justify-end gap-2">
                <Badge tone="mint">95–100% Сайн</Badge>
                <Badge tone="sun">80–94% Анхаарах</Badge>
                <Badge tone="peach">80%-аас бага</Badge>
              </div>
            }
          />

          {!data.currentTerm ? (
            <EmptyState
              title="Идэвхтэй улирал тохируулаагүй байна"
              description="Улирал тохируулсны дараа бүлгүүдийн үнэлгээний явц харагдана."
              action={
                <Button asChild size="sm">
                  <Link href="/admin/terms">Улирал тохируулах</Link>
                </Button>
              }
            />
          ) : coverage.length === 0 ? (
            <EmptyState
              title="Үнэлгээний мэдээлэл алга"
              description="Идэвхтэй бүлэг бүртгэгдээгүй байна."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {coverage.map((group) => (
                <GroupCoverageCard key={group.groupId} group={group} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="assessment-domains-heading">
          <SectionHeader
            id="assessment-domains-heading"
            title="Хөгжлийн бүх үзүүлэлт"
            lede="1–4 онооны дундаж. Үнэлгээ хийгдээгүй үзүүлэлтийг зураасаар тэмдэглэв."
          />

          {domains.isLoading ? <LoadingState rows={2} shape="cards" /> : null}
          {domains.isError ? (
            <ErrorState
              description={errorMessage(domains.error)}
              action={
                <Button variant="secondary" onClick={() => void domains.refetch()}>
                  Дахин оролдох
                </Button>
              }
            />
          ) : null}
          {domains.data && activeDomains.length === 0 ? (
            <EmptyState title="Хөгжлийн чиглэл тохируулаагүй байна" />
          ) : null}

          {domains.data && activeDomains.length > 0 ? (
            <div className="flex flex-col gap-4">
              <Card pad="roomy">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="text-lead font-semibold text-ink">Цэцэрлэгийн дундаж</h3>
                    <p className="mt-0.5 text-caption text-muted">
                      Үнэлгээтэй {assessedDomainGroups.length} бүлгийн нэгтгэл
                    </p>
                  </div>
                  <Badge tone="sky">Бүх чиглэл</Badge>
                </div>
                <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
                  {overallDomains.map(({ domain, average }, index) => (
                    <BarRow
                      key={domain.id}
                      inline
                      label={domain.name}
                      labelWidth="w-[144px] xl:w-[190px]"
                      percent={average === null ? 0 : (average / 4) * 100}
                      value={average === null ? "—" : average.toFixed(1)}
                      accessibleLabel={
                        average === null
                          ? `${domain.name} — үнэлгээгүй`
                          : `${domain.name} — ${average.toFixed(1)} оноо`
                      }
                      tone={SERIES_TONES[index % SERIES_TONES.length]}
                    />
                  ))}
                </div>
              </Card>

              <div className="grid items-start gap-4 xl:grid-cols-2">
                {coverage.map((group) => {
                  const domainGroup = domainGroups.get(group.groupId);
                  const percent = coveragePercent(group);
                  return (
                    <Card key={group.groupId} pad="roomy">
                      <div className="mb-4 flex items-start justify-between gap-3 border-b border-border-soft pb-4">
                        <div className="min-w-0">
                          <h3 className="truncate text-lead font-semibold text-ink">
                            {group.name}
                          </h3>
                          <p className="mt-0.5 text-caption text-muted">
                            {domainGroup?.sampleSize ?? 0} үнэлгээ · {group.assessed}/
                            {group.children} хүүхэд
                          </p>
                        </div>
                        <Badge
                          tone={
                            percent >= GOOD_THRESHOLD
                              ? "mint"
                              : percent >= ATTENTION_THRESHOLD
                                ? "sun"
                                : "peach"
                          }
                        >
                          {group.children > 0 ? `${percent}%` : "Хүүхэдгүй"}
                        </Badge>
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {activeDomains.map((domain, index) => {
                          const average = domainGroup?.averageByDomain[domain.id];
                          return (
                            <BarRow
                              key={domain.id}
                              inline
                              label={domain.name}
                              labelWidth="w-[144px] xl:w-[190px]"
                              percent={average === undefined ? 0 : (average / 4) * 100}
                              value={average === undefined ? "—" : average.toFixed(1)}
                              accessibleLabel={
                                average === undefined
                                  ? `${group.name}, ${domain.name} — үнэлгээгүй`
                                  : `${group.name}, ${domain.name} — ${average.toFixed(1)} оноо`
                              }
                              tone={SERIES_TONES[index % SERIES_TONES.length]}
                            />
                          );
                        })}
                      </div>
                      <Link
                        href={`/groups/${group.groupId}/assessment`}
                        className="mt-4 flex items-center justify-end gap-1 border-t border-border-soft pt-3 text-caption font-semibold text-primary hover:underline"
                      >
                        Дэлгэрэнгүй үнэлгээ
                        <ChevronRight size={16} aria-hidden />
                      </Link>
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        {coverage.length > 0 ? (
          <section aria-label="Бүлгүүдийн эрэмбэ" className="grid items-start gap-4 xl:grid-cols-2">
            <Card pad="compact">
              <div className="mb-2 flex items-center gap-2">
                <CircleAlert size={20} className="text-peach-ink" aria-hidden />
                <h2 className="text-lead font-semibold text-ink">Анхаарах бүлгүүд</h2>
                <Badge tone="peach" className="ml-auto">
                  {groupsNeedingAttention.length}
                </Badge>
              </div>
              {groupsNeedingAttention.length ? (
                <div className="divide-y divide-border-soft">
                  {groupsNeedingAttention.map((group, index) => (
                    <RankedGroupRow key={group.groupId} group={group} rank={index + 1} />
                  ))}
                </div>
              ) : (
                <p className="py-5 text-body text-muted">
                  Бүх бүлгийн гүйцэтгэл 95%-аас дээш байна.
                </p>
              )}
            </Card>

            <Card pad="compact">
              <div className="mb-2 flex items-center gap-2">
                <ClipboardCheck size={20} className="text-mint-ink" aria-hidden />
                <h2 className="text-lead font-semibold text-ink">Шилдэг бүлгүүд</h2>
                <Badge tone="mint" className="ml-auto">
                  {leadingGroups.length}
                </Badge>
              </div>
              {leadingGroups.length ? (
                <div className="divide-y divide-border-soft">
                  {leadingGroups.map((group, index) => (
                    <RankedGroupRow key={group.groupId} group={group} rank={index + 1} />
                  ))}
                </div>
              ) : (
                <p className="py-5 text-body text-muted">95%-д хүрсэн бүлэг одоогоор алга байна.</p>
              )}
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
