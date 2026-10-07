"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  SURVEY_CATEGORY_LABEL,
  SURVEY_KIND_HINT,
  SURVEY_KIND_LABEL,
  SURVEY_RESPONDENT_LABEL,
  SURVEY_PERIOD_LABEL,
  SURVEY_PERIOD_OTHER_LABEL,
  SURVEY_QUESTION_TYPE_LABEL,
  groupListItemSchema,
  hasOptionList,
  paginated,
  surveyCategorySchema,
  surveyPeriodSchema,
  surveySchema,
  termSchema,
  type SurveyCategory,
  type SurveyKind,
  type SurveyRespondent,
  type SurveyPeriod,
  type SurveyQuestionType,
  localDate,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { A79_LEVELS, a79Questions } from "@/lib/a79-assessment";
import { PARENT_SURVEY_TEMPLATES } from "@/lib/parent-survey-templates";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";
import { groupLabel } from "@/lib/format";

const groupsSchema = paginated(groupListItemSchema);
const termsSchema = z.array(termSchema);
const SURVEY_CATEGORIES = surveyCategorySchema.options;
const SURVEY_PERIODS = surveyPeriodSchema.options;
const CREATE_SURVEY_FIELD_ERROR: Record<string, string> = {
  category: "Ангиллаа зөв сонгоно уу",
  period: "Үнэлгээний төрлийг зөв сонгоно уу",
};

/**
 * The question types the wizard offers.
 *
 * ★ Four, not the client's seven — and the three that are missing are missing
 * rather than greyed out.
 *
 * Their design lists Жагсаах, Огноо сонгох and Файл оруулах beside these.
 * None exists: `SurveyQuestionType` has six values and a ranking, a date and
 * an upload are each a new answer shape that `survey-scoring.ts`, the
 * answering form, the validator and the workbook would all have to learn. A
 * button that stores a type nothing can answer would produce a survey a family
 * opens and cannot finish.
 *
 * This file's own sidebar note applies: advertising a feature as present when
 * it is not is worse than its absence. They are listed in the commit message
 * as outstanding instead.
 *
 * MATRIX is left out for a different reason — it exists and works, and it is
 * configured with rows and columns that do not fit a four-step wizard. The
 * full editor at `/surveys/:id` still offers it.
 */
const WIZARD_QUESTION_TYPES: SurveyQuestionType[] = ["SINGLE_CHOICE", "CHECKBOX", "TEXT", "RATING"];

interface DraftQuestion {
  type: SurveyQuestionType;
  prompt: string;
  options: string[];
}

type SurveyTemplate = {
  title: string;
  /** Set by a template that decides it (А/79); a family template does not. */
  category?: SurveyCategory;
  questions: DraftQuestion[];
  /** The wave a template belongs to, when it has one. */
  period?: SurveyPeriod;
};

/**
 * The families' templates are the client's nine questionnaires since
 * 2026-10-06 — `lib/parent-survey-templates.ts`. The three that were here
 * (сэтгэл ханамж, хөгжил, хоол) were taken off at their request.
 */
const SURVEY_TEMPLATES: Record<string, SurveyTemplate> = PARENT_SURVEY_TEMPLATES;

/**
 * А/79 — the ministry's four-level development assessment, ready for a
 * teacher to run as Гарааны үнэлгээ. Client, 2026-09-21. Every criterion is a
 * 0/1 choice, which the teacher's sheet draws as the document's own table.
 */
const A79_TEMPLATES: Record<string, SurveyTemplate> = Object.fromEntries(
  A79_LEVELS.map((level) => [
    `a79-${level.key}`,
    {
      title: `А/79 Гарааны үнэлгээ — ${level.key} түвшин`,
      category: "OTHER",
      period: "BASELINE",
      questions: a79Questions(level),
    } satisfies SurveyTemplate,
  ]),
);

const cloneQuestions = (questions: DraftQuestion[]) =>
  questions.map((question) => ({ ...question, options: [...question.options] }));

const emptyQuestion = (type: SurveyQuestionType): DraftQuestion => ({
  type,
  prompt: "",
  options: hasOptionList(type) ? ["", ""] : [],
});

