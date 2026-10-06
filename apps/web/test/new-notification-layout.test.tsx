import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import NewNotificationPage from "@/app/(app)/notifications/new/page";

/**
 * The composer as a post — client, 2026-10-06, with a drawing: a bar with ‹,
 * «Мэдэгдэл нийтлэх» and «Болих»; who is posting, with pills for who sees it
 * and what kind it is; one large «Юу мэдэгдэх вэ?»; «Нийтлэлд нэмэх»; and one
 * full-width «Нийтлэх».
 *
 * ★ It replaces the 2026-09-16 layout test ("the edit screen's form"), which
 * pinned a shape the client has now redrawn — a layout test that outlives its
 * layout is noise.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const CHILD = {
  id: CHILD_ID,
  lastName: "Бат",
  firstName: "Сараа",
  sex: "FEMALE",
  dateOfBirth: "2022-04-12",
  enrollments: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      group: { id: GROUP_ID, name: "Дэлбээ бүлэг" },
    },
  ],
};

const PROFILE = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "teacher",
  lastName: "Дорж",
  firstName: "Сувдаа",
  email: null,
  phone: null,
};

function stub(role: "TEACHER" | "ADMIN", extra: Parameters<typeof stubApi>[0] = []) {
  return stubApi([
    { path: "/auth/me", body: sessionFor([role]) },
    { path: "/me/profile", body: PROFILE },
    ...extra,
    { path: "/groups", body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 } },
    // After the longer paths: the stubs match by prefix.
    { path: `/kindergartens/${KG}`, body: { name: "Нархан цэцэрлэг", logoMediaFileId: null } },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("new notification composer", () => {
  it("is the drawing: a bar, the author with two pills, the note, «Нийтлэлд нэмэх», «Нийтлэх»", async () => {
    stub("TEACHER");
    renderWithProviders(<NewNotificationPage />);

    expect(await screen.findByRole("heading", { name: "Мэдэгдэл нийтлэх" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Буцах" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Болих" })).toBeInTheDocument();

    // The teacher posts as themselves.
    expect(await screen.findByText("Дорж Сувдаа")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Хэнд харагдах:/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Төрөл")).toBeInTheDocument();

    // One large note, its label kept for a screen reader.
    expect(screen.getByLabelText(/Дэлгэрэнгүй/)).toBe(
      screen.getByPlaceholderText("Юу мэдэгдэх вэ?"),
    );
    expect(screen.getByText("Нийтлэлд нэмэх")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Зураг нэмэх").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Нийтлэх" })).toHaveClass("w-full");

    // No title field (2026-09-25), no Чухал for a teacher (2026-10-04).
    expect(screen.queryByText("Гарчиг")).toBeNull();
    expect(screen.queryByRole("button", { name: "Чухал" })).toBeNull();
  });

  /**
   * ★ Client, 2026-10-04: a teacher posts to their own group, choosing the
   * group or named children in it. The picker opens from the audience pill.
   */
  it("lets a teacher choose their group or children in it", async () => {
    const user = userEvent.setup();
    stub("TEACHER", [
      {
        path: "/groups",
        body: {
          items: [{ id: GROUP_ID, name: "Дэлбээ бүлэг", ageBand: "MIDDLE", childCount: 1 }],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: "/children",
        body: { items: [CHILD], page: 1, pageSize: 100, total: 1, totalPages: 1 },
      },
    ]);
    renderWithProviders(<NewNotificationPage />);

    await user.click(await screen.findByRole("button", { name: /^Хэнд харагдах:/ }));

    expect(await screen.findByLabelText("Дэлбээ бүлэг")).toBeInTheDocument();
    expect(await screen.findByLabelText("Бат Сараа")).toBeInTheDocument();
    expect(screen.getByText(/Тодорхой хүүхэд сонгох/)).toBeInTheDocument();
  });

  it("posts as the kindergarten for the administration, with Чухал", async () => {
    const user = userEvent.setup();
    stub("ADMIN");
    renderWithProviders(<NewNotificationPage />);

    expect(await screen.findByText("Нархан цэцэрлэг")).toBeInTheDocument();
    const important = screen.getByRole("button", { name: "Чухал" });
    expect(important).toHaveAttribute("aria-pressed", "false");
    await user.click(important);
    expect(important).toHaveAttribute("aria-pressed", "true");
  });

  it("draws a chosen picture as a large card with Засах and ×", async () => {
    const user = userEvent.setup();
    stub("TEACHER");
    const { container } = renderWithProviders(<NewNotificationPage />);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:photo",
      revokeObjectURL: () => {},
    });

    await screen.findByText("Нийтлэлд нэмэх");
    const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await user.upload(input, new File(["x"], "zurag.jpg", { type: "image/jpeg" }));

    const card = (await screen.findByAltText("zurag.jpg")).closest("li")!;
    expect(within(card).getByRole("button", { name: /солих/ })).toHaveTextContent("Засах");
    expect(within(card).getByRole("button", { name: /хасах/ })).toBeInTheDocument();
  });
});
