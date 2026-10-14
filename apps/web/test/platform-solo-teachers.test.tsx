import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import PlatformPage from "@/app/(app)/platform/page";

/*
 * ★ «Багш дангаар» — the solo teachers' tab on «Цэцэрлэгүүд» (2026-10-13, the
 * user: "ийм байдлаар"): the kindergartens' table and filter bar, over
 * `GET /platform/solo-workspaces`. Merging stays on «Бие даасан багш».
 */
afterEach(() => vi.unstubAllGlobals());

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const TEACHERS = [
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
  {
    id: "s3",
    name: "Ганболдын Ану",
    phone: "88112233",
    email: "anu@example.mn",
    location: "Баянзүрх дүүрэг",
    workplace: "Нарлаг цэцэрлэг",
    childCount: 20,
    createdAt: "2026-10-01T00:00:00Z",
  },
];

const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  totalPages: 1,
});

/** Opens «Цэцэрлэгүүд», then the «Багш дангаар» tab; returns the tab's region. */
async function openSoloTab(teachers: unknown[] = TEACHERS) {
  const user = userEvent.setup();
  stubApi([
    { path: "/auth/me", body: operator() },
    { path: "/platform/kindergartens", body: { ...page([]), pageSize: 50 } },
    { path: "/platform/solo-workspaces", body: page(teachers) },
  ]);
  renderWithProviders(<PlatformPage />);
  await user.click(await screen.findByRole("tab", { name: "Багш дангаар" }));
  const region = screen.getByRole("region", { name: "Бие даасан багшийн жагсаалт" });
  return { user, region, solo: within(region) };
}

/** The names in the solo table's body, top to bottom. */
function names(region: HTMLElement): string[] {
  return [...region.querySelectorAll("tbody tr")].map(
    (tr) => tr.querySelectorAll("td")[1]!.textContent ?? "",
  );
}

