import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { SurveyAnswerValue, SurveyQuestion } from "@kinder/contracts";
import { SurveyAnswerForm } from "@/components/survey/survey-answer-form";

/**
 * «Илгээх» waits for a real answer to every question — 2026-10-16, the user:
 * "судалгаа бөглөхдөө хоосон ч илгээж болдог". Typing and erasing, or
 * ticking and unticking, used to count as answered.
 */

const TEXT = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  order: 0,
  type: "TEXT",
  prompt: "Санал",
  options: null,
} as unknown as SurveyQuestion;

const CHECKBOX = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  order: 1,
  type: "CHECKBOX",
  prompt: "Дуртай зүйл",
  options: ["Зураг", "Дуу"],
} as unknown as SurveyQuestion;

function Harness({ questions }: { questions: SurveyQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  return (
    <SurveyAnswerForm
      questions={questions}
      answers={answers}
      onAnswers={setAnswers}
      pending={false}
      error={null}
      onSubmit={() => {}}
    />
  );
}

describe("an empty answer is not an answer", () => {
  it("keeps «Илгээх» off for a text typed and erased, or only blanks", async () => {
    const user = userEvent.setup();
    render(<Harness questions={[TEXT]} />);
    const submit = screen.getByRole("button", { name: "Илгээх" });
    const box = screen.getByLabelText("Хариулт");

    await user.type(box, "а");
    expect(submit).toBeEnabled();
    await user.clear(box);
    expect(submit).toBeDisabled();
    await user.type(box, "   ");
    expect(submit).toBeDisabled();
  });

  it("keeps «Илгээх» off for a checkbox ticked and unticked", async () => {
    const user = userEvent.setup();
    render(<Harness questions={[CHECKBOX]} />);
    const submit = screen.getByRole("button", { name: "Илгээх" });

    await user.click(screen.getByLabelText("Зураг"));
    expect(submit).toBeEnabled();
    await user.click(screen.getByLabelText("Зураг"));
    expect(submit).toBeDisabled();
  });
});
