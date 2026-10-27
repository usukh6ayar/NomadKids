import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { A79_LEVELS, a79CriterionPrompt } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { A79BaselinePanel } from "@/components/assessment/a79-baseline";
import {
  A79BaselineChildFill,
  A79BaselineGroupFill,
} from "@/components/assessment/a79-baseline-fill";
import { A79BaselineStartDialog } from "@/components/assessment/a79-baseline-start";
import { baselineForm } from "@/lib/a79-baseline";
import { domainProgress, finishAnswers, saveKind, settleDomain } from "@/lib/a79-baseline-fill";

/*
 * «Гарааны үнэлгээ» started and filled on its own page — 2026-10-27, the
 * user: each child's level suggested from age and changeable; filled by child
 * (Мэдлэг · Чадвар · Төлөвшил, each its own tab) or by group; a child on the
 * page edits only that child.
 */
afterEach(() => vi.unstubAllGlobals());

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "55555555-5555-4555-8555-555555555555";
const SURVEY_ID = "44444444-4444-4444-8444-444444444444";
const ANU = "77777777-7777-4777-8777-777777777777";
const BAT = "66666666-6666-4666-8666-666666666666";
const level = A79_LEVELS[0]!; // I: Мэдлэг 11 · Чадвар 22 · Төлөвшил 4

const SURVEY = {
  id: SURVEY_ID,
  title: "А/79 Гарааны үнэлгээ — I түвшин",
  description: null,
  category: "OTHER",
  scope: "CHILD",
  kind: "FORM",
  respondent: "TEACHER",
  status: "PUBLISHED",
  period: "BASELINE",
  a79Level: "I",
  groupId: GROUP,
  group: { id: GROUP, name: "Дэлбээ" },
  questions: level.criteria.map((c, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    type: "SINGLE_CHOICE",
    prompt: a79CriterionPrompt(c),
    options: ["0", "1"],
    required: true,
    order: i,
  })),
  createdAt: "2026-09-10T00:00:00Z",
  publishedAt: "2026-09-10T00:00:00Z",
  closedAt: null,
};
const questions = SURVEY.questions.map((q) => ({ ...q }));
const form = baselineForm(questions)!;
const domainIds = (domain: string) =>
  form.criteria.filter((c) => c.domain === domain).map((c) => c.questionId);

function row(id: string, firstName: string, extra: Record<string, unknown> = {}) {
  return {
    child: { id, firstName, lastName: "Бат" },
    group: { id: GROUP, name: "Дэлбээ" },
    response: null,
    draft: null,
    ...extra,
  };
}

