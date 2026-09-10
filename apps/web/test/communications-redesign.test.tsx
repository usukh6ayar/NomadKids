import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import NotificationsPage from "@/app/(app)/notifications/page";
import SurveysPage from "@/app/(app)/surveys/page";

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

describe("communications redesign", () => {
  it("keeps the parent news and survey navigation inside one compact toolbar", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: "/children/mine", body: [] },
      {
        path: "/notifications",
        body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 },
      },
    ]);

    const { container } = renderWithProviders(<NotificationsPage />);

    const tabs = await screen.findByRole("tablist", { name: "Мэдээ эсвэл судалгаа" });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(2);
    expect(tabs).toHaveAttribute("data-ui", "communication-tabs");
    expect(tabs.closest('[data-ui="communications-toolbar"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-ui="communications-toolbar"]')).toHaveLength(1);
  });

  it("groups staff survey status, search, and category controls into one toolbar", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: [] },
    ]);

    const { container } = renderWithProviders(<SurveysPage />);

    const tabs = await screen.findByRole("tablist", { name: "Судалгааны төлөв" });
    const toolbar = tabs.closest('[data-ui="communications-toolbar"]');

    expect(toolbar).not.toBeNull();
    expect(
      within(toolbar as HTMLElement).getByRole("searchbox", { name: "Судалгаа хайх" }),
    ).toBeVisible();
    // The six categories fold behind the filter icon now, the same shape the
    // class board uses — so they are in the toolbar but not on screen until
    // it is opened.
    const filters = within(toolbar as HTMLElement).getByRole("button", { name: "Шүүлтүүр" });
    // `hidden` takes the panel out of the accessibility tree, so the chips are
    // not merely invisible — `getByRole` cannot reach them at all.
    expect(
      within(toolbar as HTMLElement).queryByRole("button", { name: "Бүгд" }),
    ).not.toBeInTheDocument();

    await userEvent.setup().click(filters);
    expect(within(toolbar as HTMLElement).getByRole("button", { name: "Бүгд" })).toBeVisible();

    await waitFor(() => expect(screen.getByText("Судалгаа алга")).toBeInTheDocument());
    expect(container.querySelectorAll('[data-ui="communications-toolbar"]')).toHaveLength(1);
  });
});
