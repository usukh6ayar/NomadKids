import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import PlatformOverviewPage from "@/app/(app)/platform/overview/page";

/*
 * ★ «Самбар» — the operator's first screen (2026-10-13, the user): what is
 * waiting comes first, counted from the list routes that exist, and nothing
 * is shown for a queue the API cannot count.
 */
afterEach(() => vi.unstubAllGlobals());

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const page = (total: number) => ({ items: [], page: 1, pageSize: 1, total, totalPages: 1 });

describe("the operator's dashboard", () => {
  it("lists what is waiting, each row linking to the work", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: page(3) },
      { path: "/platform/solo-workspaces", body: page(2) },
    ]);
    renderWithProviders(<PlatformOverviewPage />);

    const applications = await screen.findByRole("link", { name: /байгууллагын хүсэлт/ });
    expect(applications).toHaveAttribute("href", "/platform/applications");
    expect(applications).toHaveTextContent("3 байгууллагын хүсэлт хүлээгдэж байна");
    expect(screen.getByRole("link", { name: /бие даасан багш/ })).toHaveAttribute(
      "href",
      "/platform/solo-workspaces",
    );
  });

  it("says nothing is waiting when both queues are empty", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: page(0) },
      { path: "/platform/solo-workspaces", body: page(0) },
    ]);
    renderWithProviders(<PlatformOverviewPage />);

    expect(await screen.findByText("Хүлээгдэж буй ажил алга.")).toBeInTheDocument();
  });
});