function stubSheet(rows: unknown[], more: Parameters<typeof stubApi>[0] = []) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/kindergartens/${KG}/surveys`, body: [SURVEY] },
    { path: `/surveys/${SURVEY_ID}/teacher-sheet/drafts`, method: "PUT", body: { saved: 1 } },
    { path: `/surveys/${SURVEY_ID}/teacher-sheet`, method: "PUT", body: { saved: 1 } },
    { path: `/surveys/${SURVEY_ID}/teacher-sheet`, body: { survey: SURVEY, rows } },
    ...more,
  ]);
}

describe("the fill arithmetic", () => {
  it("reads the survey's criteria by domain", () => {
    expect(form.level.key).toBe("I");
    expect(form.others).toHaveLength(0);
    expect(form.criteria[0]!.text).toBe(level.criteria[0]!.text);
    expect(domainIds("Мэдлэг")).toHaveLength(11);
    expect(domainIds("Чадвар")).toHaveLength(22);
    expect(domainIds("Төлөвшил")).toHaveLength(4);
  });

  it("saves a domain whole — ticked «1», the rest «0» — and leaves the others unanswered", () => {
    const [first, second] = domainIds("Мэдлэг");
    const settled = settleDomain(form.criteria, { [first!]: "1" }, "Мэдлэг");
    expect(settled[first!]).toBe("1");
    expect(settled[second!]).toBe("0");
    const progress = domainProgress(form.criteria, settled);
    expect(progress.map((d) => [d.domain, d.answered, d.met, d.done])).toEqual([
      ["Мэдлэг", 11, 1, true],
      ["Чадвар", 0, 0, false],
      ["Төлөвшил", 0, 0, false],
    ]);
    // Less than the whole survey is a draft; a recorded response cannot become one.
    expect(saveKind(questions, settled, false)).toBe("draft");
    expect(saveKind(questions, settled, true)).toBe("blocked");
  });

  it("finishing answers every criterion, so the row is the child's response", () => {
    const finished = finishAnswers(form.criteria, [], { [domainIds("Чадвар")[0]!]: "1" });
    expect(Object.keys(finished)).toHaveLength(37);
    expect(Object.values(finished).filter((v) => v === "1")).toHaveLength(1);
    expect(saveKind(questions, finished, false)).toBe("response");
  });
});

describe("«Шинэ гарааны үнэлгээ»", () => {
  const roster = [
    { childId: ANU, firstName: "Ану", lastName: "Бат", suggestedLevel: "IV" as const },
    { childId: BAT, firstName: "Тэмүүлэн", lastName: "Бат", suggestedLevel: "III" as const },
  ];

  it("offers the button when the group has no baseline", async () => {
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/kindergartens/${KG}/surveys`, body: [] },
      { path: `/groups/${GROUP}/a79-baseline`, body: { surveys: [], roster } },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<A79BaselinePanel groupId={GROUP} fill />);
    // The survey list read first — before the session, the panel is empty for a moment.
    await waitFor(() =>
      expect(api.calls.some((c) => c.url === `/kindergartens/${KG}/surveys`)).toBe(true),
    );
    await user.click(await screen.findByRole("button", { name: /Шинэ гарааны үнэлгээ/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("starts with each child on the level their age suggests, and the teacher may change it", async () => {
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP}/a79-baseline`,
        method: "POST",
        body: { surveys: [], roster },
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(
      <A79BaselineStartDialog
        groupId={GROUP}
        roster={roster}
        adding={false}
        open
        onOpenChange={() => {}}
      />,
    );

    // A table: a child per row, the levels across.
    const table = await screen.findByRole("table", { name: "Хүүхэд бүрийн түвшин" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["№", "Хүүхдийн нэр", "I0", "II0", "III1", "IV1", "—0"]);
    expect(screen.getByRole("radio", { name: "Б.Ану — IV түвшин" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Б.Тэмүүлэн — III түвшин" })).toBeChecked();
    // The teacher's choice wins: Тэмүүлэн on II, then Ану left out.
    await user.click(screen.getByRole("radio", { name: "Б.Тэмүүлэн — II түвшин" }));
    await user.click(screen.getByRole("radio", { name: "Б.Ану — үнэлэхгүй" }));
    await user.click(screen.getByRole("button", { name: "Үүсгэх" }));

    await waitFor(() =>
      expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({
        levels: [{ level: "II", childIds: [BAT] }],
      }),
    );
  });

  it("offers only the children on no baseline yet when adding", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    renderWithProviders(
      <A79BaselineStartDialog
        groupId={GROUP}
        roster={[{ ...roster[0]!, surveyId: SURVEY_ID }, roster[1]!]}
        adding
        open
        onOpenChange={() => {}}
      />,
    );
    expect(await screen.findByText("Б.Тэмүүлэн")).toBeInTheDocument();
    expect(screen.queryByText("Б.Ану")).toBeNull();
  });
});

describe("the group's page", () => {
  /** 2026-10-27, the user: the table is the list — no second one above it. */
  it("opens a child from their name on the table, and names who has not started", async () => {
    const answered = questions.map((q) => ({ questionId: q.id, value: "1" }));
    stubSheet(
      [
        row(ANU, "Ану", {
          response: {
            id: "88888888-8888-4888-8888-888888888888",
            submittedAt: "2026-10-27T00:00:00Z",
            respondent: {
              id: "99999999-9999-4999-8999-999999999999",
              lastName: "Б",
              firstName: "Багш",
            },
            answers: answered,
          },
        }),
        row(BAT, "Тэмүүлэн"),
      ],
      [{ path: `/groups/${GROUP}/a79-baseline`, body: { surveys: [], roster: [] } }],
    );
    renderWithProviders(<A79BaselinePanel groupId={GROUP} fill />);

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "Б.Ану" })).toHaveAttribute(
      "href",
      `/groups/${GROUP}/baseline/${ANU}`,
    );
    expect(screen.queryByRole("list", { name: "Гарааны үнэлгээний хүүхдүүд" })).toBeNull();
    const notStarted = screen.getByText(/Бөглөж эхлээгүй/);
    expect(within(notStarted).getByRole("link", { name: "Б.Тэмүүлэн" })).toHaveAttribute(
      "href",
      `/groups/${GROUP}/baseline/${BAT}`,
    );
  });
});

describe("filling one child in", () => {
  /** Мэдлэг's table: a row per criterion, «0» and «1» across. */
  const table = (domain: string) => screen.getByRole("table", { name: domain });
  const cell = (domain: string, n: number, value: "0" | "1") =>
    within(table(domain)).getByRole("radio", { name: `${n}-р шалгуур: ${value}` });

  it("shows Мэдлэг, Чадвар, Төлөвшил as tabs, each a 0 · 1 table, and saves a draft to continue", async () => {
    const api = stubSheet([row(ANU, "Ану"), row(BAT, "Тэмүүлэн")]);
    const user = userEvent.setup();
    renderWithProviders(<A79BaselineChildFill groupId={GROUP} childId={ANU} />);

    const tabs = await screen.findByRole("tablist", { name: "Салбар" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Мэдлэг11", "Чадвар22", "Төлөвшил4"]);
    expect(within(table("Мэдлэг")).getAllByRole("radio")).toHaveLength(22);

    await user.click(cell("Мэдлэг", 1, "1"));
    await user.click(cell("Мэдлэг", 2, "0"));
    await user.click(cell("Мэдлэг", 3, "1"));
    // The child's total under the table, drawn as the group's is.
    expect(screen.getByRole("progressbar", { name: /^Мэдлэг: 18/ })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Хэсгийн дундаж" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Чадвар/ }));

    await waitFor(() => {
      const draft = api.calls.find((c) => c.url.endsWith("/teacher-sheet/drafts"));
      expect(draft?.body).toEqual({
        drafts: [
          {
            childId: ANU,
            answers: domainIds("Мэдлэг")
              .slice(0, 3)
              .map((questionId, i) => ({ questionId, value: i === 1 ? "0" : "1" })),
          },
        ],
      });
    });
    // Only this child is sent, and the next domain is open.
    expect(await screen.findByRole("table", { name: "Чадвар" })).toBeInTheDocument();
  });

  it("«Дуусгах» asks about the blank criteria, then saves the row whole", async () => {
    const api = stubSheet([row(ANU, "Ану")]);
    const user = userEvent.setup();
    renderWithProviders(<A79BaselineChildFill groupId={GROUP} childId={ANU} />);

    await user.click(await screen.findByRole("tab", { name: /Төлөвшил/ }));
    await user.click(cell("Төлөвшил", 1, "1"));
    await user.click(screen.getByRole("button", { name: "Дуусгах" }));

    const dialog = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog"));
    expect(dialog).toHaveTextContent("36 шалгуурыг бөглөөгүй");
    await user.click(within(dialog).getByRole("button", { name: "Дуусгах" }));

    await waitFor(() => {
      const saved = api.calls.find(
        (c) => c.method === "PUT" && c.url === `/surveys/${SURVEY_ID}/teacher-sheet`,
      );
      const answers = (saved?.body as { responses: { answers: { value: string }[] }[] })
        ?.responses[0]?.answers;
      expect(answers).toHaveLength(37);
      expect(answers?.filter((a) => a.value === "1")).toHaveLength(1);
    });
  });

  it("continues a saved draft where it was left", async () => {
    stubSheet([
      row(ANU, "Ану", {
        draft: {
          updatedAt: "2026-10-20T00:00:00Z",
          author: { id: "99999999-9999-4999-8999-999999999999", lastName: "Б", firstName: "Багш" },
          answers: domainIds("Мэдлэг").map((questionId, i) => ({
            questionId,
            value: i < 3 ? "1" : "0",
          })),
        },
      }),
    ]);
    renderWithProviders(<A79BaselineChildFill groupId={GROUP} childId={ANU} />);
    await screen.findByRole("table", { name: "Мэдлэг" });
    const checked = (within(table("Мэдлэг")).getAllByRole("radio") as HTMLInputElement[]).filter(
      (r) => r.checked,
    );
    expect(checked.map((r) => r.getAttribute("aria-label")?.slice(-1))).toEqual([
      "1",
      "1",
      "1",
      ...Array(8).fill("0"),
    ]);
  });

  it("opens a recorded response with its blanks not met, and saves it whole", async () => {
    // A response from the wizard's sheet, from before every answer was required.
    const api = stubSheet([
      row(ANU, "Ану", {
        response: {
          id: "88888888-8888-4888-8888-888888888888",
          submittedAt: "2026-09-22T00:00:00Z",
          respondent: {
            id: "99999999-9999-4999-8999-999999999999",
            lastName: "Б",
            firstName: "Багш",
          },
          answers: [{ questionId: domainIds("Мэдлэг")[0]!, value: "1" }],
        },
      }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<A79BaselineChildFill groupId={GROUP} childId={ANU} />);
    // Opened whole: every criterion marked, the blanks «0».
    await screen.findByRole("table", { name: "Мэдлэг" });
    expect(
      (within(table("Мэдлэг")).getAllByRole("radio") as HTMLInputElement[]).filter(
        (r) => r.checked,
      ),
    ).toHaveLength(8 + 3);

    await user.click(cell("Мэдлэг", 2, "1"));
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));
    await waitFor(() => {
      const saved = api.calls.find(
        (c) => c.method === "PUT" && c.url === `/surveys/${SURVEY_ID}/teacher-sheet`,
      );
      const answers = (saved?.body as { responses: { answers: { value: string }[] }[] })
        ?.responses[0]?.answers;
      expect(answers).toHaveLength(37);
      expect(answers?.filter((a) => a.value === "1")).toHaveLength(2);
    });
    expect(api.calls.some((c) => c.url.endsWith("/drafts"))).toBe(false);
  });

  it("names two baselines of one level by their date", async () => {
    const second = {
      ...SURVEY,
      id: "45454545-4545-4545-8545-454545454545",
      createdAt: "2026-10-21T00:00:00Z",
    };
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/kindergartens/${KG}/surveys`, body: [SURVEY, second] },
      {
        path: `/surveys/${SURVEY_ID}/teacher-sheet`,
        body: { survey: SURVEY, rows: [row(ANU, "Ану")] },
      },
      {
        path: `/surveys/${second.id}/teacher-sheet`,
        body: { survey: second, rows: [row(ANU, "Ану")] },
      },
    ]);
    renderWithProviders(<A79BaselineChildFill groupId={GROUP} childId={ANU} />);
    const choices = await screen.findByRole("group", { name: "Түвшин" });
    const labels = within(choices)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    expect(labels.every((l) => l?.startsWith("I түвшин · "))).toBe(true);
  });

  it("says so for a child on no baseline", async () => {
    stubSheet([row(BAT, "Тэмүүлэн")]);
    renderWithProviders(<A79BaselineChildFill groupId={GROUP} childId={ANU} />);
    expect(
      await screen.findByText("Энэ хүүхэд гарааны үнэлгээнд ороогүй байна"),
    ).toBeInTheDocument();
  });
});

describe("filling the group in", () => {
  /** 2026-10-27, the user: «Бүлгээр бөглөх» is the table «Судалгаа» fills a survey in with. */
  it("fills the level's baseline in the teacher sheet's table", async () => {
    const api = stubSheet([row(ANU, "Ану"), row(BAT, "Тэмүүлэн")]);
    const user = userEvent.setup();
    renderWithProviders(<A79BaselineGroupFill groupId={GROUP} />);

    expect(await screen.findByText("I түвшин · 2 хүүхэд")).toBeInTheDocument();
    const anu = screen.getAllByRole("radio", { name: "Б.Ану: 1" });
    expect(anu).toHaveLength(37);
    await user.click(anu[0]!);
    await user.click(screen.getByRole("button", { name: /Хадгалах/ }));

    await waitFor(() => {
      const draft = api.calls.find((c) => c.url.endsWith("/teacher-sheet/drafts"));
      expect(draft?.body).toEqual({
        drafts: [{ childId: ANU, answers: [{ questionId: questions[0]!.id, value: "1" }] }],
      });
    });
  });
});
