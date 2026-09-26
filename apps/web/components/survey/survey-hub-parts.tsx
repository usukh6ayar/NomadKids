"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { SURVEY_KIND_LABEL, type SurveyKind } from "@kinder/contracts";
import { Select } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import {
  useAdministrationSurveyCounts,
  useReadsAdministrationSurveys,
} from "@/lib/administration-surveys";
import type { StaffSurvey } from "@/lib/survey-access";
import { cn } from "@/lib/utils";

/**
 * The pieces the two survey hubs share — families' (`/surveys/parents`) and
 * the teacher's own (`/surveys/teacher`).
 *
 * ★ Lifted out on 2026-09-25, when the client asked for the teacher's screen
 * "яг энэ загвараар" — the families' hub drawn the same day. Two copies of a
 * row is where one of them stops getting the fix.
 */

/** Судалгаа blue and Асуулга green — the hub's two kinds, told apart by colour. */
export const SURVEY_KIND_TEXT: Record<SurveyKind, string> = {
  FORM: "text-primary",
  POLL: "text-mint-ink",
};

/** September begins the school year; August still belongs to the previous one. */
export function schoolYearStart(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month >= 9 ? year : year - 1;
}

/** This school year and every year a survey was made in, newest first. */
export function schoolYearsOf(surveys: StaffSurvey[]): number[] {
  return [
    ...new Set([
      schoolYearStart(new Date().toISOString()),
      ...surveys.map((survey) => schoolYearStart(survey.createdAt)),
    ]),
  ].sort((a, b) => b - a);
}

/** "2026–2027 он", beside the title. */
export function SchoolYearSelect({
  years,
  value,
  onChange,
}: {
  years: number[];
  value: number;
  onChange: (year: number) => void;
}) {
  return (
    <Select
      aria-label="Хичээлийн жил"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-11 w-auto shrink-0 px-2 text-compact sm:h-12 sm:px-3.5 sm:text-body"
    >
      {years.map((year) => (
        <option key={year} value={year}>
          {year}–{year + 1} он
        </option>
      ))}
    </Select>
  );
}

/**
 * "Удирдлагын судалгаа" — the administration's surveys, for a teacher.
 * Client, 2026-09-17.
 *
 * ★ Its own card under the kinds rather than a kind beside them: this is what
 * somebody else asked, which is a different relationship to the survey, and
 * the red count is what says there is something new to look at.
 *
 * ★★ The client's 2026-09-25 drawing: the source named small and italic in
 * the corner, the count as one centred sentence, a chevron — no drawing, no
 * tag. The unread count stays; it is the one thing on the card that changes.
 */
export function AdministrationSurveysCard() {
  const { enabled } = useReadsAdministrationSurveys();
  const { unread, total } = useAdministrationSurveyCounts();
  if (!enabled) return null;

  return (
    <Link
      href="/surveys/administration"
      className="group flex flex-col gap-1 rounded-card border border-border-soft bg-surface px-3 py-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md sm:px-4"
    >
      <span className="text-body italic text-primary">Удирдлагын судалгаа</span>
      <span className="flex min-h-10 items-center gap-3">
        <span className="min-w-0 flex-1 text-center text-body leading-snug text-muted">
          Цэцэрлэгийн захиргаанаас авсан{" "}
          <span className="font-bold tabular-nums text-ink">{total}</span> судалгаа, асуулга
        </span>
        {unread > 0 ? (
          <span className="flex min-w-[24px] shrink-0 items-center justify-center rounded-pill bg-danger px-1.5 text-body font-bold leading-6 text-white">
            <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
            <span className="sr-only">{unread} шинэ судалгаа</span>
          </span>
        ) : null}
        <ChevronRight
          size={20}
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </span>
    </Link>
  );
}

/**
 * One survey in a hub's list — the client's 2026-09-25 drawing: the date in
 * the top corner, the title, a chevron, and the kind in italics underneath in
 * its own colour.
 *
 * `meta` fills the bottom-left, which the drawing leaves empty — the teacher's
 * rows put their progress there. `menu` sits where the chevron would, for a
 * row with actions of its own; it is drawn outside the link so pressing it
 * never opens the survey.
 */
export function SurveyListRow({
  survey,
  meta,
  menu,
}: {
  survey: StaffSurvey;
  meta?: ReactNode;
  menu?: ReactNode;
}) {
  return (
    <div className="group relative">
      <Link
        href={`/surveys/${survey.id}`}
        className={cn(
          "grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-card border border-border-soft bg-surface px-4 py-2 shadow-sm transition-all hover:border-primary hover:shadow-md sm:px-5",
          menu && "pe-12 sm:pe-12",
        )}
      >
        <span className="col-span-2 justify-self-end text-body tabular-nums text-muted">
          {formatDate(survey.closedAt ?? survey.publishedAt ?? survey.createdAt)}
        </span>
        <span className="min-w-0 text-lead leading-snug text-ink transition-colors group-hover:text-primary">
          {survey.title}
        </span>
        {menu ? (
          <span />
        ) : (
          <ChevronRight
            size={20}
            aria-hidden="true"
            className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
          />
        )}
        <span className="col-span-2 flex items-end justify-between gap-3">
          <span className="min-w-0">{meta}</span>
          <span className={cn("shrink-0 text-caption italic", SURVEY_KIND_TEXT[survey.kind])}>
            {SURVEY_KIND_LABEL[survey.kind]}
          </span>
        </span>
      </Link>
      {menu ? <div className="absolute right-2 top-1/2 -translate-y-1/2">{menu}</div> : null}
    </div>
  );
}

/**
 * A group as a plain row that opens its surveys — name, a count, a chevron.
 * The director's group lists on the survey screens, 2026-09-25.
 */
export function GroupLinkRow({ href, name, meta }: { href: string; name: string; meta: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-[60px] items-center gap-3 rounded-card border border-border-soft bg-surface px-4 py-2.5 shadow-sm transition-all hover:border-primary hover:shadow-md sm:px-5"
    >
      <span className="min-w-0 flex-1 truncate text-lead text-ink transition-colors group-hover:text-primary">
        {name}
      </span>
      <span className="shrink-0 text-body tabular-nums text-muted">{meta}</span>
      <ChevronRight
        size={20}
        aria-hidden="true"
        className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </Link>
  );
}
