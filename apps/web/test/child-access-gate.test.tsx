import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import ChildLayout from "@/app/(app)/children/[childId]/layout";

const CHILD_ID = "11111111-1111-4111-8111-111111111111";

/**
 * The access gate as a layout — client instruction, 2026-09-01.
 *
 * ★ These tests exist because the gate's correctness is structural, not
 * visual. Fifteen screens sit under `/children/:id`, and the reason the check
 * is a layout rather than a line repeated in each of them is that the
 * sixteenth screen must inherit it by existing. What is pinned here is that
 * the layout intercepts a 402 and passes everything else through — including,
 * deliberately, a 404.
 */

const CHILD_PAGE = <p>Хүүхдийн хуудас</p>;

/**
 * ★ Must satisfy `childDetailSchema`, not merely look like a child.
 *
 * These tests passed with `{ id, firstName, lastName, status }` only because
 * the layout used to render the page regardless of its own query. Once it
 * started waiting, that body failed Zod, the query retried with backoff, and
 * three tests timed out — the fixture had been wrong all along and nothing
 * could see it.
 */
const CHILD = {
  id: CHILD_ID,
  lastName: "Дорж",
  firstName: "Болд",
  dateOfBirth: "2021-04-12",
  enrollments: [],
};

function renderLayout() {
  return renderWithProviders(<ChildLayout>{CHILD_PAGE}</ChildLayout>);
}

const problem = (status: number, detail: string) => ({
  type: "about:blank",
  title: "Алдаа",
  detail,
  status,
  requestId: "test",
});

beforeEach(() => {
  setParams({ childId: CHILD_ID });
});

describe("what the layout does before it knows", () => {
  /**
   * ★ The defect a browser found and these tests had not.
   *
   * The layout used to render `children` while its own query was in flight,
   * on the reasoning that any page under it fetches the child anyway. It does
   * — and it also fetches everything else it needs. A guardian's first visit
   * to a paywalled child produced four requests for the child and three for
   * their surveys, every one a 402, and a flash of the generic error state
   * before the gate replaced it.
   *
   * Rendering one page in a test cannot see a second page's requests, which is
   * why this is asserted on the layout's own output instead.
   */
  it("renders nothing of the page until the gate has an answer", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}`,
        method: "GET",
        body: CHILD,
      },
    ]);

    renderLayout();

    // Synchronously after render, before any await: `fetch` is a promise, so
    // the query is necessarily still pending here. The page must not be
    // mounted yet, or it starts its own requests against a child nobody has
    // been cleared to see.
    expect(screen.queryByText("Хүүхдийн хуудас")).not.toBeInTheDocument();

    expect(await screen.findByText("Хүүхдийн хуудас")).toBeInTheDocument();
  });
});

describe("what the layout intercepts", () => {
  it("replaces the page with the unlock screen on 402", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/access`,
        method: "GET",
        body: {
          required: true,
          active: false,
          amount: "15000.00",
          subscription: null,
        },
      },
      {
        path: `/children/${CHILD_ID}`,
        method: "GET",
        status: 402,
        body: problem(402, "Хандалтын төлбөрөө төлнө үү."),
      },
    ]);

    renderLayout();

    expect(await screen.findByText("Хандалтын төлбөр")).toBeInTheDocument();
    expect(screen.queryByText("Хүүхдийн хуудас")).not.toBeInTheDocument();
  });

  it("lets a 404 through to the page rather than swallowing it", async () => {
    // ★ The asymmetry worth pinning. A 404 has nothing actionable to offer, and
    // only the page knows whether "no such child" should read as an empty
    // portfolio or a missing record. Intercepting it here would take that
    // judgement away from every screen at once.
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}`,
        method: "GET",
        status: 404,
        body: problem(404, "Олдсонгүй."),
      },
    ]);

    renderLayout();

    expect(await screen.findByText("Хүүхдийн хуудас")).toBeInTheDocument();
    expect(screen.queryByText("Хандалтын төлбөр")).not.toBeInTheDocument();
  });

  it("renders the page normally when nothing is owed", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}`,
        method: "GET",
        body: CHILD,
      },
    ]);

    renderLayout();

    expect(await screen.findByText("Хүүхдийн хуудас")).toBeInTheDocument();
  });

  it("shows the page to staff — a family's unpaid fee must not break the classroom", async () => {
    // The API never answers 402 to staff, so the layout simply never fires for
    // them. This proves the arrangement rather than the predicate, which
    // `apps/api/test/portal-access.test.ts` covers on its own side.
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}`,
        method: "GET",
        body: CHILD,
      },
    ]);

    renderLayout();

    expect(await screen.findByText("Хүүхдийн хуудас")).toBeInTheDocument();
  });
});
