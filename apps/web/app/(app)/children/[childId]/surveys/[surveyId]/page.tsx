"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";
import { surveySchema, type SurveyAnswerValue } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { PollAnswer } from "@/components/survey/poll-answer";
import { FamilyAnswers } from "@/components/survey/family-answers";
import { SurveyAnswerForm } from "@/components/survey/survey-answer-form";

const activeSurveysSchema = z.array(surveySchema);

/** A guardian answers one CHILD-scope survey. */
export default function SurveyResponsePage() {
  const toast = useToast();
  const params = useParams<{ childId: string; surveyId: string }>();
  const { childId, surveyId } = params;
  const router = useRouter();
  const queryClient = useQueryClient();

  // The survey's own questions aren't separately readable by a guardian
  // outside the review flow — this list, already scoped to the child, is
  // the one endpoint a parent may call, so the response screen finds its
  // survey there rather than adding a second read path.
  const active = useQuery({
    queryKey: qk.childSurveys(childId),
    queryFn: () => get(`/children/${childId}/surveys`, activeSurveysSchema),
  });

  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  /**
   * The question order this family sees — see `ordered` below.
   *
   * A `useMemo` keyed on the survey rather than `useState`, because the survey
   * arrives after the first render: state initialised from it would be empty
   * and never refill.
   */
  const shuffled = useMemo(() => {
    const questions = active.data?.find((s) => s.id === surveyId)?.questions ?? [];
    if (!questions.length) return questions;

    const found = active.data?.find((s) => s.id === surveyId);
    if (!found?.shuffleQuestions) return questions;

    const copy = [...questions];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }, [active.data, surveyId]);

  const submit = useMutation({
    mutationFn: () =>
      mutate(`/surveys/${surveyId}/responses`, z.unknown(), {
        method: "POST",
        body: {
          childId,
          answers: Object.entries(answers).map(([questionId, value]) => ({ questionId, value })),
        },
      }),
    onSuccess: () => {
      /*
        ★ The survey's own closing note, when it wrote one.

        A kindergarten that wants to say what happens next — "Хариултыг 9-р
        сарын 20-нд хэлэлцэнэ" — writes it on the survey rather than in the
        description, where a family would read it *before* answering instead of
        after. Null falls back to the product's own thank-you, which is what
        every survey written before the field says.
      */
      toast.success(survey?.closingNote?.trim() || "Саналыг хүлээж авлаа. Баярлалаа.");
      void queryClient.invalidateQueries({ queryKey: qk.childSurveys(childId) });
      /*
        ★ Back to the family's own surveys, not the child's record — 2026-09-12,
        at the client's request: "хүүхдийн дэлгэрэнгүй рүү үсэрч байна, ингэж
        болохгүй, миний судалгаанууд руу ор."

        A parent answering one survey is working through a list of them. Landing
        on the child's profile ends that errand and makes finding the next one a
        navigation problem; the list they came from has the next one on it, now
        marked answered.
      */
      router.replace(`/children/${childId}/surveys`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /*
    ★ A way out, on every branch — 2026-09-12, at the client's request: "эцэг эх
    асуулгад хариулсны дараа гарч болохгүй байна."

    A poll is one tap; the screen it leaves behind showed the class's answer and
    no exit at all, so a parent's only way back was the browser's own button —
    which this product does not rely on anywhere else. The two other branches
    were no better: a survey that could not be found was a dead end too.

    `BackButton` goes one step back through history, with the family's own
    survey list as the fallback for a page opened from a notification link.
  */
  if (active.isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <PageHeader backHref={`/children/${childId}/surveys`} title="Судалгаа, асуулга" />
        <LoadingState rows={3} />
      </div>
    );
  }

  if (active.isError) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <PageHeader backHref={`/children/${childId}/surveys`} title="Судалгаа, асуулга" />
        <ErrorState description={errorMessage(active.error)} />
      </div>
    );
  }

  const survey = active.data!.find((s) => s.id === surveyId);

  if (!survey) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <PageHeader backHref={`/children/${childId}/surveys`} title="Судалгаа, асуулга" />
        <ErrorState title="Олдсонгүй" description="Энэ судалгаа олдсонгүй эсвэл хаагдсан байна." />
      </div>
    );
  }

  /*
    ★ A poll is a different screen, not a form with fewer fields — 2026-09-10,
    at the client's request.

    `PollAnswer` explains why in full: a form is filled in and submitted, a
    poll is one tap that submits and answers back with where the class stands.
    Routed here rather than inside the form so the form below keeps exactly one
    interaction model.
  */
  /*
    ★ An answered questionnaire reads back rather than asking again —
    2026-09-17.

    The family's list stopped unfolding an answered survey inside the row and
    now navigates here instead (the client: "дарсан даруйд дэлгэрэнгүй эсвэл
    хариулсан үр дүнгийн хуудас руу шилжинэ"). This screen drew the blank form
    whatever the state was, so following that link would have offered the
    questions a second time and `POST /surveys/:id/responses` would have
    refused the answers — the destination has to be the read-back the row used
    to hold.

    A poll skips this: `PollAnswer` below already draws the class's shares once
    the family has voted, which is more than their own answer and is what a
    poll is for.
  */
  if (survey.kind !== "POLL" && survey.respondedByMe) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <PageHeader backHref={`/children/${childId}/surveys`} title={survey.title} />
        <Card className="flex flex-col gap-3 px-4 py-4">
          <p className="text-caption font-semibold text-mint-ink">Хариулсан</p>
          <FamilyAnswers survey={survey} />
        </Card>
      </div>
    );
  }

  if (survey.kind === "POLL") {
    return (
      <div className="flex flex-col gap-6 py-2">
        <PageHeader backHref={`/children/${childId}/surveys`} title={survey.title} />
        <PollAnswer survey={survey} childId={childId} />
      </div>
    );
  }

  /*
    ★ Shuffled once per mount, not on every render.

    Order effects are real — the first question of a satisfaction survey is
    answered more generously than the fifth — and `shuffleQuestions` is the
    author saying theirs is the kind that can bear reordering. Reshuffling as
    the form re-renders (which it does on every keystroke) would move questions
    under the reader's hand, so the order is fixed the first time and kept.

    Seeded by nothing in particular: the point is that the order differs
    between families, not that it is reproducible.
  */
  const ordered = shuffled;

  return (
    <div className="flex flex-col gap-6 py-2">
      <PageHeader backHref={`/children/${childId}/surveys`} title={survey.title} />

      <SurveyAnswerForm
        questions={ordered}
        answers={answers}
        onAnswers={setAnswers}
        pending={submit.isPending}
        error={submit.isError ? errorMessage(submit.error) : null}
        onSubmit={() => submit.mutate()}
      />
    </div>
  );
}
