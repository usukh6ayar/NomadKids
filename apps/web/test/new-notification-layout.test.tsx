import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import NewNotificationPage from "@/app/(app)/notifications/new/page";

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

/**
 * ★ The two notice screens are one layout — the client, 2026-09-16: "шинэ
 * мэдээ оруулахыг яг саяны засах хэсгийнх шиг болго".
 *
 * What this pins is the shape they now share: Төрөл and Гарчиг as fields, a
 * slim note whose label is not printed, the pictures as a grid whose last
 * cell adds one, and the audience folded beside Чухал. The previous version
 * asserted the two-column groups this replaced, which is why it is rewritten
 * rather than extended — a layout test that outlives its layout is noise.
 */
describe("new notification layout", () => {
  it("is the edit screen's form: fields, a slim note, then the two settings", async () => {
    renderWithProviders(<NewNotificationPage />);

    expect(await screen.findByRole("heading", { name: "Шинэ мэдэгдэл" })).toBeInTheDocument();

    expect(screen.getByText("Төрөл")).toBeInTheDocument();
    // No title field on a new notice since 2026-09-25 ("гарчиг хас").
    expect(screen.queryByText("Гарчиг")).toBeNull();
    expect(screen.getByPlaceholderText("Бичих")).toHaveClass("min-h-[56px]");

    // The note keeps its label for a screen reader and does not draw it.
    expect(screen.getByLabelText(/Дэлгэрэнгүй/)).toBe(screen.getByPlaceholderText("Бичих"));

    // Adding a photograph is one named icon, in the grid rather than on a row
    // of its own.
    expect(screen.getByLabelText("Зураг нэмэх")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Зураг нэмэх/ })).not.toBeInTheDocument();

    /*
      The audience is folded, and its row says what is in it. "Хэнд харагдах"
      appears twice on purpose — once on the row you press and once as the
      fieldset's `sr-only` legend inside it — so the summary is found by its
      element rather than by the words alone.
    */
    const audienceRow = document.querySelector("summary");
    expect(audienceRow).toHaveTextContent("Хэнд харагдах");
    // A teacher cannot address everyone, so the picker has already corrected
    // itself off that default and the row says nothing is chosen yet.
    expect(audienceRow).toHaveTextContent("Сонгоогүй");

    expect(screen.queryByText(/заавал биш/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Огноо, цаг, юу авчрахыг бичнэ үү/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Бүх бүлгийн эцэг эхэд харагдана/)).not.toBeInTheDocument();
    expect(screen.queryByText(/JPEG, PNG эсвэл WebP/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/жагсаалтын дээд талд тэмдэглэгээтэй харагдана/),
    ).not.toBeInTheDocument();

    // A teacher has no Чухал box — client, 2026-10-04.
    expect(screen.queryByRole("checkbox", { name: "Чухал" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Нийтлэх" })).toHaveClass("w-full");
    expect(screen.getByRole("button", { name: "Болих" })).toHaveClass("w-full");
  });

  /**
   * ★ Client, 2026-10-04: a teacher posts to their own group, choosing the
   * group or named children in it. The child list is the teacher's own —
   * `/children` answers a teacher with their groups' children only.
   */
  it("lets a teacher choose their group or children in it", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
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
        body: {
          items: [CHILD],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
    ]);
    renderWithProviders(<NewNotificationPage />);

    expect(await screen.findByLabelText("Дэлбээ бүлэг")).toBeInTheDocument();
    expect(await screen.findByLabelText("Бат Сараа")).toBeInTheDocument();
    expect(screen.getByText(/Тодорхой хүүхэд сонгох/)).toBeInTheDocument();
  });

  it("keeps Чухал for an administrator", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: "/groups",
        body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
      },
    ]);
    renderWithProviders(<NewNotificationPage />);

    expect(await screen.findByRole("checkbox", { name: "Чухал" })).toBeInTheDocument();
  });
});
