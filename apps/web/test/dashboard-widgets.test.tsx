import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { ClassBoardNotice } from "@/components/dashboard/class-board-notice";
import { GenderRatio } from "@/components/dashboard/gender-ratio";
import { MonthBirthdays } from "@/components/dashboard/month-birthdays";

/**
 * The three widgets from the client's sketch that had data behind them.
 *
 * ★ Four of the eight drawn did not, and are absent by decision rather than by
 * omission: attendance (30/35), the meal menu, the survey and chat have no
 * model anywhere in the schema. What is asserted here is that the four we did
 * build report what the database actually holds.
 */

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("эр эм харьцаа", () => {
  it("states both counts and their shares", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children/summary", body: { total: 32, averageAgeMonths: 41, boys: 14, girls: 18 } },
    ]);

    renderWithProviders(<GenderRatio />);

    expect(await screen.findByText("14")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("44%")).toBeInTheDocument();
    expect(screen.getByText("56%")).toBeInTheDocument();
  });

  /**
   * ★ The bar's proportions are the only thing its shape conveys, and a screen
   * reader cannot see proportions — so both counts are in its accessible name.
   */
  it("names the split for a screen reader", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children/summary", body: { total: 32, averageAgeMonths: 41, boys: 14, girls: 18 } },
    ]);

    renderWithProviders(<GenderRatio />);

    expect(await screen.findByRole("img", { name: "14 хүү, 18 охин" })).toBeInTheDocument();
  });

  /**
   * ★★ The share is taken over the children who have a recorded sex, not over
   * the roster. A child with neither value belongs to no segment, and dividing
   * by the roster would draw a gap that stands for nothing a reader could name.
   */
  it("renders nothing when no child has a recorded sex", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children/summary", body: { total: 5, averageAgeMonths: 41, boys: 0, girls: 0 } },
    ]);

    const { container } = renderWithProviders(<GenderRatio />);

    // Wait for the answer to land before asserting on its absence — checking
    // immediately would pass while the query was still in flight, which is the
    // one state where every version of this component renders nothing.
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith("/children/summary"))).toBe(true),
    );
    expect(container.querySelector("section")).toBeNull();
  });
});

describe("энэ сард төрсөн хүүхдүүд", () => {
  const birthdays = [
    {
      id: "44444444-4444-4444-8444-444444444444",
      lastName: "Ганболд",
      firstName: "Мишээл",
      dateOfBirth: "2021-08-01",
      photoMediaFileId: null,
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      lastName: "Доржийн",
      firstName: "Хишиг",
      dateOfBirth: "2022-08-07",
      photoMediaFileId: null,
    },
  ];

  it("lists the month's children with the day, not a countdown", () => {
    render(<MonthBirthdays birthdays={birthdays} />);

    expect(screen.getByText("8/01")).toBeInTheDocument();
    expect(screen.getByText("8/07")).toBeInTheDocument();
    // A relative phrase is re-read every morning; this list is scanned once.
    expect(screen.queryByText(/хоногийн дараа/)).toBeNull();
  });

  /**
   * An empty month is a real and common answer, not a failure — and a card that
   * renders an empty frame to say so is one a teacher learns to skip.
   */
  it("renders nothing when nobody has a birthday this month", () => {
    const { container } = render(<MonthBirthdays birthdays={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ангийн самбар", () => {
  const notice = {
    id: "66666666-6666-4666-8666-666666666666",
    title: "Ангийн хурал",
    body: "2028.09.01-нд ангийн хурал болно.",
    publishedAt: "2026-08-20T00:00:00.000Z",
    isImportant: false,
    readCount: 23,
  };

  it("says how many people opened the notice", () => {
    render(<ClassBoardNotice notice={notice} />);

    // The phrase carries the meaning: a bare number beside an eye icon is a
    // puzzle to anyone who cannot see the eye.
    expect(screen.getByText("23 хүн үзсэн")).toBeInTheDocument();
    expect(screen.getByText("Ангийн хурал")).toBeInTheDocument();
  });

  /**
   * ★ A count, never the readers.
   *
   * `notifications.repository.ts` refuses to expose who reacted — "a parent
   * should not learn which other families are reading the board" — and reads
   * are the same fact about the same people. The contract carries no
   * identities, so there is nothing here for a component to leak; this asserts
   * the shape stays that way.
   */
  it("shows no reader identities", () => {
    const { container } = render(<ClassBoardNotice notice={notice} />);

    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders nothing before anything has been published", () => {
    const { container } = render(<ClassBoardNotice notice={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks an important notice with a label, not only a tint", () => {
    render(<ClassBoardNotice notice={{ ...notice, isImportant: true }} />);

    const badge = screen.getByText("Чухал");
    expect(badge).toBeInTheDocument();
    expect(within(badge).queryByRole("img")).toBeNull();
  });
});
