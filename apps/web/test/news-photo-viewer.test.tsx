import { screen, within } from "@testing-library/react";
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

/**
 * A post's photographs open large and page through — 2026-10-07, the client:
 * "оруулсан мэдээн дээрх зургуудыг дараа facebook шиг томоор харж болохгүй".
 */

const PHOTOS = [1, 2, 3, 4, 5].map((n) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`,
  caption: `Зураг ${n}`,
}));

function notice() {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    title: "Хэл ярианы хичээл",
    body: "Өнөөдөр үлгэрийн ном уншлаа",
    category: "ACTIVITY",
    status: "PUBLISHED",
    isImportant: false,
    publishedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    author: { id: "77777777-7777-4777-8777-777777777777", firstName: "Сувдаа", lastName: "Дорж" },
    reads: [],
    likeCount: 0,
    likedByMe: false,
    media: PHOTOS,
    targets: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
  stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: "/children/mine", body: [] },
    { path: "/groups", body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } },
    {
      path: "/notifications",
      body: { items: [notice()], page: 1, pageSize: 25, total: 1, totalPages: 1 },
    },
  ]);
});

describe("a post's photographs", () => {
  it("shows four and counts the rest on the fourth", async () => {
    renderWithProviders(<NotificationsPage />);

    expect(await screen.findAllByRole("button", { name: /Зургийг томоор харах/ })).toHaveLength(4);
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("opens the pressed photo large and pages through the whole set", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsPage />);

    await user.click(await screen.findByRole("button", { name: "Зургийг томоор харах (2 / 5)" }));
    const viewer = screen.getByRole("dialog", { name: "Зураг 2" });
    expect(within(viewer).getByText("2 / 5")).toBeInTheDocument();

    await user.click(within(viewer).getByRole("button", { name: "Дараах зураг" }));
    await user.click(screen.getByRole("button", { name: "Дараах зураг" }));
    await user.click(screen.getByRole("button", { name: "Дараах зураг" }));
    expect(screen.getByRole("dialog", { name: "Зураг 5" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Дараах зураг" })).toBeNull();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "Зураг 4" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Хаах" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
