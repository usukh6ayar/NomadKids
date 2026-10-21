import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { A79_LEVELS } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import {
  A79BaselineKindergartenPanel,
  A79BaselinePanel,
} from "@/components/assessment/a79-baseline";
import { baselineSummary, mergeBaselines } from "@/lib/a79-baseline";
import { a79Questions } from "@/lib/a79-assessment";

/*
 * «Гарааны үнэлгээ» — the А/79 baseline survey read as the result screen
 * reads a result (2026-10-21). The rules: questions match criteria by text,
 * not position; a «1» is a criterion met; an unsent row is «бөглөөгүй».
 */
afterEach(() => vi.unstubAllGlobals());

const level = A79_LEVELS[0]!;
const questions = a79Questions(level).map((q, i) => ({ id: `q${i}`, prompt: q.prompt }));

describe("baselineSummary", () => {
  it("counts a «1» as met, by domain, and an unsent row as not filled", () => {
    const answers = questions.map((q, i) => ({ questionId: q.id, value: i < 3 ? "1" : "0" }));
    const summary = baselineSummary(questions, [
      {
        child: { id: "c1", firstName: "Намуун", lastName: "Дорж" },
        response: { submittedAt: "2026-09-15T00:00:00Z", answers },
      },
      { child: { id: "c2", firstName: "Тэмүүлэн", lastName: "Бат" }, response: null },
    ])!;
    expect(summary.level).toBe("I");
    expect(summary.unmatched).toBe(0);
    const [filled, empty] = summary.children;
    expect(filled!.achieved).toBe(3);
    expect(filled!.total).toBe(level.criteria.length);
    expect(filled!.byDomain.reduce((s, d) => s + d.total, 0)).toBe(level.criteria.length);
    expect(empty!.notFilled).toBe(true);
    expect(summary.lastSubmittedAt).toBe("2026-09-15T00:00:00Z");
  });

  it("matches by text, so a reordered survey scores the same, and counts a reworded one out", () => {
    const reordered = [...questions].reverse();
    const reworded = [{ ...questions[0]!, prompt: "Өөрчилсөн асуулт" }, ...questions.slice(1)];
    expect(baselineSummary(reordered, [])!.unmatched).toBe(0);
    expect(baselineSummary(reworded, [])!.unmatched).toBe(1);
  });

  it("still counts a criterion whose spelling was corrected after the survey was made", () => {
    // #211 changed «Үндсэний» to «Үндэсний»; older surveys keep the old text.
    const old = questions.map((q) =>
      q.prompt.includes("Үндэсний хувцас")
        ? { ...q, prompt: q.prompt.replace("Үндэсний", "Үндсэний") }
        : q,
    );
    expect(old.some((q) => q.prompt.includes("Үндсэний"))).toBe(true);
    const summary = baselineSummary(old, [])!;
    expect(summary.unmatched).toBe(0);
  });

  it("does not take a reworded question for a criterion", () => {
    const changed = questions.map((q, i) =>
      i === 0 ? { ...q, prompt: `${q.prompt.split(":")[0]}: Огт өөр асуулт бичсэн байна.` } : q,
    );
    expect(baselineSummary(changed, [])!.unmatched).toBe(1);
  });

  it("is nothing for a survey that is not А/79", () => {
    expect(baselineSummary([{ id: "x", prompt: "Хоол таалагдсан уу?" }], [])).toBeNull();
  });
});

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "55555555-5555-4555-8555-555555555555";
const SURVEY = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "А/79 Гарааны үнэлгээ — I түвшин",
  description: null,
  category: "OTHER",
  scope: "CHILD",
  kind: "FORM",
  respondent: "TEACHER",
  status: "PUBLISHED",
  period: "BASELINE",
  groupId: GROUP,
  group: { id: GROUP, name: "Дэлбээ" },
  questions: questions.map((q, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    type: "SINGLE_CHOICE",
    prompt: q.prompt,
    options: ["0", "1"],
    required: true,
    order: i,
  })),
  createdAt: "2026-09-10T00:00:00Z",
  publishedAt: "2026-09-10T00:00:00Z",
  closedAt: null,
};

