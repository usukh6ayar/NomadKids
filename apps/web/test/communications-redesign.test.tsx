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
import { SurveyBoard } from "@/components/survey/survey-board";
import { SelectedChildProvider } from "@/lib/selected-child";

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.removeItem("nomadkids.selectedChildId");
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

  it("shows surveys only for the child selected in the parent menu", async () => {
    const user = userEvent.setup();
    const firstId = "11111111-1111-4111-8111-111111111112";
    const selectedId = "22222222-2222-4222-8222-222222222223";
    window.localStorage.setItem("nomadkids.selectedChildId", selectedId);

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: "/children/mine",
        body: [
          {
            id: firstId,
            firstName: "Тэмүүлэн",
            lastName: "Болд",
            dateOfBirth: "2021-01-01",
          },
          {
            id: selectedId,
            firstName: "Батбаяр",
            lastName: "Ганболд",
            dateOfBirth: "2020-01-01",
          },
        ],
      },
      { path: `/children/${selectedId}/surveys`, body: [] },
      {
        path: "/notifications",
        body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 },
      },
    ]);

    renderWithProviders(
      <SelectedChildProvider myChildIds={[firstId, selectedId]}>
        <NotificationsPage />
      </SelectedChildProvider>,
    );

    await user.click(await screen.findByRole("tab", { name: /Судалгаа/ }));
    await screen.findByText("Идэвхтэй судалгаа алга");

    expect(screen.queryByRole("group", { name: "Хүүхэд сонгох" })).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.startsWith(`/children/${selectedId}/surveys`))).toBe(true);
    expect(calls.some((call) => call.url.startsWith(`/children/${firstId}/surveys`))).toBe(false);
  });

  it("groups staff survey status, search, and category controls into one toolbar", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/kindergartens/${KINDERGARTEN_ID}/surveys`, body: [] },
    ]);

    const { container } = renderWithProviders(<SurveyBoard kind="FORM" />);

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
      within(toolbar as HTMLElement).queryByRole("group", { name: "Судалгааны ангиллаар шүүх" }),
    ).not.toBeInTheDocument();

    await userEvent.setup().click(filters);

    // Two rows carry a "Бүгд" now — one for the kind, one for the category —
    // so the assertion names which row it means.
    const categories = within(toolbar as HTMLElement).getByRole("group", {
      name: "Судалгааны ангиллаар шүүх",
    });
    expect(within(categories).getByRole("button", { name: "Бүгд" })).toBeVisible();

    await waitFor(() => expect(screen.getByText("Судалгаа алга")).toBeInTheDocument());
    expect(container.querySelectorAll('[data-ui="communications-toolbar"]')).toHaveLength(1);
  });
});