/**
 * Шинэ судалгаа / Шинэ асуулга — the client's 2026-09-10 wizard.
 *
 * ★ Steps, because the thing being built has parts that depend on each other.
 *
 * The old dialog was one form of six fields and it created a survey with no
 * questions in it — a teacher then landed on an editor to write them, which is
 * two screens for one act and the reason the client drew this. The wizard
 * collects the whole survey and saves it in one go.
 *
 * ★★ Four steps for a questionnaire, three for a poll, and the difference is
 * not cosmetic: a poll is one question and its choices, so "asked of whom" and
 * its settings collapse into a single final step. `STEPS` is derived from the
 * kind rather than branched on inside each step.
 *
 * ★★★ It ends on a DRAFT that it then publishes, in that order, because the
 * API does — `PUT /questions` is refused on a published survey (it would
 * orphan existing answers) and `publish` is refused on one with no questions.
 * Three calls, and a failure at any of them leaves the survey recoverable in
 * the Ноорог tab rather than half-made and invisible.
 */
export function CreateSurveyWizard({
  kindergartenId,
  kind,
  respondent = "GUARDIAN",
  onClose,
}: {
  kindergartenId: string;
  kind: SurveyKind;
  /**
   * Who fills it in — 2026-09-21. TEACHER is "Багшийн судалгаа": filled in by
   * the teacher for each child, so it is never anonymous and never answered
   * twice, and the two switches that would say otherwise are not offered.
   */
  respondent?: SurveyRespondent;
  onClose: () => void;
}) {
  const router = useRouter();
  const { hasRole, isLoading: sessionLoading } = useSession();
  const canAddressEveryone = hasRole("ADMIN");

  const isPoll = kind === "POLL";
  const isTeacher = respondent === "TEACHER";

  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // ── step 1 ──────────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  /** A poll's own shape question: one question, or several. */
  const [multiQuestion, setMultiQuestion] = useState(false);

  // ── audience ────────────────────────────────────────────────────────────
  const [groupId, setGroupId] = useState("");
  const [category, setCategory] = useState<SurveyCategory>(
    isPoll ? "CLASS_GROUP" : isTeacher ? "OTHER" : "PARENT_ENGAGEMENT",
  );
  const [termId, setTermId] = useState("");
  /*
    ★ All three waves and "Бусад" — 2026-09-18, at the client's request. The
    select offered only Явцын and Үр дүнгийн; Гарааны (BASELINE) is the wave
    Module 1.2's comparison starts from, so a kindergarten could not file the
    September questionnaire it compares May against.
  */
  // The default stays Явцын, as before; only the choices widened.
  const [period, setPeriod] = useState<SurveyPeriod | null>("MIDLINE");
  const [opensOn, setOpensOn] = useState("");
  const [closesOn, setClosesOn] = useState("");

  // ── questions ───────────────────────────────────────────────────────────
  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    isPoll ? [emptyQuestion("SINGLE_CHOICE")] : [],
  );

  // ── settings ────────────────────────────────────────────────────────────
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [allowMultipleResponses, setAllowMultipleResponses] = useState(false);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);

  const draftStorageKey = `nomadkids:survey-draft:${kindergartenId}:${kind}${
    isTeacher ? ":teacher" : ""
  }`;

  /* A half-written form survives closing the sheet or refreshing the browser. */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      if (typeof saved.title === "string") setTitle(saved.title);
      if (typeof saved.groupId === "string") setGroupId(saved.groupId);
      if (
        typeof saved.category === "string" &&
        SURVEY_CATEGORIES.includes(saved.category as SurveyCategory)
      ) {
        setCategory(saved.category as SurveyCategory);
      }
      if (typeof saved.opensOn === "string") setOpensOn(saved.opensOn);
      if (typeof saved.closesOn === "string") setClosesOn(saved.closesOn);
      if (saved.period === null || SURVEY_PERIODS.includes(saved.period as SurveyPeriod)) {
        setPeriod(saved.period as SurveyPeriod | null);
      }
      if (typeof saved.isAnonymous === "boolean") setIsAnonymous(saved.isAnonymous);
      if (typeof saved.allowMultipleResponses === "boolean") {
        setAllowMultipleResponses(saved.allowMultipleResponses);
      }
      if (typeof saved.shuffleQuestions === "boolean") {
        setShuffleQuestions(saved.shuffleQuestions);
      }
      if (Array.isArray(saved.questions)) {
        const restored = saved.questions.filter(
          (question): question is DraftQuestion =>
            Boolean(question) &&
            typeof question === "object" &&
            WIZARD_QUESTION_TYPES.includes(
              (question as { type?: SurveyQuestionType }).type as SurveyQuestionType,
            ) &&
            typeof (question as { prompt?: unknown }).prompt === "string" &&
            Array.isArray((question as { options?: unknown }).options),
        );
        if (restored.length > 0) setQuestions(cloneQuestions(restored));
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    } finally {
      setDraftLoaded(true);
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftLoaded || created) return;
    try {
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          title,
          groupId,
          category,
          period,
          opensOn,
          closesOn,
          questions,
          isAnonymous,
          allowMultipleResponses,
          shuffleQuestions,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // Private browsing or a full storage quota must not block survey creation.
    }
  }, [
    allowMultipleResponses,
    category,
    closesOn,
    created,
    draftLoaded,
    draftStorageKey,
    groupId,
    isAnonymous,
    opensOn,
    period,
    questions,
    shuffleQuestions,
    title,
  ]);

  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    staleTime: 60_000,
  });

  const terms = useQuery({
    queryKey: qk.terms(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/terms`, termsSchema),
    staleTime: 5 * 60_000,
  });

  /*
    ★ A teacher's audience starts on their first group.

    "" is the whole kindergarten, which is the administrator's since
    2026-09-10 — so for a teacher it is not a default, it is the one value the
    server will refuse. See `TenantAccessService.assertCanAddressAudience`.
  */
  const firstGroupId = groups.data?.items[0]?.id;
  useEffect(() => {
    if (!sessionLoading && !canAddressEveryone && !groupId && firstGroupId) {
      setGroupId(firstGroupId);
    }
  }, [sessionLoading, canAddressEveryone, groupId, firstGroupId]);

  /* The active term is metadata, not another decision for the teacher. */
  useEffect(() => {
    if (termId || !terms.data?.length) return;
    const today = localDate();
    const active =
      terms.data.find(
        (term) =>
          Boolean(term.startsOn && term.endsOn) &&
          term.startsOn!.slice(0, 10) <= today &&
          term.endsOn!.slice(0, 10) >= today,
      ) ?? terms.data.at(-1);
    if (active) setTermId(active.id);
  }, [termId, terms.data]);

  /**
   * ★ Three calls, in the order the API requires.
   *
   * Create (DRAFT) → save questions → publish. `PUT /questions` is refused on
   * a published survey because it deletes and recreates every row, which would
   * orphan existing answers; `publish` is refused on a survey with no
   * questions. So the sequence is not a style choice.
   *
   * A failure at step two or three leaves a DRAFT that the Ноорог tab lists —
   * recoverable, and the reason the wizard does not try to be atomic.
   */
  const create = useMutation({
    mutationFn: async (publish: boolean) => {
      const survey = await mutate(`/kindergartens/${kindergartenId}/surveys`, surveySchema, {
        method: "POST",
        body: {
          title: title.trim(),
          description: null,
          purpose: null,
          category,
          scope: "CHILD",
          kind,
          respondent,
          groupId: groupId || null,
          termId: termId || null,
          period,
          opensAt: opensOn ? new Date(`${opensOn}T00:00:00`).toISOString() : null,
          /*
            ★ End of the chosen day, not its midnight.

            `<input type="date">` yields `2026-09-15`, which parses as 00:00 —
            sending it raw would close the survey at the start of the day the
            teacher wrote down, and everyone answering on the 15th would be a
            day late.
          */
          closesAt: closesOn ? new Date(`${closesOn}T23:59:59`).toISOString() : null,
          isAnonymous: isTeacher ? false : isAnonymous,
          allowMultipleResponses: isTeacher ? false : allowMultipleResponses,
          shuffleQuestions,
          closingNote: null,
        },
      });

      await mutate(`/surveys/${survey.id}/questions`, z.unknown(), {
        method: "PUT",
        body: {
          questions: questions.map((question, order) => ({
            order,
            type: question.type,
            prompt: question.prompt.trim(),
            ...(hasOptionList(question.type)
              ? { options: question.options.map((o) => o.trim()).filter(Boolean) }
              : {}),
          })),
        },
      });

      if (publish) {
        await mutate(`/surveys/${survey.id}/publish`, z.unknown(), { method: "POST", body: {} });
      }

      return { id: survey.id, title: survey.title };
    },
    onSuccess: (survey) => {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // Saving succeeded; storage cleanup is best effort only.
      }
      setCreated(survey);
    },
  });

  const errors = fieldErrors(create.error);
  const localizedCreateError = Object.entries(errors)
    .map(([field, message]) => CREATE_SURVEY_FIELD_ERROR[field] ?? message)
    .join(". ");

  const questionsReady =
    questions.length > 0 &&
    questions.every(
      (q) =>
        q.prompt.trim().length > 0 &&
        (!hasOptionList(q.type) || q.options.filter((o) => o.trim()).length >= 2),
    );

  const ready =
    title.trim().length > 0 && questionsReady && (canAddressEveryone || Boolean(groupId));
  const noun = isTeacher ? SURVEY_RESPONDENT_LABEL.TEACHER : SURVEY_KIND_LABEL[kind];
  const heading = created ? `${noun} үүслээ` : `Шинэ ${noun.toLowerCase()}`;

  /*
    The А/79 levels for a teacher survey; the families' three otherwise. A flat
    list, because `Select` reads its `<option>` children directly.
  */
  const templateOptions = isTeacher
    ? A79_LEVELS.map((level) => ({
        value: `a79-${level.key}`,
        label: `А/79 хөгжлийн үнэлгээ — ${level.key} түвшин (${level.criteria.length} шалгуур)`,
      }))
    : Object.entries(PARENT_SURVEY_TEMPLATES).map(([value, template]) => ({
        value,
        label: template.label,
      }));

  const applyTemplate = (key: string) => {
    const template = SURVEY_TEMPLATES[key] ?? A79_TEMPLATES[key];
    if (!template) return;
    setTitle(template.title);
    /*
      ★ A family template leaves Ангилал and the period alone — client,
      2026-10-06: "багш өөрөө загвараа сонгоод төрлөө сонгоно". It fills the
      title, the purpose and the questions; what kind of survey it is stays
      the teacher's choice. А/79 still sets its own, being one assessment.
    */
    if (template.category) setCategory(template.category);
    if (template.period) setPeriod(template.period);
    setQuestions(cloneQuestions(template.questions));
    setPreviewing(false);
  };

  /*
    ★ × is "I am done with this one" — client, 2026-10-06: a template chosen,
    the sheet closed with ×, and the next «Шинэ судалгаа» opened on the same
    template. Any close — ×, the backdrop, Escape — drops the draft; it is
    kept only for the accident it exists for, a refresh mid-sentence.
  */
  const discardAndClose = () => {
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // Storage unavailable: there is no draft to drop.
    }
    onClose();
  };

  const backdrop = useBackdropDismiss(discardAndClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      {...backdrop}
      className="fixed inset-0 z-50 grid items-end overflow-y-auto bg-ink/50 p-0 sm:place-items-center sm:p-4"
    >
      <div className="max-h-[calc(100dvh-0.5rem)] w-full max-w-[680px] overflow-y-auto rounded-t-card border border-border bg-surface p-3.5 shadow-lg sm:max-h-[calc(100vh-2rem)] sm:rounded-card sm:p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-lead font-semibold leading-heading text-ink">
            {heading}
          </h2>
          <Button variant="ghost" size="icon" aria-label="Хаах" onClick={discardAndClose}>
            <X size={18} aria-hidden="true" />
          </Button>
        </div>

        {created ? (
          <Done
            kind={kind}
            surveyId={created.id}
            onClose={onClose}
            onOpen={() => router.push(`/surveys/${created.id}`)}
          />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !create.isPending) create.mutate(true);
            }}
          >
            <FormError
              message={create.isError ? localizedCreateError || errorMessage(create.error) : null}
            />

            {/*
              ★ Tight — client, 2026-10-06: «Бэлэн загвар» no longer takes a
              boxed panel at the head of every new survey, the period, the
              title, the audience and the category are small and unlabelled
              (their names are inside them, and on them for a screen reader),
              and the questions get the room.
            */}
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {/* Ангилал above the title — client, 2026-10-06. */}
                <label htmlFor="survey-category" className="sr-only">
                  Ангилал
                </label>
                <Select
                  id="survey-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SurveyCategory)}
                  className={cn(SMALL, "w-auto min-w-[150px] flex-1 sm:flex-none")}
                >
                  {SURVEY_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {SURVEY_CATEGORY_LABEL[value]}
                    </option>
                  ))}
                </Select>

                {!isPoll ? (
                  <>
                    <label htmlFor="survey-template" className="sr-only">
                      Бэлэн загвараас эхлэх
                    </label>
                    <Select
                      id="survey-template"
                      defaultValue=""
                      onChange={(event) => {
                        applyTemplate(event.target.value);
                        event.target.value = "";
                      }}
                      className={cn(SMALL, "w-auto min-w-[150px] flex-1 sm:flex-none")}
                    >
                      <option value="">Загвар сонгох…</option>
                      {templateOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </>
                ) : null}

                <label htmlFor="survey-period" className="sr-only">
                  Үнэлгээний төрөл
                </label>
                <Select
                  id="survey-period"
                  value={period ?? "OTHER"}
                  onChange={(event) =>
                    setPeriod(
                      event.target.value === "OTHER" ? null : (event.target.value as SurveyPeriod),
                    )
                  }
                  className={cn(SMALL, "w-auto min-w-[140px] flex-1 sm:flex-none")}
                >
                  {SURVEY_PERIODS.map((value) => (
                    <option key={value} value={value}>
                      {SURVEY_PERIOD_LABEL[value]}
                    </option>
                  ))}
                  <option value="OTHER">{SURVEY_PERIOD_OTHER_LABEL}</option>
                </Select>
              </div>

              <Field label="Гарчиг" labelHidden error={errors.title} required>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={title}
                    placeholder="Судалгааны гарчиг"
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-10"
                    autoFocus
                  />
                )}
              </Field>

              {isPoll ? (
                <fieldset>
                  <legend className="mb-1.5 text-body font-medium text-ink">Асуулгын төрөл</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { many: false, label: "Нэг асуулттай" },
                      { many: true, label: "Олон асуулттай" },
                    ].map((option) => (
                      <label
                        key={String(option.many)}
                        className={cn(
                          "cursor-pointer rounded-control border px-3 py-2 text-center text-compact font-medium",
                          multiQuestion === option.many
                            ? "border-primary bg-primary-soft text-primary"
                            : "border-border text-ink",
                        )}
                      >
                        <input
                          type="radio"
                          name="poll-shape"
                          checked={multiQuestion === option.many}
                          onChange={() => {
                            setMultiQuestion(option.many);
                            if (!option.many) setQuestions((q) => q.slice(0, 1));
                          }}
                          className="sr-only"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <Audience
                canAddressEveryone={canAddressEveryone}
                groups={groups.data?.items ?? []}
                groupId={groupId}
                onGroup={setGroupId}
              />

              <p className="pt-1 text-body font-semibold text-ink">Асуултууд</p>

              <QuestionBuilder
                questions={questions}
                onChange={setQuestions}
                allowMany={!isPoll || multiQuestion}
                fixedType={isPoll ? "SINGLE_CHOICE" : null}
              />

              {previewing && questions.length > 0 ? (
                <SurveyDraftPreview title={title} questions={questions} />
              ) : null}

              {/*
                ★ «Нэмэлт тохиргоо» — client, 2026-10-06: it opened onto
                nothing beside it (the dates appeared up by the audience), and
                on a teacher's own survey there is next to nothing in it. Gone
                there; elsewhere the dates now open inside it, under the
                button that showed them.
              */}
              {isTeacher ? null : (
                <button
                  type="button"
                  aria-expanded={showSettings}
                  onClick={() => setShowSettings((current) => !current)}
                  className="flex min-h-9 items-center gap-1 self-start text-caption font-medium text-muted hover:text-ink"
                >
                  Нэмэлт тохиргоо
                  {showSettings ? (
                    <ChevronUp size={15} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={15} aria-hidden="true" />
                  )}
                </button>
              )}

              {showSettings && !isTeacher ? (
                <div className="grid gap-x-4 rounded-card bg-canvas px-3 sm:grid-cols-2">
                  <SurveyDates
                    opensOn={opensOn}
                    onOpensOn={setOpensOn}
                    closesOn={closesOn}
                    onClosesOn={setClosesOn}
                  />
                  <Switch
                    label="Хариулт нуух"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                  />
                  <Switch
                    label="Олон удаа хариулах"
                    checked={allowMultipleResponses}
                    onChange={(e) => setAllowMultipleResponses(e.target.checked)}
                  />
                  {questions.length > 1 ? (
                    <Switch
                      label="Асуултын дарааллыг холих"
                      checked={shuffleQuestions}
                      onChange={(e) => setShuffleQuestions(e.target.checked)}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
              {questions.length > 0 ? (
                <Button
                  type="button"
                  variant={previewing ? "secondary" : "ghost"}
                  size="icon"
                  aria-label="Урьдчилан харах"
                  title="Урьдчилан харах"
                  aria-pressed={previewing}
                  onClick={() => setPreviewing((current) => !current)}
                >
                  <Eye size={18} aria-hidden="true" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={() => create.mutate(false)}
                disabled={create.isPending || !ready}
              >
                Ноорог болгох
              </Button>
              <Button type="submit" disabled={create.isPending || !ready}>
                {create.isPending ? "Хадгалж байна…" : "Үүсгэх"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Audience and dates, kept compact on the single creation screen. */
/**
 * A question card's own tools — client, 2026-10-06: the glyph small and faint
 * (13px), the press target still 40px so a thumb lands on it. The negative
 * margin keeps the bigger target from making the row taller.
 */
const TOOL = "-my-1 size-10 text-faint hover:text-ink";

/** A compact picker — 36px and caption type — for the form's secondary fields. */
const SMALL = "h-9 px-2.5 text-caption";

function Audience({
  canAddressEveryone,
  groups,
  groupId,
  onGroup,
}: {
  canAddressEveryone: boolean;
  groups: { id: string; name: string }[];
  groupId: string;
  onGroup: (next: string) => void;
}) {
  if (!canAddressEveryone) return null;
  return (
    <Field label="Хэнд" labelHidden>
      {({ id }) => (
        <Select id={id} value={groupId} onChange={(e) => onGroup(e.target.value)} className={SMALL}>
          <option value="">Бүх бүлэг</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {groupLabel(group.name)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Opening and closing days, inside «Нэмэлт тохиргоо». */
function SurveyDates({
  opensOn,
  onOpensOn,
  closesOn,
  onClosesOn,
}: {
  opensOn: string;
  onOpensOn: (next: string) => void;
  closesOn: string;
  onClosesOn: (next: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 py-2 sm:col-span-2">
      <Field label="Эхлэх огноо" hint="Хоосон бол нийтэлмэгц эхэлнэ.">
        {({ id }) => (
          <Input
            id={id}
            type="date"
            value={opensOn}
            max={closesOn || undefined}
            onChange={(e) => onOpensOn(e.target.value)}
          />
        )}
      </Field>
      <Field label="Дуусах огноо" hint="Хоосон бол гараар хаах хүртэл нээлттэй.">
        {({ id }) => (
          <Input
            id={id}
            type="date"
            value={closesOn}
            min={opensOn || undefined}
            onChange={(e) => onClosesOn(e.target.value)}
          />
        )}
      </Field>
    </div>
  );
}

/**
 * The questions themselves.
 *
 * ★ One component for both kinds, because a poll is a questionnaire with one
 * question in it.
 *
 * `fixedType` is what makes the poll's version simpler rather than different:
 * a poll's question is always a choice with options, so the type picker is not
 * drawn. Two components would be the same option editor twice, and the option
 * editor is the fiddly half.
 */
function QuestionBuilder({
  questions,
  onChange,
  allowMany,
  fixedType,
}: {
  questions: DraftQuestion[];
  onChange: (next: DraftQuestion[]) => void;
  allowMany: boolean;
  fixedType: SurveyQuestionType | null;
}) {
  const update = (index: number, patch: Partial<DraftQuestion>) =>
    onChange(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {/*
        ★ Modern and tight — client, 2026-10-06 ("дахиад зайг хас загварыг
        орчин үеийн болго"). A card is a soft panel, not a box: the number and
        the question share the first line, the answer type and the card's own
        tools share the second, and choices are marked ○ or □ the way a parent
        will see them, each on a borderless line.
      */}
      {questions.map((question, index) => {
        const many = question.type === "CHECKBOX";
        return (
          <div key={index} className="flex flex-col gap-1.5 rounded-card bg-canvas p-2.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-pill bg-primary-soft text-caption font-semibold tabular-nums text-primary"
              >
                {index + 1}
              </span>
              <Input
                aria-label={`${index + 1}-р асуултын текст`}
                aria-required="true"
                value={question.prompt}
                onChange={(e) => update(index, { prompt: e.target.value })}
                placeholder="Асуултаа оруулна уу."
                className="h-10 border-transparent bg-surface font-medium"
              />
            </div>

            <div className="flex items-center gap-1 ps-8">
              {fixedType ? (
                <span className="flex-1" />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <label
                    htmlFor={`question-type-${index}`}
                    className="shrink-0 text-caption text-muted"
                  >
                    Хариултын хэлбэр
                  </label>
                  <div className="min-w-0 max-w-[200px] flex-1">
                    <Select
                      id={`question-type-${index}`}
                      value={question.type}
                      className={cn(SMALL, "border-transparent bg-surface")}
                      onChange={(e) => {
                        const type = e.target.value as SurveyQuestionType;
                        update(index, {
                          type,
                          // Options belong to the type: keeping a choice list on a
                          // question that became free text would send the API a
                          // field it rejects.
                          options: hasOptionList(type)
                            ? question.options.length > 0
                              ? question.options
                              : ["", ""]
                            : [],
                        });
                      }}
                    >
                      {WIZARD_QUESTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {SURVEY_QUESTION_TYPE_LABEL[type]}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              )}

              {questions.length > 1 ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={TOOL}
                    aria-label={`${index + 1}-р асуултыг дээш зөөх`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={13} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={TOOL}
                    aria-label={`${index + 1}-р асуултыг доош зөөх`}
                    disabled={index === questions.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={13} aria-hidden="true" />
                  </Button>
                </>
              ) : null}
              {allowMany ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={TOOL}
                  aria-label={`${index + 1}-р асуултыг хувилах`}
                  onClick={() => {
                    const duplicate = { ...question, options: [...question.options] };
                    onChange([
                      ...questions.slice(0, index + 1),
                      duplicate,
                      ...questions.slice(index + 1),
                    ]);
                  }}
                >
                  <Copy size={13} aria-hidden="true" />
                </Button>
              ) : null}
              {questions.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(TOOL, "hover:text-danger")}
                  aria-label={`${index + 1}-р асуултыг хасах`}
                  onClick={() => onChange(questions.filter((_, i) => i !== index))}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </Button>
              ) : null}
            </div>

            {hasOptionList(question.type) ? (
              <fieldset className="flex flex-col ps-8">
                <legend className="sr-only">Сонголтууд</legend>
                {question.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="group flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 border-2 border-faint",
                        many ? "rounded" : "rounded-pill",
                      )}
                    />
                    <Input
                      className="h-9 border-transparent bg-transparent px-1.5 hover:border-border focus:border-primary focus:bg-surface"
                      aria-label={`${optionIndex + 1}-р сонголт`}
                      value={option}
                      onChange={(e) =>
                        update(index, {
                          options: question.options.map((o, i) =>
                            i === optionIndex ? e.target.value : o,
                          ),
                        })
                      }
                      placeholder={`Сонголт ${optionIndex + 1}`}
                    />
                    {/* Never below two: one choice is not a question. */}
                    {question.options.length > 2 ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(TOOL, "hover:text-danger")}
                        aria-label={`${optionIndex + 1}-р сонголтыг хасах`}
                        onClick={() =>
                          update(index, {
                            options: question.options.filter((_, i) => i !== optionIndex),
                          })
                        }
                      >
                        <X size={13} aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => update(index, { options: [...question.options, ""] })}
                  className="inline-flex min-h-9 items-center gap-1.5 self-start text-caption font-medium text-primary hover:text-primary-strong"
                >
                  <Plus size={15} aria-hidden="true" />
                  Сонголт нэмэх
                </button>
              </fieldset>
            ) : null}
          </div>
        );
      })}

      {allowMany ? (
        <button
          type="button"
          onClick={() => onChange([...questions, emptyQuestion(fixedType ?? "SINGLE_CHOICE")])}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-card border border-dashed border-border text-body font-medium text-primary hover:border-primary hover:bg-primary-soft"
        >
          <Plus size={16} aria-hidden="true" />
          Асуулт нэмэх
        </button>
      ) : null}
    </div>
  );
}

/** The phone-sized form a parent will see after publication. */
function SurveyDraftPreview({ title, questions }: { title: string; questions: DraftQuestion[] }) {
  return (
    <section
      aria-labelledby="survey-draft-preview-title"
      className="rounded-card border border-primary-soft bg-canvas p-3"
    >
      <div className="mx-auto flex max-w-[430px] flex-col gap-3 rounded-card bg-surface p-3 shadow-sm">
        <div>
          <p id="survey-draft-preview-title" className="text-lead font-semibold text-ink">
            {title.trim() || "Судалгааны гарчиг"}
          </p>
        </div>

        {questions.map((question, index) => (
          <div key={index} className="rounded-card border border-border bg-canvas p-3">
            <p className="mb-2 text-body font-medium leading-snug text-ink">
              {index + 1}. {question.prompt.trim() || "Асуултын текст"}
            </p>
            {hasOptionList(question.type) ? (
              <div className="flex flex-col gap-1.5">
                {question.options.map((option, optionIndex) => (
                  <span
                    key={optionIndex}
                    className="rounded-control border border-border bg-surface px-3 py-2 text-compact text-muted"
                  >
                    {question.type === "CHECKBOX" ? "□" : "○"}{" "}
                    {option.trim() || `Сонголт ${optionIndex + 1}`}
                  </span>
                ))}
              </div>
            ) : question.type === "RATING" ? (
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((score) => (
                  <span
                    key={score}
                    className="rounded-control border border-border bg-surface py-2 text-center text-caption text-muted"
                  >
                    {score}
                  </span>
                ))}
              </div>
            ) : (
              <div className="h-10 rounded-control border border-border bg-surface" />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The last screen — what was made, and the two things anybody does next.
 *
 * ★ It states which it is, published or draft, because the wizard can produce
 * either and the two behave differently. "Үүслээ" alone would leave a teacher
 * believing families can see a draft.
 */
function Done({
  kind,
  surveyId,
  onOpen,
  onClose,
}: {
  kind: SurveyKind;
  surveyId: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  const noun = SURVEY_KIND_LABEL[kind];

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <span
        aria-hidden="true"
        className="grid size-16 place-items-center rounded-pill text-mint-ink"
      >
        <Check size={30} strokeWidth={3} />
      </span>

      <div>
        <p className="text-lead font-semibold leading-heading text-ink">{noun} амжилттай үүслээ!</p>
        <p className="mt-1 text-body text-muted">{SURVEY_KIND_HINT[kind]}</p>
      </div>

      <div className="flex w-full flex-col gap-2">
        <Button size="lg" onClick={onOpen}>
          {noun}ыг харах
        </Button>
        <Button size="lg" variant="secondary" onClick={onClose}>
          Жагсаалтад буцах
        </Button>
      </div>

      <span className="sr-only" data-survey-id={surveyId} />
    </div>
  );
}