describe("mergeBaselines — one class, two levels", () => {
  // 2026-10-21, the user: the teacher picks five children for the IV-level
  // survey and seven for the III; the report shows all twelve.
  const iv = a79Questions(A79_LEVELS[3]!).map((q, i) => ({ id: `iv${i}`, prompt: q.prompt }));
  const iii = a79Questions(A79_LEVELS[2]!).map((q, i) => ({ id: `iii${i}`, prompt: q.prompt }));
  const kids = Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, firstName: `Хүүхэд${i}` }));
  const sent = (qs: { id: string }[]) => ({
    submittedAt: "2026-09-15T00:00:00Z",
    answers: qs.map((q) => ({ questionId: q.id, value: "1" })),
  });

  it("gives each child the level of the survey they were filled in", () => {
    const merged = mergeBaselines([
      {
        questions: iv,
        rows: kids.map((child, i) => ({ child, response: i < 5 ? sent(iv) : null })),
      },
      {
        questions: iii,
        rows: kids.map((child, i) => ({ child, response: i >= 5 ? sent(iii) : null })),
      },
    ])!;
    expect(merged.children).toHaveLength(12);
    expect(merged.children.filter((c) => !c.notFilled)).toHaveLength(12);
    expect(merged.byLevel).toEqual([
      { level: "III", count: 7 },
      { level: "IV", count: 5 },
    ]);
    expect(merged.children[0]!.level).toBe("IV");
    expect(merged.children[11]!.level).toBe("III");
  });

  it("leaves an absent child unassessed — no level guessed, no figures", () => {
    const merged = mergeBaselines([
      {
        questions: iv,
        rows: kids.map((child, i) => ({ child, response: i < 5 ? sent(iv) : null })),
      },
    ])!;
    const absent = merged.children.filter((c) => c.notFilled);
    expect(absent).toHaveLength(7);
    expect(absent.every((c) => c.achieved === 0 && c.submittedAt === null)).toBe(true);
  });

  it("takes the later of two surveys for a child and says so", () => {
    const later = { ...sent(iii), submittedAt: "2026-09-20T00:00:00Z" };
    const merged = mergeBaselines([
      { questions: iv, rows: [{ child: kids[0]!, response: sent(iv) }] },
      { questions: iii, rows: [{ child: kids[0]!, response: later }] },
    ])!;
    expect(merged.children[0]!.level).toBe("III");
    expect(merged.children[0]!.assessedTwice).toBe(true);
  });
});

describe("the baseline panel", () => {
  it("says how to start when the group has no baseline survey", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/kindergartens/${KG}/surveys`, body: [] },
    ]);
    renderWithProviders(<A79BaselinePanel groupId={GROUP} />);
    expect(await screen.findByText("Гарааны үнэлгээ хараахан аваагүй байна")).toBeInTheDocument();
  });

  it("draws the group's baseline with the result screen's table", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/kindergartens/${KG}/surveys`, body: [SURVEY] },
      {
        path: `/surveys/${SURVEY.id}/teacher-sheet`,
        body: {
          survey: SURVEY,
          rows: [
            {
              child: {
                id: "77777777-7777-4777-8777-777777777777",
                firstName: "Намуун",
                lastName: "Дорж",
              },
              group: { id: GROUP, name: "Дэлбээ" },
              response: {
                id: "88888888-8888-4888-8888-888888888888",
                submittedAt: "2026-09-15T00:00:00Z",
                respondent: {
                  id: "99999999-9999-4999-8999-999999999999",
                  lastName: "Б",
                  firstName: "Багш",
                },
                answers: SURVEY.questions.map((q) => ({ questionId: q.id, value: "1" })),
              },
            },
            {
              child: {
                id: "66666666-6666-4666-8666-666666666666",
                firstName: "Тэмүүлэн",
                lastName: "Бат",
              },
              group: { id: GROUP, name: "Дэлбээ" },
              response: null,
            },
          ],
        },
      },
    ]);
    renderWithProviders(<A79BaselinePanel groupId={GROUP} />);
    expect(await screen.findByText("Д.Намуун")).toBeInTheDocument();
    expect(screen.getByText(/1\/2 хүүхэд үнэлэгдсэн · I түвшин 1/)).toBeInTheDocument();
    expect(screen.getByText("Гарааны үнэлгээнд хамрагдаагүй: Б.Тэмүүлэн")).toBeInTheDocument();
    // Never a nudge to fill a row for a child who was absent.
    expect(screen.queryByRole("link", { name: /Бөглөх/ })).toBeNull();
    // The name is not a link: a child's page is their result, not this survey.
    expect(screen.queryByRole("link", { name: "Д.Намуун" })).toBeNull();
  });
});

