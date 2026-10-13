import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import PlatformPage from "@/app/(app)/platform/page";

/*
 * ★ «Цэцэрлэгүүд» as a minimal table — 2026-10-13, the user: search and
 * filters above, ownership, province/district, ESIS, groups, phone and
 * e-mail as columns, and the row's actions behind «⋯».
 */
afterEach(() => vi.unstubAllGlobals());

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const KG = (overrides: Record<string, unknown>) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Нарлаг цэцэрлэг",
  address: null,
  phone: "99112233",
  email: "narlag@example.mn",
  isActive: true,
  createdAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

const ROWS = [
  KG({
    propertyType: "Төрийн",
    province: "Улаанбаатар",
    district: "Баянзүрх",
    esisInstitutionId: "42778",
    groupCount: 6,
  }),
  KG({ id: "22222222-2222-4222-8222-222222222222", name: "Хүслэн", phone: null, email: null }),
];

function renderPage() {
  stubApi([
    { path: "/auth/me", body: operator() },
    {
      path: "/platform/kindergartens",
      body: { items: ROWS, page: 1, pageSize: 50, total: 2, totalPages: 1 },
    },
  ]);
  renderWithProviders(<PlatformPage />);
}

describe("the operator's kindergartens table", () => {
  it("draws the columns, «—» where the record has nothing", async () => {
    renderPage();

    const table = await screen.findByRole("table");
    for (const heading of ["Цэцэрлэг", "Өмчийн хэлбэр", "Аймаг / дүүрэг", "ЭСИС", "Бүлэг"]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    const [first, second] = within(table).getAllByRole("row").slice(1);
    expect(first).toHaveTextContent("Улаанбаатар · Баянзүрх");
    expect(first).toHaveTextContent("42778");
    expect(second).toHaveTextContent("—");
  });

  it("filters by ownership, and keeps the row's actions behind «⋯»", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");

    await user.click(screen.getByLabelText("Өмчийн хэлбэрээр шүүх"));
    await user.click(screen.getByRole("option", { name: "Төрийн" }));
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + one
    expect(screen.queryByText("Хүслэн")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Нарлаг цэцэрлэг — үйлдэл" }));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Дэлгэрэнгүй", "Идэвхгүй болгох", "Устгах"]);
  });

  it("sorts by a column, both ways, the empty ones last", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByRole("table");
    const names = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[1]!.querySelector("a")!.textContent);

    expect(names()).toEqual(["Нарлаг цэцэрлэг", "Хүслэн"]);
    const groups = within(table).getByRole("button", { name: /Бүлэг/ });
    await user.click(groups);
    expect(within(table).getByRole("columnheader", { name: /Бүлэг/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(names()).toEqual(["Нарлаг цэцэрлэг", "Хүслэн"]);
    await user.click(groups);
    // Descending — and «Хүслэн», with no group count, still last.
    expect(names()).toEqual(["Нарлаг цэцэрлэг", "Хүслэн"]);
    // The table opens sorted by name; pressing a new column starts ascending,
    // pressing the same column again turns it round.
    await user.click(within(table).getByRole("button", { name: /Цэцэрлэг/ }));
    expect(names()).toEqual(["Нарлаг цэцэрлэг", "Хүслэн"]);
    await user.click(within(table).getByRole("button", { name: /Цэцэрлэг/ }));
    expect(names()).toEqual(["Хүслэн", "Нарлаг цэцэрлэг"]);
  });

  it("marks a contract ending within 14 days in red", async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/kindergartens",
        body: {
          items: [KG({ contractEndsOn: day })],
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      },
    ]);
    renderWithProviders(<PlatformPage />);

    const row = (await screen.findAllByRole("row"))[1]!;
    expect(
      within(row).getByText(
        (_, el) => el?.tagName === "SPAN" && el.className.includes("text-danger"),
      ),
    ).toBeInTheDocument();
  });

  it("downloads the rows on screen for Excel", async () => {
    const user = userEvent.setup();
    const created: Blob[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return "blob:sheet";
      },
      revokeObjectURL: () => {},
    });
    renderPage();
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Excel татах" }));
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]!);
    });
    expect(text).toContain('"Нарлаг цэцэрлэг"');
    expect(text).toContain('"Улаанбаатар · Баянзүрх"');
  });
});
