"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronDown, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { z } from "zod";
import {
  SURVEY_KIND_LABEL,
  pollTallySchema,
  surveySchema,
  type SurveyKind,
  type SurveyQuestion,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PollResult } from "@/components/survey/poll-answer";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

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

type Survey = z.infer<typeof surveySchema>;

/** Хариулсан · Хариулаагүй · Хаагдсан, as a word rather than a filled pill. */
const STATE_TEXT = {
  answered: "text-mint-ink",
  open: "text-primary",
  closed: "text-muted",
} as const;

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
  const [openId, setOpenId] = useState<string | null>(null);

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
              <SurveyRow
                childId={childId}
                survey={survey}
                ageThen={ageThen}
                open={openId === survey.id}
                onToggle={() => setOpenId(openId === survey.id ? null : survey.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One survey, as a family reads it.
 *
 * ★ Still open and unanswered → the whole row is the link into the form. Any
 * other state is not a link, and that has not changed: there is nothing to
 * answer. What is new is that an answered one **opens** instead of sitting
 * inert, which is the difference between a list that reports and a list that
 * can be read back.
 */
function SurveyRow({
  childId,
  survey,
  ageThen,
  open,
  onToggle,
}: {
  childId: string;
  survey: Survey;
  ageThen: number | null;
  open: boolean;
  onToggle: () => void;
}) {
  const answered = Boolean(survey.respondedByMe);
  const answerable = !answered && survey.status !== "CLOSED";
  const state = answered ? "answered" : answerable ? "open" : "closed";
  const stateLabel = answered ? "Хариулсан" : answerable ? "Хариулаагүй" : "Хаагдсан";

  /*
    One grey line of facts, in the order a parent scans them: which kind it is,
    how many questions, when it ran, and how old they were. The age is the same
    number the filter above offers, so a chip and a row cannot disagree.
  */
  const facts = [
    SURVEY_KIND_LABEL[survey.kind],
    survey.questions.length > 0 ? `${survey.questions.length} асуулт` : null,
    formatDate(surveyDate(survey)),
    ageThen === null ? null : `${ageThen} нас`,
  ].filter(Boolean);

  const head = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug text-ink">{survey.title}</span>
        <span className="mt-1 block text-caption text-muted">{facts.join(" · ")}</span>
      </span>
      <span className={cn("shrink-0 text-caption font-semibold", STATE_TEXT[state])}>
        {stateLabel}
      </span>
    </>
  );

  if (answerable) {
    return (
      <Card pad="none" className="transition-colors hover:border-primary" data-testid="survey-row">
        <Link
          href={`/children/${childId}/surveys/${survey.id}`}
          className="flex items-center gap-3 px-4 py-3.5"
        >
          {head}
          <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-faint" />
        </Link>
      </Card>
    );
  }

  if (!answered) {
    return (
      <Card pad="none" data-testid="survey-row">
        <div className="flex items-center gap-3 px-4 py-3.5">{head}</div>
      </Card>
    );
  }

  const panelId = `survey-answers-${survey.id}`;
  return (
    <Card pad="none" data-testid="survey-row">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-canvas"
      >
        {head}
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div id={panelId} className="border-t border-border-soft px-4 py-3.5">
          {survey.kind === "POLL" ? (
            <PollShares childId={childId} survey={survey} />
          ) : (
            <MyAnswers survey={survey} />
          )}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * An answered асуулга: what everyone chose, and which one was theirs.
 *
 * ★ 2026-09-13, at the client's request: "бусад хүмүүсийн хариулсан хувь болон
 * өөрийн хариулт харагд."
 *
 * `PollResult` is the same component the voting screen draws its bars with —
 * imported rather than rebuilt, because a second renderer over the same
 * payload is how one surface comes to say 62% while the other says 63%.
 *
 * ★★ Only a poll, and that is the API's decision rather than this screen's.
 *
 * `/children/:id/surveys/:id/tally` answers a poll and 404s a questionnaire:
 * a poll's running count is what a poll *is* ("эцэг эх дарахаар шууд хувь
 * үзүүлэлт нь харагдана"), while a form's aggregate is the teacher's and
 * answering "that exists but is not yours" would confirm it (§1.7). A form
 * therefore shows the family's own answers and no shares.
 *
 * ★★★ Fetched only while the row is open. A family with a dozen answered polls
 * would otherwise fire a dozen requests for panels nobody has expanded — the
 * same rule `SurveyParticipation` states for its own panel.
 */
function PollShares({ childId, survey }: { childId: string; survey: Survey }) {
  const tally = useQuery({
    queryKey: qk.childSurveyTally(childId, survey.id),
    queryFn: () => get(`/children/${childId}/surveys/${survey.id}/tally`, pollTallySchema),
  });

  if (tally.isPending) return <LoadingState rows={3} />;
  /*
    A tally this family may not read is not an error worth a red panel — their
    own answers are still worth showing, and that is what the fallback is.
  */
  if (tally.isError) return <MyAnswers survey={survey} />;

  const data = tally.data!;
  if (data.questions.length === 0) return <p className="text-body text-muted">Асуулт алга.</p>;

  return (
    <div className="flex flex-col gap-3">
      {data.questions.map((question, index) => (
        <div key={question.questionId} className="flex flex-col gap-1.5">
          <p className="text-caption leading-snug text-muted">
            {index + 1}. {question.prompt}
          </p>
          <PollResult question={question} />
          <p className="text-caption text-muted">{question.totalResponses} хүн хариулсан</p>
        </div>
      ))}
    </div>
  );
}

/**
 * What this family answered, question by question.
 *
 * ★ Every question, including the ones they left blank — a questionnaire read
 * back with its unanswered rows silently dropped is a different questionnaire,
 * and "Хариулаагүй" is the useful thing to see against one.
 *
 * ★★ An anonymous survey is not an exception. Anonymity is a promise to the
 * *other* families — the aggregate stays the teacher's either way — and these
 * rows are the reader's own, keyed on their own user id by the API.
 */
function MyAnswers({ survey }: { survey: Survey }) {
  const byQuestion = new Map((survey.myAnswers ?? []).map((row) => [row.questionId, row.value]));

  if (survey.questions.length === 0) {
    return <p className="text-body text-muted">Асуулт алга.</p>;
  }

  return (
    <dl className="flex flex-col gap-3">
      {survey.questions.map((question, index) => (
        <div key={question.id} className="flex flex-col gap-1">
          <dt className="text-caption leading-snug text-muted">
            {index + 1}. {question.prompt}
          </dt>
          <dd className="text-body leading-snug text-ink">
            {answerText(question, byQuestion.get(question.id))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One answer as a sentence fragment.
 *
 * ★ A rating reads "4 / 5" rather than a word.
 *
 * The teacher's analysis screen names the bands ("Маш сайн") because it is
 * comparing distributions; a family reading their own answer back wants the
 * thing they actually chose. Keeping the score here also keeps this screen out
 * of a vocabulary it would then have to stay in step with — the kind of
 * hand-copied list `CLAUDE.md` §7 records going wrong in four places at once.
 */
function answerText(question: SurveyQuestion, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Хариулаагүй";
  if (Array.isArray(value))
    return value.length === 0 ? "Хариулаагүй" : value.map(String).join(", ");

  if (question.type === "RATING") return `${String(value)} / 5`;
  if (question.type === "YES_NO") return value === true || value === "true" ? "Тийм" : "Үгүй";

  /* MATRIX answers with a score per indicator — "Хэл яриа: 4" a line each. */
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([row, score]) => `${row}: ${String(score)}`)
      .join(" · ");
  }

  return String(value);
}

/** The date a survey is filed under — closed, else published, else created. */
function surveyDate(survey: Survey): string {
  return survey.closedAt ?? survey.publishedAt ?? survey.createdAt;
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
