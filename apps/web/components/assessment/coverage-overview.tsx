"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import { groupCoverageSchema, type GroupCoverage } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Card, SectionHeader } from "@/components/ui/card";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { BarRow } from "@/components/ui/chart/bar-row";
import { Ring } from "@/components/ui/chart/ring";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Явцын үнэлгээ — how far this group's assessment work has got.
 *
 * ★ The client's 2026-09-10 design, and the question it answers is "what is
 * left", not "how did the children do".
 *
 * Nothing here reports a level for a child. That is the same rule the column
 * editor's `domainId` requirement protects — the assessment scope excludes a
 * children × domains matrix — and it is why this screen can show every domain
 * at once when the editor deliberately cannot.
 *
 * ★★ Four breakdowns of one dataset, behind chips rather than four routes.
 *
 * The design draws them as four rows leading to four screens. They arrive in
 * one payload and every one of them is the same shape — a list of bars against
 * the same roster — so four routes would be the same component mounted four
 * times, with three of them a navigation away from the numbers they are being
 * compared against. Chips keep the headline on screen while the breakdown
 * under it changes.
 *
 * ★★★ No "Үнэлгээ нэмэх" button, at the client's explicit instruction
 * ("зурагны доор байгаа үнэлгээ нэмэх гэсэн 3 цэнхэр товч тэд оррохгүй"). The
 * Үнэлэх tab beside this one is where assessing happens.
 */
