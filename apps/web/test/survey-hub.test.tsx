import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import SurveysHubPage from "@/app/(app)/surveys/page";

/**
 * Судалгаа, асуулга — the hub, 2026-09-10.
 *
 * ★ A screen whose whole job is a choice, so what is asserted is the choice.
 *
 * The two kinds shared one page behind a tab strip until this drawing arrived
 * and the client wrote "Энэ 2 тусдаа байх ёстой". The two links below are the
 * whole of that request; if they ever point at the same route, or one of them
 * disappears, the separation is gone and every other survey test still passes.
 *
 * ★★ The recent list is why this is not merely a menu. A hub of two links
 * costs a tap and answers nothing; "Сүүлийн үүсгэсэн" makes the landing worth
 * arriving at, and it links straight at the survey rather than routing through
 * whichever list it belongs to.
 */

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";

const FORM = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Намрын эцэг эхийн уулзалт",
  description: null,
  category: "SATISFACTION",
  scope: "CHILD",
  kind: "FORM",
  status: "PUBLISHED",
  questions: [],
  group: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  publishedAt: "2026-09-02T00:00:00.000Z",
  closedAt: null,
};

const POLL = {
  ...FORM,
  id: "33333333-3333-4333-8333-333333333333",
  title: "Зугаалгын санал",
  kind: "POLL",
  status: "DRAFT",
};

function stubHub(items: Record<string, unknown>[] = [FORM, POLL]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: items },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

describe("the survey hub", () => {
  it("sends each kind to its own screen", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    const form = await screen.findByRole("link", { name: /Судалгаа/ });
    const poll = screen.getByRole("link", { name: /Асуулга/ });

    expect(form).toHaveAttribute("href", "/surveys/forms");
    expect(poll).toHaveAttribute("href", "/surveys/polls");
  });

  /** Each card carries the one line that says what the kind is for. */
  it("says what distinguishes the two", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    // `SURVEY_KIND_HINT`, not a second wording invented for this screen — the
    // create dialog prints the same line, and two copies would drift.
    expect(await screen.findByText("Олон асуулт, дэлгэрэнгүй хариулт")).toBeInTheDocument();
    expect(screen.getByText("Нэг асуулт, шууд дүн")).toBeInTheDocument();
  });

  it("links the recent surveys straight at themselves", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    const recent = await screen.findByRole("link", { name: new RegExp(FORM.title) });
    expect(recent).toHaveAttribute("href", `/surveys/${FORM.id}`);
  });

  /**
   * ★ Both kinds appear in the recent list.
   *
   * It is the one place on the product where the two sit together, and that is
   * the point: what a teacher comes back for is usually what they made last,
   * whichever kind it was. Filtering it by kind would put the newest thing one
   * guess away.
   */
  it("mixes both kinds in what was made last", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    expect(await screen.findByText(FORM.title)).toBeInTheDocument();
    expect(screen.getByText(POLL.title)).toBeInTheDocument();
  });

  it("names each recent survey's state", async () => {
    stubHub();
    renderWithProviders(<SurveysHubPage />);

    const draft = (await screen.findByText(POLL.title)).closest("a")!;
    expect(within(draft).getByText("Ноорог")).toBeInTheDocument();
  });

  /** §5 — an empty state says what to do next. */
  it("tells a new kindergarten where to start", async () => {
    stubHub([]);
    renderWithProviders(<SurveysHubPage />);

    expect(await screen.findByText("Хараахан юу ч үүсгээгүй байна")).toBeInTheDocument();
  });
});