describe("the «Багш дангаар» tab", () => {
  it("draws a row per teacher, «—» where they left something blank", async () => {
    const { solo } = await openSoloTab();
    const row = (await solo.findByText("Доржийн Нараа")).closest("tr")!;

    const cells = [...row.querySelectorAll("td")].map((td) => td.textContent);
    // №, teacher, workplace, area, children, paid, unpaid, phone, e-mail.
    expect(cells.slice(0, 9)).toEqual([
      "1",
      "Доржийн Нараа",
      "—",
      "Дархан-Уул аймаг",
      "0",
      "—",
      "—",
      "—",
      "naraa@example.mn",
    ]);
    expect(solo.getByText("3 багш")).toBeInTheDocument();
  });

  it("searches by the teacher, the kindergarten they work at, or the area", async () => {
    const { user, region, solo } = await openSoloTab();
    await solo.findByRole("table");
    const search = solo.getByLabelText("Багш, цэцэрлэгээр хайх");

    await user.type(search, "нарлаг");
    expect(names(region)).toEqual(["Ганболдын Ану"]);
    expect(solo.getByText("3-оос 1 багш")).toBeInTheDocument();
    expect(solo.getByRole("button", { name: /нарлаг.*шүүлтүүрийг арилгах/ })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "дархан");
    expect(names(region)).toEqual(["Доржийн Нараа"]);
  });

  it("filters by area, from the places the teachers gave", async () => {
    const { user, region, solo } = await openSoloTab();
    await solo.findByRole("table");

    await user.click(solo.getByLabelText("Багшийг аймаг, дүүргээр шүүх"));
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Бүгд", "Баянзүрх дүүрэг", "Дархан-Уул аймаг"]);
    await user.click(screen.getByRole("option", { name: "Баянзүрх дүүрэг" }));

    expect(names(region)).toEqual(["Батаагийн Сувд", "Ганболдын Ану"]);
    // Ringed while it narrows the list.
    expect(solo.getByLabelText("Багшийг аймаг, дүүргээр шүүх").className).toContain(
      "border-primary",
    );
  });

  it("combines the filters, and «Бүгдийг цэвэрлэх» clears them all", async () => {
    const { user, region, solo } = await openSoloTab();
    await solo.findByRole("table");

    await user.click(solo.getByLabelText("Багшийг аймаг, дүүргээр шүүх"));
    await user.click(screen.getByRole("option", { name: "Баянзүрх дүүрэг" }));
    await user.click(solo.getByLabelText("Хүүхдийн тоогоор шүүх"));
    await user.click(screen.getByRole("option", { name: "Хүүхэдтэй" }));
    await user.type(solo.getByLabelText("Багш, цэцэрлэгээр хайх"), "сувд");
    expect(names(region)).toEqual(["Батаагийн Сувд"]);

    await user.click(solo.getByRole("button", { name: "Бүгдийг цэвэрлэх" }));
    expect(names(region)).toHaveLength(3);
    expect(solo.getByLabelText("Багш, цэцэрлэгээр хайх")).toHaveValue("");
    expect(solo.queryByText("Идэвхтэй шүүлтүүр:")).toBeNull();
  });

  it("says to change the filters when nothing matches", async () => {
    const { user, solo } = await openSoloTab();
    await solo.findByRole("table");

    await user.type(solo.getByLabelText("Багш, цэцэрлэгээр хайх"), "байхгүй нэр");
    expect(solo.getByText("Бие даасан багш алга")).toBeInTheDocument();
    expect(solo.getByText("Шүүлтүүрээ өөрчилж үзнэ үү.")).toBeInTheDocument();
    expect(solo.queryByRole("table")).toBeNull();
  });

  it("says nobody has signed up alone yet when the list is empty", async () => {
    const { solo } = await openSoloTab([]);

    expect(
      await solo.findByText("Багш «Үнийн санал» хуудаснаас бүртгүүлэхэд энд харагдана."),
    ).toBeInTheDocument();
    expect(solo.getByRole("button", { name: "Excel татах" })).toBeDisabled();
  });

  it("sorts newest first, and by children both ways", async () => {
    const { user, region, solo } = await openSoloTab();
    const table = await solo.findByRole("table");
    expect(names(region)).toEqual(["Доржийн Нараа", "Батаагийн Сувд", "Ганболдын Ану"]);

    await user.click(within(table).getByRole("button", { name: /Хүүхэд/ }));
    expect(names(region)).toEqual(["Доржийн Нараа", "Батаагийн Сувд", "Ганболдын Ану"]);
    await user.click(within(table).getByRole("button", { name: /Хүүхэд/ }));
    expect(names(region)).toEqual(["Ганболдын Ану", "Батаагийн Сувд", "Доржийн Нараа"]);
    expect(within(table).getByRole("columnheader", { name: /Хүүхэд/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("totals the teachers and their children over the rows on screen", async () => {
    const { user, solo } = await openSoloTab();
    const table = await solo.findByRole("table");
    const totals = () => table.querySelectorAll("thead tr")[1]!;

    expect(totals()).toHaveTextContent("Нийт: 3 багш");
    expect(totals()).toHaveTextContent("32");

    await user.click(solo.getByLabelText("Хүүхдийн тоогоор шүүх"));
    await user.click(screen.getByRole("option", { name: "Хүүхэдгүй" }));
    expect(totals()).toHaveTextContent("Нийт: 1 багш");
  });

  it("downloads the rows on screen for Excel", async () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return "blob:sheet";
      },
      revokeObjectURL: () => {},
    });
    const { user, solo } = await openSoloTab();
    await solo.findByRole("table");

    await user.click(solo.getByLabelText("Ажилладаг цэцэрлэгээр шүүх"));
    await user.click(screen.getByRole("option", { name: "Бичээгүй" }));
    await user.click(solo.getByRole("button", { name: "Excel татах" }));

    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]!);
    });
    expect(text).toContain('"Багш","Ажилладаг цэцэрлэг"');
    expect(text).toContain('"Доржийн Нараа"');
    expect(text).not.toContain("Батаагийн Сувд"); // filtered out
  });

  it("sends the merge to «Бие даасан багш» from the row's «⋯»", async () => {
    const { user, solo } = await openSoloTab();
    await solo.findByRole("table");

    await user.click(solo.getByRole("button", { name: "Батаагийн Сувд — үйлдэл" }));
    expect(screen.getByRole("menuitem", { name: "Цэцэрлэгт нэгтгэх" })).toHaveAttribute(
      "href",
      "/platform/solo-workspaces",
    );
  });
});
