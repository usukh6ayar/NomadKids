"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { errorMessage } from "@/lib/api/errors";
import {
  CoveragePanel,
  MonthlyCoverage,
  observationTypeIcon,
  useCoverageRows,
} from "./group-coverage";
import type { Tone } from "@/components/ui/tone";

export type CoverageKind = "types" | "domains" | "activities" | "months";

/**
 * One breakdown, on a screen of its own — 2026-09-10, at the client's request.
 *
 * ★ Four routes over one component, and over the panels the summary already
 * had.
 *
 * The three panels used to sit side by side under the summary, which on a
 * phone is most of a scroll before the register itself. They are pages now;
 * what they draw is unchanged, because it was already the client's design —
 * the seven strands, the thirteen daily activities, the three kinds of note.
 *
 * ★★ They share the summary's query key, so arriving is a render rather than a
 * request and a count here cannot disagree with the one just pressed.
 *
 * ★★★ No "Үнэлгээ нэмэх" button, at the client's explicit instruction.
 */
const KINDS: Record<CoverageKind, { title: string; lede: string; noun: string; tone: Tone }> = {
  types: {
    title: "Тэмдэглэлийн төрлийн бүрдэлт",
    lede: "3 төрлийн тэмдэглэлийг тэнцвэртэй хөтөлж буй эсэхийг харуулна.",
    noun: "төрөл",
    tone: "mint",
  },
  domains: {
    title: "Сургалтын чиглэлийн хамралт",
    lede: "СӨБ-ын 7 чиглэлд хэрхэн үнэлсэн байна.",
    noun: "чиглэл",
    tone: "sky",
  },
  activities: {
    title: "Үйл ажиллагааны төрөл",
    lede: "Үйл ажиллагааны төрөл бүрийн тэмдэглэлийн хамралтыг харуулна.",
    noun: "үйл ажиллагаа",
    tone: "sun",
  },
  months: {
    title: "Сарын тэмдэглэлийн хамралт",
    lede: "Сар бүр хичнээн хүүхдэд тэмдэглэл хөтөлснийг харуулна.",
    noun: "сар",
    tone: "sky",
  },
};

export function CoverageDetail({
  groupId,
  kind,
  startsOn,
  endsOn,
}: {
  groupId: string;
  kind: CoverageKind;
  startsOn?: string | null;
  endsOn?: string | null;
}) {
  const searchParams = useSearchParams();
  const termId = searchParams.get("termId");
  const back = `/groups/${groupId}/assessment${termId ? `?termId=${termId}` : ""}`;

  /** Бүгд / Үнэлгээтэй / Үлдсэн — the client's filter on the activity screen. */
  const [filter, setFilter] = useState<"all" | "done" | "left">("all");

  const { stats, typeRows, domainRows, activityRows, months } = useCoverageRows({
    groupId,
    startsOn,
    endsOn,
  });

  const meta = KINDS[kind];

  const header = (
    <div className="flex items-start gap-2">
      <Button asChild variant="ghost" size="icon" aria-label="Буцах">
        <Link href={back}>
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
      </Button>
      <div className="min-w-0 flex-1 pt-1.5">
        <h1 className="text-title font-semibold leading-heading text-ink">{meta.title}</h1>
        <p className="mt-0.5 text-caption leading-snug text-muted">{meta.lede}</p>
      </div>
    </div>
  );

  if (stats.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <LoadingState rows={6} />
      </div>
    );
  }

  if (stats.isError) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ErrorState description={errorMessage(stats.error)} />
      </div>
    );
  }

  /*
    ★ The month chart is a chart, not a list of bars, so it keeps its own
    component rather than being bent into `CoveragePanel`.

    Nine months across is read as a shape — "it tailed off after February" —
    which is exactly what a column chart is for and what a stack of horizontal
    bars is not.
  */
  if (kind === "months") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <MonthlyCoverage months={months} />
      </div>
    );
  }

  const rows = kind === "types" ? typeRows : kind === "domains" ? domainRows : activityRows;
  const done = rows.filter((row) => row.count > 0);
  const left = rows.filter((row) => row.count === 0);
  const shown = filter === "done" ? done : filter === "left" ? left : rows;

  return (
    <div className="flex flex-col gap-4">
      {header}

      {/*
        ★ Offered only when both piles exist.

        A chip row where one option matches everything and another matches
        nothing is three presses that all show the same list — the rule
        `GroupSwitcher` and `Pagination` are both held to.
      */}
      {done.length > 0 && left.length > 0 ? (
        <FilterChipRow label="Байдлаар шүүх">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            Бүгд ({rows.length})
          </FilterChip>
          <FilterChip active={filter === "done"} onClick={() => setFilter("done")}>
            Үнэлгээтэй ({done.length})
          </FilterChip>
          <FilterChip active={filter === "left"} onClick={() => setFilter("left")}>
            Үлдсэн ({left.length})
          </FilterChip>
        </FilterChipRow>
      ) : null}

      <CoveragePanel
        title={meta.title}
        rows={shown}
        tone={meta.tone}
        iconFor={kind === "types" ? observationTypeIcon : undefined}
        dashWhenZero={kind === "activities"}
        footer={`Нийт ${rows.length} ${meta.noun}.`}
      />

      {/*
        ★ The count of untouched rows, stated rather than left to be counted by
        eye — the client's own design prints it.
      */}
      {left.length > 0 ? (
        <Card pad="roomy" tone="sun" className="flex items-start gap-2.5">
          <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-ink" />
          <p className="text-body leading-snug text-ink">
            Тэмдэглэл оруулаагүй {left.length} {meta.noun} байна.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
