import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import ChildrenImportPage from "@/app/(app)/children/import/page";

/**
 * One fixed template — 2026-10-18, the user: «яг нэг тогтсон загвартай»; a
 * teacher downloads it, writes their own children in, and uploads it.
 */
describe("the roster import", () => {
  it("offers the one template, and names its columns", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    renderWithProviders(<ChildrenImportPage />);

    expect(await screen.findByRole("link", { name: /Загвар татах/ })).toHaveAttribute(
      "href",
      "/templates/huuhdiin-burtgel-zagvar.xlsx",
    );
    expect(
      screen.getByText("№ · Овог · Нэр · Регистр · Төрсөн огноо · Хүйс · Бүлэг"),
    ).toBeInTheDocument();
  });
});
