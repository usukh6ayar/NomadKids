"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
import { z } from "zod";
import { SURVEY_KIND_LABEL, surveySchema, type SurveyKind } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { FamilySurveyCard, surveyDate } from "@/components/survey/family-survey-card";

const activeSurveysSchema = z.array(surveySchema);

/**
 * Only the one field this screen needs off the child.
 *
 * ★ Narrow on purpose. `childDetailSchema` parses guardianships and enrolments
 * a survey list has no use for, and the age filter needs exactly one date.
 * The key is `qk.child`, so this still reads whatever the shell already
 * fetched rather than adding a request of its own.
 */
const childBirthSchema = z.object({ dateOfBirth: z.string().nullish() });

/**
 * A guardian's own surveys for one child — the "Судалгаа" tile's permanent
 * landing page.
 *
 * ★ Reads the same `/children/:id/surveys` endpoint `SurveyPrompt` (`/home`)
 * and the response screen (`[surveyId]/page.tsx`) already use — this is the
 * one endpoint a parent may call for surveys, so a list page finds its rows
 * there rather than adding a second read path. The API scopes it to what
 * this guardian may see.
 *
 * ★★ REDESIGN 2026-09-13, at the client's request: "асуулга ба судалгаа хэт
 * эрээн мяраан байна, энгийн минимал орчин үеийн харагд. мөн хариулсан
 * хариултууд харагддаг баймаар байна. дээд хэсэгт хайлт шүүлтүүр товч 2 нэмээд
 * нас болон төрөлөөр хайдаг болго."
 *
 * Three changes, and nothing outside this screen:
 *
 * 1. **The row is a title and a word.** It carried a tinted category tile with
 *    an icon in it, a filled category badge and a filled state badge — three
 *    blocks of colour on a row whose content is one sentence. What is left is
 *    the title, the state as a coloured word, and one grey line of facts.
 * 2. **An answered survey opens.** It used to be a dead row: the screen could
 *    say *that* a family had replied and never *what* they said, because the
 *    payload carried a boolean. `myAnswers` now comes back with it
 *    (`SurveysService.listActiveForChild`), so the row expands into the
 *    questionnaire with this family's own answers against it.
 * 3. **Search and filter, behind two buttons.** A family that has been here
 *    three years has a list, not a page — and neither control earns permanent
 *    space on a phone before it is asked for.
 *
 * ★★★ "Нас" is the age the child was when the survey ran, computed here from
 * `dateOfBirth` and the survey's own date. A survey carries no age of its own
 * — there is no column and nothing to migrate — and this is the scale the rest
 * of the portfolio already organises a child's history by (the 2–5 нас
 * folders). Only the ages the list actually contains become chips, so a child
 * in their first year sees one.
 */
