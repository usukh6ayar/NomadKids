"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Plus } from "lucide-react";
import {
  pollOptionAddedSchema,
  pollTallySchema,
  type PollTally,
  type Survey,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * A poll, answered the way the client drew it — 2026-09-10.
 *
 * "Авсан асуулгууд фэйсбүүкийн пост шиг эцэг эх дарахаар шууд хувь үзүүлэлт нь
 * харагдана. Эцэг эх түүн дээр нэмж шинэ хариулт үүсгэж болно."
 *
 * ★ Separate from the questionnaire form, because the interaction is inverted.
 *
 * A form collects several answers and submits them on a button: the parent is
 * filling something in, and nothing happens until they say so. A poll is one
 * tap that *is* the submission, and its reward is seeing where the class
 * stands. Rendering both from one component would mean a form that submits on
 * every keystroke or a poll with a button under a single choice — the two
 * shapes disagree about when an answer is final.
 *
 * ★★ Tapping submits when every question has a choice, which for the poll the
 * client means — one question — is the first tap.
 *
 * `submitResponse` writes one response per guardian per child and refuses a
 * second, so a poll cannot submit per question. Rather than special-casing
 * "polls have one question" (the model allows more, and a two-question poll
 * would silently post only half), the rule is: choose freely, and the moment
 * nothing is unanswered it goes. A one-question poll is that rule's ordinary
 * case, not an exception to it.
 *
 * ★★★ The result view is driven by the server's `respondedByMe`, not by
 * whether this component just submitted. A parent returning to a poll they
 * answered last week must see the bars, and a submission that failed must not
 * leave them looking at a result they never cast.
 */
export function PollAnswer({ survey, childId }: { survey: Survey; childId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [choices, setChoices] = useState<Record<string, string>>({});

  const tally = useQuery({
    queryKey: qk.childSurveyTally(childId, survey.id),
    queryFn: () => get(`/children/${childId}/surveys/${survey.id}/tally`, pollTallySchema),
  });

  const submit = useMutation({
    mutationFn: (answers: Record<string, string>) =>
      mutate(`/surveys/${survey.id}/responses`, pollTallySchema.partial(), {
        method: "POST",
        body: {
          childId,
          answers: Object.entries(answers).map(([questionId, value]) => ({ questionId, value })),
        },
      }),
    onSuccess: () => {
      toast.success("Саналыг хүлээж авлаа. Баярлалаа.");
      /*
        Both keys: the tally is what this screen redraws, and the child's
        survey list carries `respondedByMe`, which is what stops the board
        offering the poll again.
      */
      void queryClient.invalidateQueries({ queryKey: qk.childSurveyTally(childId, survey.id) });
      void queryClient.invalidateQueries({ queryKey: qk.childSurveys(childId) });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      // The optimistic selection is dropped so the screen matches the server.
      setChoices({});
    },
  });

  if (tally.isLoading) return <LoadingState rows={2} />;
  if (tally.isError) return <ErrorState description={errorMessage(tally.error)} />;

  const data = tally.data!;
  const answered = data.respondedByMe;

  /** Choose, then submit as soon as nothing is left unanswered. */
  function choose(questionId: string, label: string) {
    if (answered || submit.isPending) return;

    const next = { ...choices, [questionId]: label };
    setChoices(next);

    if (data.questions.every((question) => next[question.questionId])) submit.mutate(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {data.questions.map((question) => (
        <Card key={question.questionId} className="flex flex-col gap-3 px-4 py-4">
          <p className="text-lead font-semibold leading-heading text-ink">{question.prompt}</p>

          {answered ? (
            <PollResult question={question} />
          ) : (
            <div role="radiogroup" aria-label={question.prompt} className="flex flex-col gap-2">
              {question.options.map((option) => {
                const selected = choices[question.questionId] === option.label;
                return (
                  <button
                    key={option.label}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={submit.isPending}
                    onClick={() => choose(question.questionId, option.label)}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-control border px-3.5 text-left text-body transition-colors disabled:opacity-60",
                      selected
                        ? "border-primary bg-primary-soft font-medium text-primary"
                        : "border-border bg-surface text-ink hover:bg-canvas",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-pill border",
                        selected ? "border-primary bg-primary text-white" : "border-border",
                      )}
                    >
                      {selected ? <Check size={13} strokeWidth={3} /> : null}
                    </span>
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}

          <AddOption
            childId={childId}
            surveyId={survey.id}
            questionId={question.questionId}
            disabled={submit.isPending}
          />

          <p className="text-caption text-muted">
            {question.totalResponses === 0
              ? "Хараахан хэн ч хариулаагүй байна"
              : `${question.totalResponses} хүн хариулсан`}
          </p>
        </Card>
      ))}
    </div>
  );
}

/**
 * The bars a family sees once they have voted.
 *
 * ★ The label sits *on* the bar, not in a column beside it.
 *
 * `BarRow` puts the label in a fixed-width column so several bars line up for
 * comparison, which is right for the five development domains and wrong here:
 * a poll's choices are sentences a teacher or a parent typed, and a 132px
 * column would truncate most of them. The comparison a poll asks for is
 * between two or three fills on the same screen, which the fills themselves
 * carry.
 *
 * ★★ The percentage is of the people who answered, not of the class.
 *
 * `totalResponses` is the denominator, so the shares sum to 100 among those
 * who voted — which is what "62%" means on a poll everywhere else, and it
 * avoids implying that everyone who has not answered chose nothing.
 */
function PollResult({ question }: { question: PollTally["questions"][number] }) {
  const total = question.totalResponses;
  const mine = question.myAnswer;
  const isMine = (label: string) => (Array.isArray(mine) ? mine.includes(label) : mine === label);

  return (
    <ul className="flex flex-col gap-2">
      {question.options.map((option) => {
        const percent = total > 0 ? Math.round((option.count / total) * 100) : 0;
        const chosen = isMine(option.label);

        return (
          <li
            key={option.label}
            className={cn(
              "relative overflow-hidden rounded-control border",
              chosen ? "border-primary" : "border-border",
            )}
          >
            {/*
              The fill is `aria-hidden` and the row carries the whole sentence
              instead. A screen reader hearing "Ирнэ" then "62%" from two
              nodes has to join them; one label cannot be misread.
            */}
            <span
              aria-hidden="true"
              style={{ width: `${percent}%` }}
              className={cn(
                "absolute inset-y-0 left-0 transition-[width] duration-500",
                chosen ? "bg-primary-soft" : "bg-sunken",
              )}
            />
            <span className="relative flex min-h-11 items-center gap-2 px-3.5 py-2 text-body">
              <span className={cn("min-w-0 flex-1", chosen ? "font-medium text-ink" : "text-ink")}>
                {option.label}
                {chosen ? (
                  <span className="ml-1.5 text-caption font-normal text-primary">
                    · таны сонголт
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-body font-semibold tabular-nums text-ink">
                {percent}%
              </span>
              <span className="sr-only">
                {option.label}: {option.count} санал, {percent} хувь
                {chosen ? ", таны сонголт" : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Add an answer of your own" — the client's "эцэг эх түүн дээр нэмж шинэ
 * хариулт үүсгэж болно".
 *
 * ★ Closed until asked for.
 *
 * An input permanently open under every poll invites typing where the intended
 * action is tapping, and on a phone it raises the keyboard over the choices
 * the parent came to read. The link opens it; nothing is lost by the extra
 * tap because adding a choice is the rarer act.
 *
 * ★★ The server owns the duplicate rule, and a duplicate is success.
 *
 * `added: false` means somebody added that choice a moment ago — the parent
 * wanted it to exist and it does, so this says so rather than reporting a race
 * as their mistake.
 */
function AddOption({
  childId,
  surveyId,
  questionId,
  disabled,
}: {
  childId: string;
  surveyId: string;
  questionId: string;
  disabled: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");

  const add = useMutation({
    mutationFn: () =>
      mutate(
        `/children/${childId}/surveys/${surveyId}/questions/${questionId}/options`,
        pollOptionAddedSchema,
        { method: "POST", body: { label: label.trim() } },
      ),
    onSuccess: (result) => {
      toast.success(result.added ? "Хариулт нэмэгдлээ" : "Энэ хариулт аль хэдийн байна");
      setLabel("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: qk.childSurveyTally(childId, surveyId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-1.5 self-start text-body font-medium text-primary hover:underline disabled:opacity-60"
      >
        <Plus size={16} aria-hidden="true" />
        Өөр хариулт нэмэх
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (label.trim() && !add.isPending) add.mutate();
      }}
      className="flex items-center gap-2"
    >
      <Input
        aria-label="Шинэ хариулт"
        value={label}
        maxLength={80}
        placeholder="Хариултаа бичнэ үү"
        onChange={(e) => setLabel(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={!label.trim() || add.isPending} className="shrink-0">
        {add.isPending ? "Нэмж байна…" : "Нэмэх"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="shrink-0"
        onClick={() => {
          setOpen(false);
          setLabel("");
        }}
      >
        Болих
      </Button>
    </form>
  );
}
