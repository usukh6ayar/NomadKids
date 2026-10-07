import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import ChildrenPage from "@/app/(app)/children/page";

/**
 * «Бүлгээр урих» before «Хүүхэд бүртгэх» on the teacher's «Суралцагч» —
 * client, 2026-10-06.
 */

const GROUP = { id: "44444444-4444-4444-8444-444444444444", name: "Дэлбээ бүлэг" };

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("the teacher's roster header", () => {
  it("offers «Бүлгээр урих» just before «Хүүхэд», all four small on a phone", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups",
        body: { items: [GROUP], page: 1, pageSize: 100, total: 1, totalPages: 1 },
      },
      { path: "/children", body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } },
    ]);
    renderWithProviders(<ChildrenPage />);

    const invite = await screen.findByRole("button", { name: "Бүлгээр урих" });
    // «Хүүхэд бүртгэх» reads «Хүүхэд» since 2026-10-06.
    const register = screen.getByRole("link", { name: "Хүүхэд" });
    expect(invite.nextElementSibling).toBe(register);

    // On a phone the four fill one line exactly (13px type, shared width).
    for (const control of [
      screen.getByRole("link", { name: "Excel" }),
      screen.getByRole("link", { name: "Импорт" }),
      invite,
      register,
    ]) {
      expect(control).toHaveClass("max-sm:text-compact", "max-sm:flex-auto", "max-sm:px-1.5");
    }
  });
});