describe("the baseline panel — the two rules a review found (2026-10-21)", () => {
  const NAMUUN = "77777777-7777-4777-8777-777777777777";
  const OTHER_GROUP_CHILD = "12121212-1212-4121-8121-121212121212";
  const sent = {
    id: "88888888-8888-4888-8888-888888888888",
    submittedAt: "2026-09-15T00:00:00Z",
    respondent: { id: "99999999-9999-4999-8999-999999999999", lastName: "Б", firstName: "Багш" },
    answers: SURVEY.questions.map((q) => ({ questionId: q.id, value: "1" })),
  };

  it("withholds an unpaid solo child's figures, as the result screen does", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/kindergartens/${KG}/surveys`, body: [SURVEY] },
      {
        path: `/groups/${GROUP}/a79-summary`,
        body: {
          children: [
            {
              childId: NAMUUN,
              firstName: "Намуун",
              lastName: "Дорж",
              level: "I",
              feeDue: true,
              achieved: 0,
              total: 0,
              byDomain: [],
            },
          ],
        },
      },
      {
        path: `/surveys/${SURVEY.id}/teacher-sheet`,
        body: {
          survey: SURVEY,
          rows: [
            {
              child: { id: NAMUUN, firstName: "Намуун", lastName: "Дорж" },
              group: { id: GROUP, name: "Дэлбээ" },
              response: sent,
            },
          ],
        },
      },
    ]);
    renderWithProviders(<A79BaselinePanel groupId={GROUP} />);
    expect(await screen.findByText("Төлбөр төлөгдөөгүй")).toBeInTheDocument();
    expect(screen.queryByText("100%")).toBeNull();
    expect(screen.queryByText(/Гарааны дундаж/)).toBeNull();
  });

  it("counts a survey addressed to every group, keeping this group's children", async () => {
    const everyGroup = { ...SURVEY, groupId: null, group: null };
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: `/kindergartens/${KG}/surveys`, body: [everyGroup] },
      {
        path: `/surveys/${SURVEY.id}/teacher-sheet`,
        body: {
          survey: everyGroup,
          rows: [
            {
              child: { id: NAMUUN, firstName: "Намуун", lastName: "Дорж" },
              group: { id: GROUP, name: "Дэлбээ" },
              response: sent,
            },
            {
              child: { id: OTHER_GROUP_CHILD, firstName: "Сувд", lastName: "Гэрэл" },
              group: { id: "13131313-1313-4131-8131-131313131313", name: "Нар" },
              response: sent,
            },
          ],
        },
      },
    ]);
    renderWithProviders(<A79BaselinePanel groupId={GROUP} />);
    expect(await screen.findByText("Д.Намуун")).toBeInTheDocument();
    expect(screen.queryByText("Г.Сувд")).toBeNull();
    expect(screen.getByText(/1\/1 хүүхэд үнэлэгдсэн/)).toBeInTheDocument();
  });
});

describe("the director's baseline — the groups first (2026-10-22)", () => {
  it("draws one row per group, links it to the group's baseline, and names a group without one", async () => {
    const EMPTY_GROUP = "14141414-1414-4141-8141-141414141414";
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: `/kindergartens/${KG}/surveys`, body: [SURVEY] },
      {
        path: `/surveys/${SURVEY.id}/teacher-sheet`,
        body: {
          survey: SURVEY,
          rows: [
            {
              child: {
                id: "77777777-7777-4777-8777-777777777777",
                firstName: "Намуун",
                lastName: "Дорж",
              },
              group: { id: GROUP, name: "Дэлбээ" },
              response: {
                id: "88888888-8888-4888-8888-888888888888",
                submittedAt: "2026-09-15T00:00:00Z",
                respondent: {
                  id: "99999999-9999-4999-8999-999999999999",
                  lastName: "Б",
                  firstName: "Багш",
                },
                answers: SURVEY.questions.map((q) => ({ questionId: q.id, value: "1" })),
              },
            },
            {
              child: {
                id: "66666666-6666-4666-8666-666666666666",
                firstName: "Тэмүүлэн",
                lastName: "Бат",
              },
              group: { id: GROUP, name: "Дэлбээ" },
              response: null,
            },
          ],
        },
      },
    ]);
    renderWithProviders(
      <A79BaselineKindergartenPanel
        groups={[
          { id: GROUP, name: "Дэлбээ" },
          { id: EMPTY_GROUP, name: "Солонго" },
        ]}
      />,
    );
    const link = await screen.findByRole("link", { name: "Дэлбээ" });
    expect(link).toHaveAttribute("href", `/groups/${GROUP}/baseline`);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("Гарааны үнэлгээ аваагүй")).toBeInTheDocument();
    // No child's name on the director's overview.
    expect(screen.queryByText("Д.Намуун")).toBeNull();
  });
});
