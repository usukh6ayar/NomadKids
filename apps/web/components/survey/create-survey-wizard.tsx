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
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  SURVEY_CATEGORY_LABEL,
  SURVEY_KIND_HINT,
  SURVEY_KIND_LABEL,
  SURVEY_QUESTION_TYPE_LABEL,
  groupListItemSchema,
  hasOptionList,
  paginated,
  surveyCategorySchema,
  surveySchema,
  termSchema,
  type SurveyCategory,
  type SurveyKind,
  type SurveyPeriod,
  type SurveyQuestionType,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { cn } from "@/lib/utils";

const groupsSchema = paginated(groupListItemSchema);
const termsSchema = z.array(termSchema);
const SURVEY_CATEGORIES = surveyCategorySchema.options;

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
  category: SurveyCategory;
  questions: DraftQuestion[];
};

const SURVEY_TEMPLATES: Record<string, SurveyTemplate> = {
  satisfaction: {
    title: "Эцэг эхийн сэтгэл ханамжийн судалгаа",
    category: "SATISFACTION",
    questions: [
      {
        type: "RATING",
        prompt: "Цэцэрлэгийн орчин, цэвэр байдалд хэр сэтгэл хангалуун байна вэ?",
        options: [],
      },
      {
        type: "RATING",
        prompt: "Багштай харилцах боломжид хэр сэтгэл хангалуун байна вэ?",
        options: [],
      },
      { type: "TEXT", prompt: "Санал, хүсэлтээ бичнэ үү.", options: [] },
    ],
  },
  development: {
    title: "Хөгжлийн үнэлгээний судалгаа",
    category: "COGNITIVE_DEVELOPMENT",
    questions: [
      { type: "RATING", prompt: "Хүүхэд шинэ зүйл сурахдаа хэр идэвхтэй байна вэ?", options: [] },
      { type: "RATING", prompt: "Үе тэнгийнхэнтэйгээ хэр сайн харилцаж байна вэ?", options: [] },
      { type: "TEXT", prompt: "Сүүлийн үед гарсан ахиц дэвшлийг бичнэ үү.", options: [] },
    ],
  },
  meals: {
    title: "Хоолны чанарын судалгаа",
    category: "OTHER",
    questions: [
      { type: "RATING", prompt: "Хоолны амт, чанарт хэр сэтгэл хангалуун байна вэ?", options: [] },
      {
        type: "SINGLE_CHOICE",
        prompt: "Хүүхэд хоолоо хэр идэвхтэй иддэг вэ?",
        options: ["Сайн", "Дунд", "Муу"],
      },
      { type: "TEXT", prompt: "Хоолтой холбоотой санал, хүсэлтээ бичнэ үү.", options: [] },
    ],
  },
};

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
  onClose,
}: {
  kindergartenId: string;
  kind: SurveyKind;
  onClose: () => void;
}) {
  const router = useRouter();
  const { hasRole, isLoading: sessionLoading } = useSession();
  const canAddressEveryone = hasRole("ADMIN");

  const isPoll = kind === "POLL";

  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // ── step 1 ──────────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  /** A poll's own shape question: one question, or several. */
  const [multiQuestion, setMultiQuestion] = useState(false);

  // ── audience ────────────────────────────────────────────────────────────
  const [groupId, setGroupId] = useState("");
  const [category, setCategory] = useState<SurveyCategory>(
    isPoll ? "CLASS_GROUP" : "PARENT_ENGAGEMENT",
  );
  const [termId, setTermId] = useState("");
  const [period, setPeriod] = useState<Extract<SurveyPeriod, "MIDLINE" | "ENDLINE"> | null>(
    "MIDLINE",
  );
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

  const draftStorageKey = `nomadkids:survey-draft:${kindergartenId}:${kind}`;

  /* A half-written form survives closing the sheet or refreshing the browser. */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      if (typeof saved.title === "string") setTitle(saved.title);
      if (typeof saved.description === "string") setDescription(saved.description);
      if (typeof saved.groupId === "string") setGroupId(saved.groupId);
      if (
        typeof saved.category === "string" &&
        SURVEY_CATEGORIES.includes(saved.category as SurveyCategory)
      ) {
        setCategory(saved.category as SurveyCategory);
      }
      if (typeof saved.opensOn === "string") setOpensOn(saved.opensOn);
      if (typeof saved.closesOn === "string") setClosesOn(saved.closesOn);
      if (saved.period === "MIDLINE" || saved.period === "ENDLINE" || saved.period === null) {
        setPeriod(saved.period);
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
          description,
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
    description,
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
    const today = new Date().toISOString().slice(0, 10);
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
          description: description.trim() || null,
          purpose: null,
          category,
          scope: "CHILD",
          kind,
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
          isAnonymous,
          allowMultipleResponses,
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

  const questionsReady =
    questions.length > 0 &&
    questions.every(
      (q) =>
        q.prompt.trim().length > 0 &&
        (!hasOptionList(q.type) || q.options.filter((o) => o.trim()).length >= 2),
    );

  const ready =
    title.trim().length > 0 && questionsReady && (canAddressEveryone || Boolean(groupId));
  const heading = created
    ? `${SURVEY_KIND_LABEL[kind]} үүслээ`
    : `Шинэ ${SURVEY_KIND_LABEL[kind].toLowerCase()}`;

  const applyTemplate = (key: string) => {
    const template = SURVEY_TEMPLATES[key];
    if (!template) return;
    setTitle(template.title);
    setCategory(template.category);
    setQuestions(cloneQuestions(template.questions));
    setPreviewing(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      className="fixed inset-0 z-50 grid items-end overflow-y-auto bg-ink/50 p-0 sm:place-items-center sm:p-4"
    >
      <div className="max-h-[calc(100dvh-0.5rem)] w-full max-w-[680px] overflow-y-auto rounded-t-card border border-border bg-surface p-4 shadow-lg sm:max-h-[calc(100vh-2rem)] sm:rounded-card sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-title font-semibold leading-heading text-ink">
            {heading}
          </h2>
          <Button variant="ghost" size="icon" aria-label="Хаах" onClick={onClose}>
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
            <FormError message={create.isError ? errorMessage(create.error) : null} />

            <div className="flex flex-col gap-3.5">
              {!isPoll ? (
                <div className="rounded-card border border-border bg-canvas p-3">
                  <label
                    htmlFor="survey-template"
                    className="mb-1.5 block text-body font-medium text-ink"
                  >
                    Бэлэн загвараас эхлэх
                  </label>
                  <Select
                    id="survey-template"
                    defaultValue=""
                    onChange={(event) => {
                      applyTemplate(event.target.value);
                      event.target.value = "";
                    }}
                  >
                    <option value="">Загвар сонгох…</option>
                    <option value="satisfaction">Эцэг эхийн сэтгэл ханамж</option>
                    <option value="development">Хүүхдийн хөгжил</option>
                    <option value="meals">Хоолны чанар</option>
                  </Select>
                  <p className="mt-1.5 text-caption text-muted">
                    Загварыг сонгосны дараа бүх асуултыг чөлөөтэй засаж болно.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Гарчиг" error={errors.title} required>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={`${SURVEY_KIND_LABEL[kind]}ын гарчиг оруулах`}
                      autoFocus
                    />
                  )}
                </Field>
                {!isPoll ? (
                  <Field label="Тайлбар">
                    {({ id }) => (
                      <Input
                        id={id}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Товч тайлбар"
                      />
                    )}
                  </Field>
                ) : null}
              </div>

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
                category={category}
                onCategory={setCategory}
                opensOn={opensOn}
                onOpensOn={setOpensOn}
                closesOn={closesOn}
                onClosesOn={setClosesOn}
                showDates={showSettings}
              />

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-body font-semibold text-ink">Асуултууд</p>
                  <p className="text-caption text-muted">Ноорог автоматаар хадгалагдана.</p>
                </div>

                <div className="w-[160px] max-w-[55vw] shrink-0">
                  <label htmlFor="survey-period" className="sr-only">
                    Үнэлгээний төрөл
                  </label>
                  <Select
                    id="survey-period"
                    value={period ?? "OTHER"}
                    onChange={(event) =>
                      setPeriod(
                        event.target.value === "OTHER"
                          ? null
                          : (event.target.value as "MIDLINE" | "ENDLINE"),
                      )
                    }
                    className="h-10"
                  >
                    <option value="MIDLINE">Явцын үнэлгээ</option>
                    <option value="ENDLINE">Үр дүнгийн үнэлгээ</option>
                    <option value="OTHER">Бусад</option>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end">
                {questions.length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-expanded={previewing}
                    onClick={() => setPreviewing((current) => !current)}
                  >
                    <Eye size={16} aria-hidden="true" />
                    Урьдчилан харах
                  </Button>
                ) : null}
              </div>

              <QuestionBuilder
                questions={questions}
                onChange={setQuestions}
                allowMany={!isPoll || multiQuestion}
                fixedType={isPoll ? "SINGLE_CHOICE" : null}
              />

              {previewing && questions.length > 0 ? (
                <SurveyDraftPreview title={title} description={description} questions={questions} />
              ) : null}

              <button
                type="button"
                aria-expanded={showSettings}
                onClick={() => setShowSettings((current) => !current)}
                className="flex min-h-11 items-center rounded-control border border-border px-3 text-body font-medium text-ink"
              >
                Нэмэлт тохиргоо
                {showSettings ? (
                  <ChevronUp size={17} aria-hidden="true" className="ms-auto text-muted" />
                ) : (
                  <ChevronDown size={17} aria-hidden="true" className="ms-auto text-muted" />
                )}
              </button>

              {showSettings ? (
                <div className="grid gap-x-4 rounded-card bg-canvas px-3 sm:grid-cols-2">
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

            <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3.5">
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
function Audience({
  canAddressEveryone,
  groups,
  groupId,
  onGroup,
  category,
  onCategory,
  opensOn,
  onOpensOn,
  closesOn,
  onClosesOn,
  showDates,
}: {
  canAddressEveryone: boolean;
  groups: { id: string; name: string }[];
  groupId: string;
  onGroup: (next: string) => void;
  category: SurveyCategory;
  onCategory: (next: SurveyCategory) => void;
  opensOn: string;
  onOpensOn: (next: string) => void;
  closesOn: string;
  onClosesOn: (next: string) => void;
  showDates: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {canAddressEveryone ? (
          <Field label="Хэнд">
            {({ id }) => (
              <Select id={id} value={groupId} onChange={(e) => onGroup(e.target.value)}>
                <option value="">Бүх бүлэг</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        <Field label="Ангилал">
          {({ id }) => (
            <Select
              id={id}
              value={category}
              onChange={(e) => onCategory(e.target.value as SurveyCategory)}
            >
              {SURVEY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {SURVEY_CATEGORY_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {showDates ? (
        <div className="grid grid-cols-2 gap-3">
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
      ) : null}
    </>
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
    <div className="flex flex-col gap-3">
      {questions.map((question, index) => (
        <div key={index} className="flex flex-col gap-2.5 rounded-card border border-border p-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="grid size-6 shrink-0 place-items-center rounded-pill bg-primary-soft text-caption font-semibold tabular-nums text-primary"
            >
              {index + 1}
            </span>
            <p className="flex-1 text-body font-medium text-ink">Асуулт</p>
            {questions.length > 1 ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${index + 1}-р асуултыг дээш зөөх`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={15} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${index + 1}-р асуултыг доош зөөх`}
                  disabled={index === questions.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={15} aria-hidden="true" />
                </Button>
              </>
            ) : null}
            {allowMany ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
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
                <Copy size={15} aria-hidden="true" />
              </Button>
            ) : null}
            {questions.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${index + 1}-р асуултыг хасах`}
                onClick={() => onChange(questions.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} aria-hidden="true" className="text-danger" />
              </Button>
            ) : null}
          </div>

          <Field label={`${index + 1}-р асуултын текст`} required>
            {({ id }) => (
              <Input
                id={id}
                value={question.prompt}
                onChange={(e) => update(index, { prompt: e.target.value })}
                placeholder="Асуултаа оруулна уу."
              />
            )}
          </Field>

          {fixedType ? null : (
            <Field label="Хариултын хэлбэр">
              {({ id }) => (
                <Select
                  id={id}
                  value={question.type}
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
              )}
            </Field>
          )}

          {hasOptionList(question.type) ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-body font-medium text-ink">Сонголтууд</legend>
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <GripVertical size={16} aria-hidden="true" className="shrink-0 text-faint" />
                  <Input
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
                      aria-label={`${optionIndex + 1}-р сонголтыг хасах`}
                      onClick={() =>
                        update(index, {
                          options: question.options.filter((_, i) => i !== optionIndex),
                        })
                      }
                    >
                      <Trash2 size={16} aria-hidden="true" className="text-danger" />
                    </Button>
                  ) : null}
                </div>
              ))}
              <Button
                variant="ghost"
                className="self-start"
                onClick={() => update(index, { options: [...question.options, ""] })}
              >
                <Plus size={16} aria-hidden="true" />
                Сонголт нэмэх
              </Button>
            </fieldset>
          ) : null}
        </div>
      ))}

      {allowMany ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => onChange([...questions, emptyQuestion(fixedType ?? "SINGLE_CHOICE")])}
        >
          <Plus size={16} aria-hidden="true" />
          Асуулт нэмэх
        </Button>
      ) : null}
    </div>
  );
}

/** The phone-sized form a parent will see after publication. */
function SurveyDraftPreview({
  title,
  description,
  questions,
}: {
  title: string;
  description: string;
  questions: DraftQuestion[];
}) {
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
          {description.trim() ? (
            <p className="mt-1 text-caption text-muted">{description.trim()}</p>
          ) : null}
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
        className="grid size-16 place-items-center rounded-pill bg-mint text-mint-ink"
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
