"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Check, GripVertical, Plus, Trash2, X } from "lucide-react";
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
  type SurveyQuestionType,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
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
  const canAddressEveryone = sessionLoading || hasRole("ADMIN");

  const isPoll = kind === "POLL";

  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

  // ── step 1 ──────────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [purpose, setPurpose] = useState("");
  /** A poll's own shape question: one question, or several. */
  const [multiQuestion, setMultiQuestion] = useState(false);

  // ── audience ────────────────────────────────────────────────────────────
  const [groupId, setGroupId] = useState("");
  const [category, setCategory] = useState<SurveyCategory>(
    isPoll ? "CLASS_GROUP" : "PARENT_ENGAGEMENT",
  );
  const [termId, setTermId] = useState("");
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
  const [closingNote, setClosingNote] = useState("");

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
          purpose: purpose.trim() || null,
          category,
          scope: "CHILD",
          kind,
          groupId: groupId || null,
          termId: termId || null,
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
          closingNote: closingNote.trim() || null,
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
    onSuccess: (survey) => setCreated(survey),
  });

  const errors = fieldErrors(create.error);

  /*
    ★ Which steps exist, and what each one needs before Дараах lights up.

    Validation sits on the step rather than on the submit, because a wizard
    whose last button reports a fault three screens back is the failure the
    steps exist to avoid.
  */
  const questionsReady =
    questions.length > 0 &&
    questions.every(
      (q) =>
        q.prompt.trim().length > 0 &&
        (!hasOptionList(q.type) || q.options.filter((o) => o.trim()).length >= 2),
    );

  const steps = isPoll
    ? [
        { label: "Үндсэн мэдээлэл", ready: title.trim().length > 0 },
        { label: "Асуулт тохируулах", ready: questionsReady },
        { label: "Тохиргоо", ready: true },
      ]
    : [
        { label: "Үндсэн мэдээлэл", ready: title.trim().length > 0 },
        { label: "Хамрах хүрээ", ready: canAddressEveryone || Boolean(groupId) },
        { label: "Асуулт нэмэх", ready: questionsReady },
        { label: "Тохиргоо", ready: true },
      ];

  const last = step === steps.length - 1;
  const heading = created
    ? `${SURVEY_KIND_LABEL[kind]} үүслээ`
    : `Шинэ ${SURVEY_KIND_LABEL[kind].toLowerCase()}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      className="fixed inset-0 z-50 grid items-end overflow-y-auto bg-ink/50 p-0 sm:place-items-center sm:p-4"
    >
      <div className="max-h-[calc(100dvh-0.5rem)] w-full max-w-[560px] overflow-y-auto rounded-t-card border border-border bg-surface p-4 shadow-lg sm:max-h-[calc(100vh-2rem)] sm:rounded-card sm:p-5">
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
          <>
            <StepDots steps={steps} current={step} onGo={setStep} />

            <p className="mb-3 mt-3 text-lead font-semibold leading-heading text-ink">
              {steps[step]!.label}
            </p>

            <FormError message={create.isError ? errorMessage(create.error) : null} />

            <div className="flex flex-col gap-3.5">
              {steps[step]!.label === "Үндсэн мэдээлэл" ? (
                <>
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

                  <Field label={isPoll ? "Тайлбар (сонголттой)" : "Тайлбар"}>
                    {({ id }) => (
                      <Textarea
                        id={id}
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Товч тайлбар бичнэ үү."
                      />
                    )}
                  </Field>

                  {/*
                    ★ Зорилго is the questionnaire's, not the poll's.

                    It is what the kindergarten is trying to learn, read on the
                    results sheet a year later. A poll asking who is coming on
                    Friday has no such thing, and a field nobody fills is a
                    field everybody scrolls past.
                  */}
                  {isPoll ? (
                    <fieldset>
                      <legend className="mb-2 text-body font-medium text-ink">
                        Асуулгын төрөл
                      </legend>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { many: false, label: "Нэг асуулттай", hint: "Хурдан санал авах" },
                          { many: true, label: "Олон асуулттай", hint: "Богино судалгаа" },
                        ].map((option) => (
                          <label
                            key={String(option.many)}
                            className={cn(
                              "cursor-pointer rounded-card border px-3 py-2.5 transition-colors",
                              multiQuestion === option.many
                                ? "border-primary bg-primary-soft"
                                : "border-border hover:bg-canvas",
                            )}
                          >
                            <input
                              type="radio"
                              name="poll-shape"
                              checked={multiQuestion === option.many}
                              onChange={() => {
                                setMultiQuestion(option.many);
                                // Going back to one question keeps the first,
                                // rather than discarding what was typed.
                                if (!option.many) setQuestions((q) => q.slice(0, 1));
                              }}
                              className="sr-only"
                            />
                            <span
                              className={cn(
                                "block text-body font-semibold",
                                multiQuestion === option.many ? "text-primary" : "text-ink",
                              )}
                            >
                              {option.label}
                            </span>
                            <span className="block text-caption text-muted">{option.hint}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <Field label="Зорилго" hint="Ямар мэдээлэл цуглуулах вэ?">
                      {({ id }) => (
                        <Textarea
                          id={id}
                          rows={2}
                          value={purpose}
                          onChange={(e) => setPurpose(e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                </>
              ) : null}

              {steps[step]!.label === "Асуулт нэмэх" ||
              steps[step]!.label === "Асуулт тохируулах" ? (
                <QuestionBuilder
                  questions={questions}
                  onChange={setQuestions}
                  allowMany={!isPoll || multiQuestion}
                  fixedType={isPoll ? "SINGLE_CHOICE" : null}
                />
              ) : null}

              {steps[step]!.label === "Хамрах хүрээ" ||
              (isPoll && steps[step]!.label === "Тохиргоо") ? (
                <Audience
                  canAddressEveryone={canAddressEveryone}
                  groups={groups.data?.items ?? []}
                  groupId={groupId}
                  onGroup={setGroupId}
                  category={category}
                  onCategory={setCategory}
                  terms={terms.data ?? []}
                  termId={termId}
                  onTerm={setTermId}
                  opensOn={opensOn}
                  onOpensOn={setOpensOn}
                  closesOn={closesOn}
                  onClosesOn={setClosesOn}
                  compact={isPoll}
                />
              ) : null}

              {steps[step]!.label === "Тохиргоо" ? (
                <div className="flex flex-col divide-y divide-border-soft">
                  <Switch
                    label="Хариулт нуух"
                    description="Хариултыг нэрийг нь харуулахгүйгээр авна."
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                  />
                  <Switch
                    label="Олон удаа хариулахыг зөвшөөрөх"
                    description="Нэг гэр бүл дахин дахин хариулж болно."
                    checked={allowMultipleResponses}
                    onChange={(e) => setAllowMultipleResponses(e.target.checked)}
                  />
                  {/*
                    ★ Only where there is an order to shuffle.

                    A one-question poll has nothing to reorder, and a switch
                    that provably does nothing is the kind of control that
                    teaches people the settings are decorative.
                  */}
                  {questions.length > 1 ? (
                    <Switch
                      label="Асуултын дарааллыг санамсаргүй болгох"
                      description="Эхний асуултад илүү өгөөмөр хариулдаг талыг бууруулна."
                      checked={shuffleQuestions}
                      onChange={(e) => setShuffleQuestions(e.target.checked)}
                    />
                  ) : null}

                  <div className="pt-3">
                    <Field label="Нэмэлт тэмдэглэл" hint="Хариулсны дараа эцэг эхэд харагдана.">
                      {({ id }) => (
                        <Textarea
                          id={id}
                          rows={2}
                          value={closingNote}
                          onChange={(e) => setClosingNote(e.target.value)}
                          placeholder="Жишээ нь: Хариулж өгсөнд баярлалаа."
                        />
                      )}
                    </Field>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-border pt-3.5">
              {step > 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => setStep(step - 1)}
                  disabled={create.isPending}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  Буцах
                </Button>
              ) : null}

              <div className="ms-auto flex items-center gap-2">
                {/*
                  ★ The draft door stays open on the last step.

                  Publishing is what the client's design does at the end of the
                  wizard, and it is right — requiring a teacher to then hunt for
                  Нийтлэх is the friction this screen exists to remove. But the
                  Ноорог tab has to remain reachable from the only place a
                  survey is made, or it becomes a tab for surveys nobody can
                  create.
                */}
                {last ? (
                  <Button
                    variant="secondary"
                    onClick={() => create.mutate(false)}
                    disabled={create.isPending || !steps.every((s) => s.ready)}
                  >
                    Ноорог болгох
                  </Button>
                ) : null}

                <Button
                  onClick={() => (last ? create.mutate(true) : setStep(step + 1))}
                  disabled={create.isPending || !steps[step]!.ready}
                >
                  {create.isPending ? (
                    "Хадгалж байна…"
                  ) : last ? (
                    "Үүсгэх"
                  ) : (
                    <>
                      Дараах
                      <ArrowRight size={16} aria-hidden="true" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The numbered dots across the top.
 *
 * ★ A completed step is pressable; a future one is not.
 *
 * Going back to fix the title is the commonest thing anybody does in a wizard,
 * and making them press Буцах three times is why people abandon one. Jumping
 * *forward* past an incomplete step would produce a survey with no title, so
 * the same control refuses that direction.
 */
function StepDots({
  steps,
  current,
  onGo,
}: {
  steps: { label: string; ready: boolean }[];
  current: number;
  onGo: (index: number) => void;
}) {
  return (
    <ol className="flex items-center gap-1.5">
      {steps.map((entry, index) => {
        const done = index < current;
        const active = index === current;

        return (
          <li key={entry.label} className="flex flex-1 items-center gap-1.5">
            <button
              type="button"
              disabled={index > current}
              aria-current={active ? "step" : undefined}
              onClick={() => onGo(index)}
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-pill text-caption font-semibold tabular-nums transition-colors",
                active
                  ? "bg-primary text-white"
                  : done
                    ? "bg-primary-soft text-primary"
                    : "bg-sunken text-muted",
              )}
            >
              {done ? <Check size={14} aria-hidden="true" /> : index + 1}
              <span className="sr-only">
                {index + 1}-р алхам: {entry.label}
              </span>
            </button>
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn("h-0.5 flex-1 rounded-pill", done ? "bg-primary-soft" : "bg-sunken")}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Who it is asked of, and when — one step for a questionnaire, folded into
 * the poll's settings step because a poll has less to say. */
function Audience({
  canAddressEveryone,
  groups,
  groupId,
  onGroup,
  category,
  onCategory,
  terms,
  termId,
  onTerm,
  opensOn,
  onOpensOn,
  closesOn,
  onClosesOn,
  compact,
}: {
  canAddressEveryone: boolean;
  groups: { id: string; name: string }[];
  groupId: string;
  onGroup: (next: string) => void;
  category: SurveyCategory;
  onCategory: (next: SurveyCategory) => void;
  terms: { id: string; number: number; name: string }[];
  termId: string;
  onTerm: (next: string) => void;
  opensOn: string;
  onOpensOn: (next: string) => void;
  closesOn: string;
  onClosesOn: (next: string) => void;
  compact: boolean;
}) {
  return (
    <>
      <Field
        label="Хэнд"
        hint={
          canAddressEveryone
            ? "Сонгосон бүлгийн эцэг эхэд л харагдана."
            : "Өөрийн бүлгээ сонгоно уу."
        }
      >
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={groupId}
            onChange={(e) => onGroup(e.target.value)}
          >
            {canAddressEveryone ? <option value="">Бүх бүлэг</option> : null}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-2")}>
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

        {/*
          ★ Only when the kindergarten has configured terms.

          `Term` is administrator-editable (§2.3) and ships empty, so a fresh
          deployment would otherwise draw a select whose only entry is "—".
        */}
        {terms.length > 0 ? (
          <Field label="Улирал">
            {({ id }) => (
              <Select id={id} value={termId} onChange={(e) => onTerm(e.target.value)}>
                <option value="">Сонгоогүй</option>
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </div>

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
              <Button
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
