import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setPathname, stubApi } from "./support/render";
import AppLayout from "@/app/(app)/layout";

/*
 * ★ The operator's menu — 2026-10-13, the user: «Самбар» on top, then
 * Байгууллага (Цэцэрлэгүүд, Байгууллагын хүсэлт, Бие даасан багш), Санхүү
 * (Орлого) and Агуулга (Сургалтын хэрэглэгдэхүүн). The two queues carry a red
 * count, read from the list routes' `total`. The grouping itself is pinned in
 * `sidebar.test.tsx`; this file pins every row's destination and the counts.
 */
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => setPathname("/platform"));

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const page = (total: number) => ({ items: [], page: 1, pageSize: 1, total, totalPages: 1 });

function renderMenu(applications: number, solo: number) {
  const api = stubApi([
    { path: "/auth/me", body: operator() },
    { path: "/platform/applications", body: page(applications) },
    { path: "/platform/solo-workspaces", body: page(solo) },
    { path: "/notifications/unread-count", body: { count: 0 } },
  ]);
  renderWithProviders(
    <AppLayout>
      <p>содержимое</p>
    </AppLayout>,
  );
  return api;
}

async function sidebar(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole("navigation", { name: "Үндсэн цэс" }));
}

describe("the operator's menu", () => {
  it("links every row to its own screen", async () => {
    renderMenu(0, 0);
    const nav = await sidebar();

    for (const [name, href] of [
      ["Самбар", "/platform/overview"],
      ["Цэцэрлэгүүд", "/platform"],
      ["Байгууллагын хүсэлт", "/platform/applications"],
      ["Бие даасан багш", "/platform/solo-workspaces"],
      ["Орлого", "/platform/revenue"],
      ["Сургалтын хэрэглэгдэхүүн", "/platform/materials"],
    ]) {
      expect(within(nav).getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute(
        "href",
        href!,
      );
    }
  });

  it("marks the page the operator is on", async () => {
    setPathname("/platform/revenue");
    renderMenu(0, 0);
    const nav = await sidebar();

    expect(within(nav).getByRole("link", { name: /^Орлого/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: /^Цэцэрлэгүүд/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("counts what waits on the two queues, in red", async () => {
    const { calls } = renderMenu(3, 2);
    const nav = await sidebar();

    // The count is read before the label, so the row is found by where it goes.
    const row = (href: string) => nav.querySelector(`a[href="${href}"]`) as HTMLElement;
    const applications = row("/platform/applications");
    expect(await within(applications).findByText("3 хүлээгдэж буй хүсэлт")).toBeInTheDocument();
    const solo = row("/platform/solo-workspaces");
    expect(await within(solo).findByText("2 нэгтгэгдээгүй орчин")).toBeInTheDocument();

    // Only pending applications are counted, one row a page — `total` is all it reads.
    expect(calls.some((call) => call.url.includes("status=PENDING&page=1&pageSize=1"))).toBe(true);
  });

  it("draws no count when nothing is waiting", async () => {
    renderMenu(0, 0);
    const nav = await sidebar();

    await waitFor(() => expect(within(nav).getByRole("link", { name: /^Орлого/ })).toBeVisible());
    expect(within(nav).queryByText(/хүлээгдэж буй хүсэлт/)).toBeNull();
    expect(within(nav).queryByText(/нэгтгэгдээгүй орчин/)).toBeNull();
  });
});
