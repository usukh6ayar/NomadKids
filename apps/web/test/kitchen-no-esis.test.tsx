import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import RecipesPage from "@/app/(app)/kitchen/recipes/page";
import IngredientsPage from "@/app/(app)/kitchen/ingredients/page";

/**
 * No ESIS reference panels on the kitchen screens — client, 2026-10-06. The
 * cards and the store list are written by hand, and no reference is read until
 * the cook presses «ESIS-ээс татах».
 */

const KG = "33333333-3333-4333-8333-333333333333";
const EMPTY = { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 };

function stub() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["COOK"]) },
    { path: `/kindergartens/${KG}/recipes`, body: EMPTY },
    { path: `/kindergartens/${KG}/ingredients`, body: EMPTY },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("kitchen screens without ESIS", () => {
  it("draws the technology cards with no ministry panel", async () => {
    const api = stub();
    renderWithProviders(<RecipesPage />);

    expect(await screen.findByText("Технологийн карт үүсгээгүй байна")).toBeInTheDocument();
    expect(screen.queryByText("Бэлэн бүтээгдэхүүн")).toBeNull();
    expect(screen.queryByText("Бүтээгдэхүүний төрөл")).toBeNull();
    expect(api.calls.some((call) => call.url.includes("/esis/resource"))).toBe(false);
  });

  it("draws the store list with no ministry panel", async () => {
    const api = stub();
    renderWithProviders(<IngredientsPage />);

    expect(await screen.findByText("Орц бүртгэгдээгүй байна")).toBeInTheDocument();
    expect(screen.queryByText("Түүхий эдийн бүлэг")).toBeNull();
    expect(api.calls.some((call) => call.url.includes("/esis/resource"))).toBe(false);
  });
});
