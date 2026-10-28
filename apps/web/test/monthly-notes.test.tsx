import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { MonthlyNotes } from "@/components/assessment/monthly-notes";

/**
 * «Сарын тэмдэглэл» — the lead teacher's month of the group's notes, 2026-10-28.
 *
 * ★ Who may see it is the server's answer, not this component's: a 404 from
 * `GET /groups/:id/observations` must leave nothing on the screen.
 */

const GROUP_ID = "44444444-4444-4444-8444-444444444444";

const note = (id: string, childId: string, firstName: string, childDid: string) => ({
  id,
  childId,
  observedOn: "2026-10-14",
  observedTime: null,
  activityName: "Тойргийн цаг",
  situation: null,
  childDid,
  childSaid: null,
  teacherComment: null,
  nextSteps: null,
  child: { id: childId, lastName: "Бат", firstName },
  type: { id: "11111111-1111-4111-8111-111111111111", name: "Ажиглалт", code: "daily" },
  indicator: null,
  indicatorLevel: null,
  author: null,
  domains: [],
  photo: null,
  a79Links: [],
});

const PAGE = {
  items: [
    {
      ...note(
        "a0000000-0000-4000-8000-000000000000",
        "c0000000-0000-4000-8000-000000000000",
        "Анар",
        "Шувуу зурав",
      ),
      type: { id: "55555555-5555-4555-8555-555555555555", name: "Бүтээл", code: "artwork" },
      photo: { id: "f0000000-0000-4000-8000-000000000000", caption: "Шувуу" },
      a79Links: [{ level: "II", number: 2, status: "SUPPORTED" }],
    },
    note(
      "a1111111-1111-4111-8111-111111111111",
      "c1111111-1111-4111-8111-111111111111",
      "Сарнай",
      "Цамхаг барив",
    ),
    note(
      "a2222222-2222-4222-8222-222222222222",
      "c1111111-1111-4111-8111-111111111111",
      "Сарнай",
      "Дуу дуулав",
    ),
    note(
      "a3333333-3333-4333-8333-333333333333",
      "c2222222-2222-4222-8222-222222222222",
      "Тэмүүлэн",
      "Ном уншив",
    ),
  ],
  page: 1,
  pageSize: 100,
  total: 4,
  totalPages: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("monthly notes", () => {
  it("shows the month's total folded, and every note once opened", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP_ID}/observations`, body: PAGE },
    ]);
    renderWithProviders(<MonthlyNotes groupId={GROUP_ID} startYear={2026} />);

    expect(await screen.findByText("Нийт 4 тэмдэглэл")).toBeInTheDocument();
    expect(screen.queryByText("Цамхаг барив")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("Цамхаг барив")).toBeInTheDocument();
    expect(screen.getByText("Ном уншив")).toBeInTheDocument();
    // Grouped by child: Сарнай's two notes sit under one heading.
    expect(screen.getByText("2 тэмдэглэл")).toBeInTheDocument();

    // The kind of note, its one photo, and the А/79 criterion it evidences.
    expect(screen.getByText("Бүтээл")).toBeInTheDocument();
    expect(screen.getAllByText("Ажиглалт")).toHaveLength(3);
    expect(screen.getByRole("img", { name: "Шувуу" })).toBeInTheDocument();
    // The А/79 code in the corner; the criterion itself on hover.
    const code = screen.getByText("А/79 · II · Ш2");
    expect(code).toHaveAttribute("title", expect.stringContaining("— Ахиж байна"));
  });

  it("renders nothing for anyone but the lead teacher", async () => {
    const api = stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    const { container } = renderWithProviders(<MonthlyNotes groupId={GROUP_ID} startYear={2026} />);

    await waitFor(() =>
      expect(api.calls.some((call) => call.url.includes("/observations"))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText(/Бүлгийн явцын үнэлгээ/)).not.toBeInTheDocument());
    expect(container.textContent).toBe("");
  });
});
