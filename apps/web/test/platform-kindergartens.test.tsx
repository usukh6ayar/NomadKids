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
    childCount: 142,
    staffCount: 18,
    esisStaffLinked: 15,
    esisChildrenLinked: 140,
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
    for (const heading of [
      "Цэцэрлэг",
      "Өмчийн хэлбэр",
      "Аймаг / дүүрэг",
      "ЭСИС холболт",
      "ЭСИС код",
      "Бүлэг",
    ]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    for (const heading of ["Эхэлсэн", "Дуусах"]) {
      expect(
        within(table).getByRole("columnheader", { name: new RegExp(heading) }),
      ).toBeInTheDocument();
    }
    const [first, second] = [...table.querySelectorAll<HTMLElement>("tbody tr")];
    expect(first).toHaveTextContent("Улаанбаатар · Баянзүрх");
    // ESIS: connected, with the institution number; or not connected.
    expect(first).toHaveTextContent("Холбогдсон");
    expect(first).toHaveTextContent("42778");
    expect(second).toHaveTextContent("Холбогдоогүй");
    expect(second).toHaveTextContent("—");
    // Started: the registration date until the contract's own is sent.
    expect(first).toHaveTextContent("2026.10.01");
    // The name stays put while the table scrolls sideways.
    expect(within(first!).getByRole("link", { name: "Нарлаг цэцэрлэг" }).closest("td")).toHaveClass(
      "sticky",
    );
  });

  it("filters by ownership, and keeps the row's actions behind «⋯»", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");

    await user.click(screen.getByLabelText("Өмчийн хэлбэрээр шүүх"));
    await user.click(screen.getByRole("option", { name: "Төрийн" }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
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
      [...table.querySelectorAll("tbody tr")].map((row) => row.querySelector("a")!.textContent);

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

    const row = (await screen.findByRole("table")).querySelector<HTMLElement>("tbody tr")!;
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

  it("counts the people using it — children and staff", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    for (const heading of ["Хүүхэд", "Ажилтан"]) {
      expect(
        within(table).getByRole("columnheader", { name: new RegExp(heading) }),
      ).toBeInTheDocument();
    }
    const first = table.querySelector<HTMLElement>("tbody tr")!;
    expect(first).toHaveTextContent("142");
    expect(first).toHaveTextContent("18");
  });

  it("shows the solo teachers on their own tab", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/kindergartens",
        body: { items: ROWS, page: 1, pageSize: 50, total: 2, totalPages: 1 },
      },
      {
        path: "/platform/solo-workspaces",
        body: {
          items: [
            {
              id: "s1",
              name: "Батаагийн Сувд",
              phone: "99001122",
              email: null,
              location: "Баянзүрх дүүрэг",
              workplace: "Од цэцэрлэг",
              childCount: 12,
              createdAt: "2026-10-05T00:00:00Z",
            },
            {
              id: "s2",
              name: "Доржийн Нараа",
              phone: null,
              email: "naraa@example.mn",
              location: "Дархан-Уул аймаг",
              workplace: null,
              childCount: 0,
              createdAt: "2026-10-09T00:00:00Z",
            },
          ],
          page: 1,
          pageSize: 100,
          total: 2,
          totalPages: 1,
        },
      },
    ]);
    renderWithProviders(<PlatformPage />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("tab", { name: "Багш дангаар" }));
    expect(screen.getByRole("tab", { name: "Багш дангаар" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const row = (await screen.findByText("Батаагийн Сувд")).closest("tr")!;
    expect(row).toHaveTextContent("Од цэцэрлэг");
    expect(row).toHaveTextContent("12");
    expect(screen.queryByText("Нарлаг цэцэрлэг")).not.toBeVisible();

    // The same filter bar as the kindergartens: named filters, chips, a count.
    const solo = within(screen.getByRole("region", { name: "Бие даасан багшийн жагсаалт" }));
    const names = () =>
      [...solo.getByRole("table").querySelectorAll("tbody tr")].map(
        (tr) => tr.querySelectorAll("td")[1]!.textContent,
      );
    expect(names()).toEqual(["Доржийн Нараа", "Батаагийн Сувд"]); // newest first
    await user.click(solo.getByLabelText("Ажилладаг цэцэрлэгээр шүүх"));
    await user.click(screen.getByRole("option", { name: "Бичсэн" }));
    expect(names()).toEqual(["Батаагийн Сувд"]);
    expect(solo.getByText("2-оос 1 багш")).toBeInTheDocument();
    await user.click(solo.getByRole("button", { name: "Бүгдийг цэвэрлэх" }));
    await user.click(solo.getByLabelText("Хүүхдийн тоогоор шүүх"));
    await user.click(screen.getByRole("option", { name: "Хүүхэдгүй" }));
    expect(names()).toEqual(["Доржийн Нараа"]);
    await user.click(solo.getByRole("button", { name: "«Хүүхэдгүй» шүүлтүүрийг арилгах" }));
    expect(names()).toHaveLength(2);
  });

  it("totals the columns at the top of the table — the platform's, or the rows filtered", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/stats",
        body: {
          kindergartens: 2,
          groups: 9,
          children: 300,
          staff: 40,
          guardians: 250,
          esis: null,
        },
      },
      {
        path: "/platform/kindergartens",
        body: { items: ROWS, page: 1, pageSize: 50, total: 2, totalPages: 1 },
      },
    ]);
    renderWithProviders(<PlatformPage />);
    const table = await screen.findByRole("table");

    // On top — the header's second row (the user: "доор биш дээр").
    const totals = () => table.querySelectorAll("thead tr")[1]!;
    expect(await within(table).findByText(/Идэвхтэй эцэг эх: 250/)).toBeInTheDocument();
    expect(totals()).toHaveTextContent("Нийт: 2 цэцэрлэг");
    expect(totals()).toHaveTextContent("300");
    expect(totals()).toHaveTextContent("1 / 2"); // ESIS: one of the two linked

    // Filtered: the sum of what is on screen, so it matches the rows.
    await user.click(screen.getByLabelText("Өмчийн хэлбэрээр шүүх"));
    await user.click(screen.getByRole("option", { name: "Төрийн" }));
    expect(totals()).toHaveTextContent("Нийт: 1 цэцэрлэг");
    expect(totals()).toHaveTextContent("142");
    expect(totals()).not.toHaveTextContent("Идэвхтэй эцэг эх");
  });

  it("reconciles each kindergarten with ESIS in its own columns", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    for (const heading of ["ЭСИС ажилтан", "ЭСИС суралцагч"]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    const [first, second] = [...table.querySelectorAll<HTMLElement>("tbody tr")];
    expect(first).toHaveTextContent("15 / 18");
    expect(first).toHaveTextContent("140 / 142");
    expect(second).toHaveTextContent("—");
    // The block of platform-wide figures above the table is gone.
    expect(screen.queryByRole("region", { name: "ЭСИС-тэй тулгалт" })).toBeNull();
  });

  it("shows all, the plain ones, or the ESIS ones", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByRole("table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);

    const pick = async (name: string) => {
      await user.click(screen.getByLabelText("ЭСИС-ээр шүүх"));
      await user.click(screen.getByRole("option", { name }));
      return screen.getByRole("table").querySelectorAll("tbody tr");
    };
    const esisHeader = () => screen.queryByRole("columnheader", { name: "ЭСИС ажилтан" });
    const esis = await pick("ЭСИС цэцэрлэг");
    expect(esis).toHaveLength(1);
    expect(esis[0]).toHaveTextContent("Нарлаг цэцэрлэг");
    expect(esis[0]).toHaveTextContent("15 / 18");
    expect(esisHeader()).not.toBeNull();
    // The plain ones have no ESIS, so its four columns go.
    const plain = await pick("Цэцэрлэг");
    expect(plain).toHaveLength(1);
    expect(plain[0]).toHaveTextContent("Хүслэн");
    expect(esisHeader()).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "ЭСИС код" })).toBeNull();
    expect(await pick("Бүгд")).toHaveLength(2);
    expect(esisHeader()).not.toBeNull();
  });

  it("names each chosen filter as a chip, and clears them", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    expect(screen.getByText("2 цэцэрлэг")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Өмчийн хэлбэрээр шүүх"));
    await user.click(screen.getByRole("option", { name: "Төрийн" }));
    expect(screen.getByText("2-оос 1 цэцэрлэг")).toBeInTheDocument();
    expect(screen.getByText("Идэвхтэй шүүлтүүр:")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "«Төрийн» шүүлтүүрийг арилгах" }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.queryByText("Идэвхтэй шүүлтүүр:")).toBeNull();

    await user.click(screen.getByLabelText("Өмчийн хэлбэрээр шүүх"));
    await user.click(screen.getByRole("option", { name: "Төрийн" }));
    await user.click(screen.getByRole("button", { name: "Бүгдийг цэвэрлэх" }));
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  /*
   * ★ What each kindergarten has paid the platform — 2026-10-14, the user.
   * Read from the list row when the API sends it; «—» until then.
   */
  it("shows and filters by payment, «—» while the API sends none", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/kindergartens",
        body: {
          items: [
            { ...ROWS[0], paymentStatus: "overdue", paidPeriods: 1, totalPeriods: 3 },
            ROWS[1],
          ],
          page: 1,
          pageSize: 50,
          total: 2,
          totalPages: 1,
        },
      },
    ]);
    renderWithProviders(<PlatformPage />);
    const table = await screen.findByRole("table");
    const column = [...table.querySelectorAll("thead tr:first-child th")].findIndex(
      (th) => th.textContent === "Төлбөр",
    );
    const cellOf = (name: string) =>
      within(table).getByText(name).closest("tr")!.querySelectorAll("td")[column]!;

    expect(cellOf("Нарлаг цэцэрлэг")).toHaveTextContent("Хоцорсон · 1/3");
    expect(cellOf("Хүслэн")).toHaveTextContent("—");

    await user.click(screen.getByLabelText("Төлбөрөөр шүүх"));
    await user.click(screen.getByRole("option", { name: "Хоцорсон" }));
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  /*
   * ★ How each contract is paid and when it was made — 2026-10-14, the user:
   * «Гэрээ байгуулсан» (7/14 days, 3 months, a year) and «Дуусах» filters.
   */
  it("shows how a contract is paid and filters by when it was made or ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 14)); // 2026-10-14
    try {
      const user = userEvent.setup();
      stubApi([
        { path: "/auth/me", body: operator() },
        {
          path: "/platform/kindergartens",
          body: {
            items: [
              {
                ...ROWS[0],
                billingPeriod: "term",
                contractSignedAt: "2026-10-10T08:00:00.000Z",
                contractEndsOn: "2026-10-25",
              },
              {
                ...ROWS[1],
                billingPeriod: "year",
                contractSignedAt: "2026-05-02T08:00:00.000Z",
                contractEndsOn: "2027-05-31",
              },
            ],
            page: 1,
            pageSize: 50,
            total: 2,
            totalPages: 1,
          },
        },
      ]);
      renderWithProviders(<PlatformPage />);
      const table = await screen.findByRole("table");
      const headers = [...table.querySelectorAll("thead tr:first-child th")].map(
        (th) => th.textContent ?? "",
      );
      const at = (label: string) => headers.findIndex((text) => text.startsWith(label));
      const cell = (name: string, label: string) =>
        within(table).getByText(name).closest("tr")!.querySelectorAll("td")[at(label)]!;
      const names = () =>
        [...table.querySelectorAll("tbody tr")].map(
          (tr) => tr.querySelectorAll("td")[1]!.textContent,
        );

      expect(cell("Нарлаг цэцэрлэг", "Хугацаа")).toHaveTextContent("Улирлаар");
      expect(cell("Хүслэн", "Хугацаа")).toHaveTextContent("Жилээр");
      expect(cell("Нарлаг цэцэрлэг", "Гэрээ байгуулсан")).toHaveTextContent("2026.10.10");

      const pick = async (label: string, option: string) => {
        await user.click(screen.getByLabelText(label));
        await user.click(screen.getByRole("option", { name: option }));
      };
      await pick("Гэрээ байгуулсан хугацаагаар шүүх", "Сүүлийн 7 хоног");
      expect(names()).toEqual(["Нарлаг цэцэрлэг"]);
      await pick("Гэрээ байгуулсан хугацаагаар шүүх", "Сүүлийн 1 жил");
      expect(names()).toHaveLength(2);
      await pick("Гэрээ байгуулсан хугацаагаар шүүх", "Бүгд");

      await pick("Дуусах хугацаагаар шүүх", "14 хоногт");
      expect(names()).toEqual(["Нарлаг цэцэрлэг"]);
      await pick("Дуусах хугацаагаар шүүх", "Дууссан");
      // Nothing has ended: the table gives way to the empty state.
      expect(screen.queryByRole("table")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