export default function ChildSurveysPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [age, setAge] = useState<number | null>(null);
  const [kind, setKind] = useState<SurveyKind | null>(null);
  /** Which answered survey is showing its answers. One at a time. */

  const surveys = useQuery({
    queryKey: qk.childSurveys(childId),
    queryFn: () => get(`/children/${childId}/surveys`, activeSurveysSchema),
  });

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childBirthSchema),
  });

  const dateOfBirth = child.data?.dateOfBirth;

  /** Each survey with the age the child was on its own date, where known. */
  const rows = useMemo(
    () =>
      (surveys.data ?? []).map((survey) => ({
        survey,
        ageThen: ageOn(dateOfBirth, surveyDate(survey)),
      })),
    [surveys.data, dateOfBirth],
  );

  /* Only the ages present, ascending — a chip for an empty year is a dead end. */
  const ages = useMemo(
    () =>
      [
        ...new Set(
          rows.map((row) => row.ageThen).filter((years): years is number => years !== null),
        ),
      ].sort((a, b) => a - b),
    [rows],
  );

  const needle = search.trim().toLocaleLowerCase("mn-MN");
  const visible = rows.filter(({ survey, ageThen }) => {
    if (kind && survey.kind !== kind) return false;
    if (age !== null && ageThen !== age) return false;
    if (!needle) return true;
    return `${survey.title} ${survey.description ?? ""}`
      .toLocaleLowerCase("mn-MN")
      .includes(needle);
  });

  const activeFilters = (kind ? 1 : 0) + (age !== null ? 1 : 0);

  const header = (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <PageHeader title="Миний судалгаанууд" />
      </div>

      {/*
        Two buttons, not two permanent controls — the client's own shape. The
        search box and the chips each cost a phone row that a family arriving
        to read one survey never needed; the count says when a filter is on.
      */}
      <Button
        type="button"
        variant={searchOpen ? "primary" : "secondary"}
        size="icon"
        aria-expanded={searchOpen}
        aria-controls="survey-search"
        aria-label="Хайх"
        className="shrink-0"
        onClick={() => setSearchOpen(!searchOpen)}
      >
        <Search aria-hidden="true" />
      </Button>

      <Button
        type="button"
        variant={filtersOpen ? "primary" : "secondary"}
        size="icon"
        aria-expanded={filtersOpen}
        aria-controls="survey-filters"
        aria-label="Шүүлтүүр"
        className="relative shrink-0"
        onClick={() => setFiltersOpen(!filtersOpen)}
      >
        <SlidersHorizontal aria-hidden="true" />
        {activeFilters > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-pill bg-primary px-1 text-compact font-bold text-white">
            {activeFilters}
            <span className="sr-only">шүүлтүүр идэвхтэй</span>
          </span>
        ) : null}
      </Button>
    </div>
  );

  const controls = (
    <>
      <div id="survey-search" hidden={!searchOpen}>
        <label className="sr-only" htmlFor="survey-search-input">
          Судалгааны нэрээр хайх
        </label>
        <Input
          id="survey-search-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Судалгааны нэрээр хайх"
        />
      </div>

      <div
        id="survey-filters"
        hidden={!filtersOpen}
        className={cn(
          "rounded-card border border-border bg-surface p-3",
          filtersOpen && "flex flex-col gap-3",
        )}
      >
        {/*
          Two rows, because they are two questions. A single chip row mixing
          "3 нас" with "Асуулга" would read as one set of alternatives and
          behave as two — the same note the staff board's own filter carries.
        */}
        <FilterChipRow label="Төрлөөр шүүх" scroll>
          <FilterChip active={kind === null} onClick={() => setKind(null)}>
            Бүгд
          </FilterChip>
          {(["FORM", "POLL"] as const).map((option) => (
            <FilterChip key={option} active={kind === option} onClick={() => setKind(option)}>
              {SURVEY_KIND_LABEL[option]}
            </FilterChip>
          ))}
        </FilterChipRow>

        {ages.length > 0 ? (
          <FilterChipRow label="Насаар шүүх" scroll>
            <FilterChip active={age === null} onClick={() => setAge(null)}>
              Бүгд
            </FilterChip>
            {ages.map((years) => (
              <FilterChip key={years} active={age === years} onClick={() => setAge(years)}>
                {years} нас
              </FilterChip>
            ))}
          </FilterChipRow>
        ) : null}
      </div>
    </>
  );

  if (surveys.isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        {header}
        <LoadingState rows={3} />
      </div>
    );
  }

  if (surveys.isError) {
    return (
      <div className="flex flex-col gap-4 py-2">
        {header}
        <ErrorState description={errorMessage(surveys.error)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {header}
      {controls}

      {rows.length === 0 ? (
        <EmptyState
          title="Идэвхтэй судалгаа алга"
          description="Цэцэрлэгээс судалгаа явуулахад энд харагдана."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Хайлтад тохирох судалгаа алга"
          description="Хайлтын үг эсвэл шүүлтүүрээ өөрчилж үзээрэй."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map(({ survey, ageThen }) => (
            <li key={survey.id}>
              <FamilySurveyCard childId={childId} survey={survey} ageThen={ageThen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * How old the child was on `on` — whole years.
 *
 * ★ Not `ageInYears`, which answers "how old are they now".
 *
 * The filter asks how old they were when the survey ran, so the comparison
 * date is the survey's and not today's. The same day-of-month correction
 * `monthsSinceBirth` makes, for the same reason: without it a survey run the
 * week before a birthday is filed under the age the child had not reached yet.
 */
function ageOn(dateOfBirth: string | null | undefined, on: string): number | null {
  if (!dateOfBirth) return null;

  const dob = new Date(dateOfBirth);
  const at = new Date(on);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(at.getTime())) return null;

  let years = at.getFullYear() - dob.getFullYear();
  const monthDiff = at.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < dob.getDate())) years -= 1;

  return years < 0 ? null : years;
}
