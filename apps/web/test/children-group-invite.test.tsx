import { screen, within } from "@testing-library/react";
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
  function stub(role: "TEACHER" | "ADMIN") {
    stubApi([
      { path: "/auth/me", body: sessionFor([role]) },
      {
        path: "/groups",
        body: { items: [GROUP], page: 1, pageSize: 100, total: 1, totalPages: 1 },
      },
      { path: "/children", body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } },
    ]);
  }

  /*
    ★ 2026-10-17, the user: «Excel · Импорт · Бүлгээр урих · Захиа · Хүүхэд»
    on one phone line, the first three as icons alone. «Импорт» removed
    2026-10-28, the user.
  */
  it("reads «Excel · Бүлгээр урих · Захиа · Хүүхэд», the first two icons on a phone", async () => {
    stub("TEACHER");
    renderWithProviders(<ChildrenPage />);

    const invite = await screen.findByRole("button", { name: "Бүлгээр урих" });
    const letter = screen.getByRole("button", { name: "Захиа" });
    // «Хүүхэд бүртгэх» reads «Хүүхэд» since 2026-10-06.
    const register = screen.getByRole("link", { name: "Хүүхэд" });
    expect(invite.nextElementSibling).toBe(letter);
    expect(letter.nextElementSibling).toBe(register);

    for (const [control, word] of [
      [screen.getByRole("link", { name: "Excel" }), "Excel"],
      [invite, "Бүлгээр урих"],
    ] as const) {
      expect(within(control).getByText(word)).toHaveClass("max-sm:sr-only");
    }
    expect(screen.queryByRole("link", { name: "Импорт" })).toBeNull();
    for (const control of [letter, register]) {
      expect(control).toHaveClass("max-sm:text-compact", "max-sm:flex-auto", "max-sm:px-1.5");
    }
  });

  it("gives a director no «Захиа»", async () => {
    stub("ADMIN");
    renderWithProviders(<ChildrenPage />);

    await screen.findByRole("link", { name: "Excel" });
    expect(screen.queryByRole("button", { name: "Захиа" })).not.toBeInTheDocument();
  });
});
