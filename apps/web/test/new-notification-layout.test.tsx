import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import NewNotificationPage from "@/app/(app)/notifications/new/page";

beforeEach(() => {
  vi.clearAllMocks();
  stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: "/groups",
      body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
    },
  ]);
});

describe("new notification mobile layout", () => {
  it("keeps the complete form in compact two-column groups", async () => {
    renderWithProviders(<NewNotificationPage />);

    expect(await screen.findByRole("heading", { name: "Шинэ мэдэгдэл" })).toBeInTheDocument();
    expect(screen.getByTestId("notice-compact-fields")).toHaveClass("grid-cols-2");
    expect(screen.getByTestId("notice-compact-actions")).toHaveClass("grid-cols-2");

    expect(screen.getByText("Төрөл")).toBeInTheDocument();
    expect(screen.getByText("Гарчиг")).toBeInTheDocument();
    expect(screen.getByText("Дэлгэрэнгүй")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Бичих")).toHaveClass("min-h-[80px]");
    expect(screen.getByText("Хэнд харагдах")).toBeInTheDocument();
    expect(screen.queryByText(/заавал биш/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Огноо, цаг, юу авчрахыг бичнэ үү/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Бүх бүлгийн эцэг эхэд харагдана/)).not.toBeInTheDocument();
    expect(screen.queryByText(/JPEG, PNG эсвэл WebP/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/жагсаалтын дээд талд тэмдэглэгээтэй харагдана/),
    ).not.toBeInTheDocument();

    const important = screen.getByRole("checkbox", { name: "Чухал" });
    expect(important.closest("label")).toHaveClass("bg-surface", "border-border");
    expect(screen.getByRole("button", { name: "Нийтлэх" })).toHaveClass("w-full");
    expect(screen.getByRole("button", { name: "Болих" })).toHaveClass("w-full");
  });
});
