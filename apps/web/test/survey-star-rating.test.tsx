import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { SurveyAnswerValue, SurveyQuestion } from "@kinder/contracts";
import { SurveyAnswerForm } from "@/components/survey/survey-answer-form";
import { stars } from "@/lib/stars";

/**
 * A rating answered with stars — client, 2026-10-06. The value sent is still
 * the number 1–5, so reports and averages are unchanged.
 */

const QUESTION = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  order: 0,
  type: "RATING",
  prompt: "Хүүхэд тань цэцэрлэгт дуртай юу?",
  options: null,
} as unknown as SurveyQuestion;

function Harness() {
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  return (
    <>
      <SurveyAnswerForm
        questions={[QUESTION]}
        answers={answers}
        onAnswers={setAnswers}
        pending={false}
        error={null}
        onSubmit={() => {}}
      />
      <output>{JSON.stringify(answers)}</output>
    </>
  );
}

describe("star rating", () => {
  it("is five stars; pressing the fourth lights four and sends 4", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const group = screen.getByRole("radiogroup", { name: QUESTION.prompt });
    expect(group.querySelectorAll("svg")).toHaveLength(5);

    await user.click(screen.getByRole("radio", { name: "4 од" }));
    expect(screen.getByRole("radio", { name: "4 од" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("status")).toHaveTextContent(`{"${QUESTION.id}":4}`);

    const lit = [...group.querySelectorAll("svg")].filter((svg) =>
      svg.getAttribute("class")?.includes("fill-sun"),
    );
    expect(lit).toHaveLength(4);
  });

  it("reads a rating back as stars", () => {
    expect(stars(4)).toBe("★★★★☆");
    expect(stars("5")).toBe("★★★★★");
    expect(stars(7)).toBe("7");
  });
});