export function CoverageOverview({ groupId, termId }: { groupId: string; termId: string }) {
  const [view, setView] = useState<"domains" | "types" | "activities" | "months">("domains");

  const coverage = useQuery({
    queryKey: qk.groupCoverage(groupId, termId),
    queryFn: () =>
      get(`/groups/${groupId}/assessments/coverage?termId=${termId}`, groupCoverageSchema),
    enabled: Boolean(groupId && termId),
  });

  if (!termId) {
    return (
      <EmptyState
        title="Улирал сонгоно уу"
        description="Улирал сонгосны дараа тухайн улирлын явц харагдана."
      />
    );
  }

  if (coverage.isLoading) return <LoadingState rows={4} />;
  if (coverage.isError) return <ErrorState description={errorMessage(coverage.error)} />;

  const data = coverage.data!;
  const remaining = Math.max(0, data.roster - data.assessedChildren);
  const percent = data.roster === 0 ? 0 : Math.round((data.assessedChildren / data.roster) * 100);

  const VIEWS = [
    { key: "domains" as const, label: "Чиглэл", count: data.domains.length },
    { key: "types" as const, label: "Тэмдэглэлийн төрөл", count: data.types.length },
    { key: "activities" as const, label: "Үйл ажиллагаа", count: data.activities.length },
    { key: "months" as const, label: "Сар", count: data.months.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/*
        ★ The headline is the count of children, with the share beside it.

        `register-progress.tsx` records why: "all registered" is a state a
        teacher cannot compare with the children in front of them, and a number
        is. The ring carries the percentage because it is the one figure here
        that means something as a proportion.
      */}
      <Card pad="roomy" className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-caption text-muted">Хүүхэд бүрийн үнэлгээний хамралт</p>
          <p className="mt-0.5 text-title font-semibold leading-none text-ink">
            <span className="tabular-nums">{data.assessedChildren}</span>
            <span className="text-body font-normal text-muted"> / {data.roster}</span>
          </p>
          <p className="mt-1.5 text-caption text-muted">
            {data.roster === 0
              ? "Бүлэгт идэвхтэй хүүхэд алга."
              : remaining === 0
                ? `${data.term.name}-ын үнэлгээ бүрэн хийгдсэн байна.`
                : `${remaining} хүүхдийн үнэлгээ үлдсэн байна.`}
          </p>
        </div>

        <Ring
          percent={percent}
          muted={data.roster === 0}
          size="md"
          label={
            data.roster === 0
              ? "Хамралт тодорхойгүй"
              : `${data.roster} хүүхдээс ${data.assessedChildren} нь үнэлгээтэй`
          }
        />
      </Card>

      <section aria-labelledby="coverage-summary" className="flex flex-col gap-2.5">
        <SectionHeader id="coverage-summary" title="Үндсэн тойм" as="h3" />

        <dl className="grid grid-cols-2 gap-3">
          <Tile label="Нийт хүүхэд" value={data.roster} />
          <Tile
            label="Үнэлгээтэй"
            value={data.assessedChildren}
            hint={data.roster === 0 ? undefined : `${percent}%`}
            tone="mint"
          />
          <Tile
            label="Үлдсэн"
            value={remaining}
            hint={data.roster === 0 ? undefined : `${100 - percent}%`}
            tone="peach"
          />
          {/*
            ★ "Нийт үзүүлэлт" is assessment rows, not children.

            A child assessed in four domains is four entries and one child, and
            the two numbers answer different questions: how much work exists,
            and how many families it covers. Labelled so they cannot be read as
            the same figure disagreeing with itself.
          */}
          <Tile label="Нийт үзүүлэлт" value={data.totalEntries} tone="sky" />
        </dl>
      </section>

      <section aria-labelledby="coverage-breakdown" className="flex flex-col gap-2.5">
        <SectionHeader id="coverage-breakdown" title="Дэлгэрэнгүй" as="h3" />

        <FilterChipRow label="Ямар байдлаар задлах" scroll>
          {VIEWS.map((entry) => (
            <FilterChip
              key={entry.key}
              active={view === entry.key}
              onClick={() => setView(entry.key)}
            >
              {entry.label}
            </FilterChip>
          ))}
        </FilterChipRow>

        <Card pad="roomy" className="flex flex-col gap-2.5">
          <Breakdown data={data} view={view} />
        </Card>
      </section>

      {/*
        ★ The hint is computed, and absent when there is nothing to say.

        The client's mock reads "Үлдсэн 4 хүүхдийн үнэлгээг энэ долоо хоногт
        хийж дуусгаарай" — a sentence about this group's actual state, so a
        fixed caption would keep saying it under a finished register.
      */}
      {remaining > 0 && data.roster > 0 ? (
        <Card pad="roomy" tone="sun" className="flex items-start gap-2.5">
          <Lightbulb size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-ink" />
          <p className="text-body leading-snug text-ink">
            Үлдсэн {remaining} хүүхдийн үнэлгээг {data.term.name}-д багтаан хийж дуусгаарай.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * One breakdown, drawn as bars against the roster.
 *
 * ★ The denominator is the roster in every view, including months and
 * activities.
 *
 * "4 / 9" means four of this group's children have something recorded for that
 * month, that domain, that activity. Counting rows instead would let one child
 * with six notes read as coverage of six, which is the one reading that would
 * make a thin month look finished.
 */
function Breakdown({
  data,
  view,
}: {
  data: GroupCoverage;
  view: "domains" | "types" | "activities" | "months";
}) {
  const rows =
    view === "domains"
      ? data.domains.map((row) => ({ key: row.id, label: row.name, assessed: row.assessed }))
      : view === "types"
        ? data.types.map((row) => ({ key: row.id, label: row.name, assessed: row.assessed }))
        : view === "activities"
          ? data.activities.map((row) => ({
              key: row.name,
              label: row.name,
              assessed: row.assessed,
            }))
          : data.months.map((row) => ({
              key: row.month,
              label: formatMonthLabel(row.month),
              assessed: row.assessed,
            }));

  if (rows.length === 0) {
    return (
      <p className="text-body text-muted">
        {view === "activities"
          ? "Үйл ажиллагааны нэр бүхий тэмдэглэл хараахан алга."
          : "Энэ улиралд тэмдэглэл хараахан алга."}
      </p>
    );
  }

  const empty = rows.filter((row) => row.assessed === 0).length;

  return (
    <>
      {rows.map((row) => {
        const percent = data.roster === 0 ? 0 : Math.round((row.assessed / data.roster) * 100);

        return (
          <BarRow
            key={row.key}
            inline
            labelWidth="w-[140px] md:w-[180px]"
            label={row.label}
            percent={percent}
            value={
              <span className="tabular-nums">
                {row.assessed} / {data.roster}
                <span className="ms-1 text-muted">({percent}%)</span>
              </span>
            }
            tone={row.assessed === 0 ? "peach" : "sky"}
            accessibleLabel={`${row.label}: ${data.roster} хүүхдээс ${row.assessed}`}
          />
        );
      })}

      {/*
        ★ The count of empty rows, stated.

        It is the one number a teacher acts on and it is otherwise something
        they have to count by eye down a list of bars. The client's own design
        prints it ("Үнэлгээ оруулаагүй үйл ажиллагаа 7 байна").
      */}
      {empty > 0 ? (
        <p className="mt-1 text-caption text-muted">Хараахан эхлээгүй {empty} мөр байна.</p>
      ) : null}
    </>
  );
}

/** One figure of Үндсэн тойм. */
function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "mint" | "peach" | "sky";
}) {
  return (
    <Card
      pad="compact"
      tone={tone}
      className={cn("flex flex-col justify-between gap-1", tone ? undefined : "bg-sunken")}
    >
      <dt className="text-caption leading-snug text-muted">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="text-title font-semibold tabular-nums leading-none text-ink">{value}</span>
        {hint ? <span className="text-caption tabular-nums text-muted">{hint}</span> : null}
      </dd>
    </Card>
  );
}
