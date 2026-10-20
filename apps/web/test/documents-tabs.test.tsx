import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import DocumentsPage from "@/app/(app)/documents/page";

/*
 * «Баримт бичгийн сан» — two libraries in two tabs (2026-10-20, the user):
 * the kindergarten's own and the ministry's. A teacher keeps the materials.
 */
afterEach(() => vi.unstubAllGlobals());

describe("the document library's tabs", () => {
  it("gives a teacher three tabs and opens the ministry's register on «Үндсэн»", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    renderWithProviders(<DocumentsPage />);

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Цэцэрлэгийн баримт бичиг",
      "Үндсэн баримт бичиг",
      "Сургалтын хэрэглэгдэхүүн",
    ]);

    await user.click(screen.getByRole("tab", { name: "Үндсэн баримт бичиг" }));
    expect(await screen.findByRole("heading", { name: /Яамны хөтөлбөр, журам/ })).toBeVisible();
  });

  it("shows the ministry's register as a list, and remembers it", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    renderWithProviders(<DocumentsPage />);
    await user.click(await screen.findByRole("tab", { name: "Үндсэн баримт бичиг" }));

    // A grid shows one shelf's worth; a list shows every row at once.
    const before = screen.getAllByRole("link").length;
    await user.click(screen.getByRole("button", { name: "Жагсаалтаар" }));
    expect(screen.getByRole("button", { name: "Жагсаалтаар" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByRole("link").length).toBeGreaterThan(before);
    expect(window.localStorage.getItem("nk.documents.view")).toBe("list");
  });

  it("keeps the kindergarten's filters folded and no empty «Таалагдсан»", async () => {
    window.localStorage.removeItem("nk.documents.view");
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/kindergartens/",
        body: { items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 },
      },
    ]);
    renderWithProviders(<DocumentsPage />);
    expect(await screen.findByRole("searchbox", { name: "Баримтын нэрээр хайх" })).toBeVisible();
    // Ангилал and Эрэмбэ wait behind the filter button.
    expect(screen.getByLabelText("Ангиллаар шүүх")).not.toBeVisible();
    expect(screen.queryByRole("region", { name: "Таалагдсан" })).toBeNull();
  });

  it("gives a director the two libraries and no shop", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN"]) }]);
    renderWithProviders(<DocumentsPage />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Цэцэрлэгийн баримт бичиг",
      "Үндсэн баримт бичиг",
    ]);
  });
});
