import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  selectOption,
  sessionFor,
  setSearchParams,
  stubApi,
} from "./support/render";
import { SEX_LABEL } from "@kinder/contracts";
import ChildrenPage from "@/app/(app)/children/page";

/**
 * The director's roster — client, 2026-09-25, with a drawing.
 *
 * ★ Two columns (Хөнгөлөлт, ESIS төлөв), the discount filter, the summary
 * figures and the sync date have no data behind them yet. What is pinned is
 * that they read "—" rather than anything invented.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "55555555-5555-4555-8555-555555555555";

function child(n: number) {
  return {
    id: `99999999-9999-4999-8999-${String(n).padStart(12, "0")}`,
    lastName: "Мандах",
    firstName: `Алтанзул${n}`,
    nationalId: `УР2326297${n % 10}`,
    sex: "FEMALE",
    dateOfBirth: "2021-04-12",
    kindergartenId: KG,
    esisLinked: n === 1,
    enrollments: [
      {
        id: `88888888-8888-4888-8888-${String(n).padStart(12, "0")}`,
        group: { id: GROUP, name: "Ахлах А" },
      },
    ],
  };
}

function stub(extra: Parameters<typeof stubApi>[0] = []) {
  return stubApi([
    ...extra,
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    {
      path: "/groups",
      body: {
        items: [{ id: GROUP, name: "Ахлах А", ageBand: "SENIOR", kindergartenId: KG }],
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      },
    },
    {
      path: "/children",
      body: { items: [child(1), child(2)], page: 1, pageSize: 20, total: 526, totalPages: 27 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("the director's roster", () => {
  it("fills Хөнгөлөлт from ESIS on press, and ESIS төлөв from the row", async () => {
    const user = userEvent.setup();
    const api = stub([
      {
        path: `/kindergartens/${KG}/funding/food-discounts`,
        body: {
          status: "READ",
          reason: null,
          counts: { eligible: 1, notEligible: 0, unassessed: 1 },
          rows: [
            { childId: child(1).id, status: "ELIGIBLE", orderNum: null },
            { childId: child(2).id, status: "UNASSESSED", orderNum: null },
          ],
        },
      },
    ]);
    renderWithProviders(<ChildrenPage />);

    const table = await screen.findByRole("table", { name: "Суралцагчийн жагсаалт" });
    const first = within(table).getAllByRole("row")[1]!;
    expect(first).toHaveTextContent("Холбогдсон");
    expect(within(table).getAllByRole("row")[2]!).toHaveTextContent("Холбогдоогүй");
    expect(api.calls.some((c) => c.url.includes("food-discounts"))).toBe(false);

    await user.click(screen.getByRole("button", { name: /ESIS Хөнгөлөлттэй/ }));
    expect(await within(first).findByText("Хөнгөлөлттэй")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")[2]!).toHaveTextContent("Тогтоогоогүй");
  });

  it("carries the four actions the drawing has, and no import", async () => {
    stub();
    renderWithProviders(<ChildrenPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Суралцагч" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Excel/ }).getAttribute("href")).toContain(
      `/kindergartens/${KG}/children/export`,
    );
    // Reads ESIS's discounts on press — never on open, it is an audited ministry read.
    expect(screen.getByRole("button", { name: /ESIS Хөнгөлөлттэй/ })).toBeEnabled();
    // A real import (`roster-import`), not a link — the hub it linked to is gone.
    expect(screen.getByRole("button", { name: /ESIS Суралцагч/ })).toBeEnabled();
    expect(screen.getByRole("link", { name: /^Суралцагч$/ })).toHaveAttribute(
      "href",
      "/children/new",
    );
    expect(screen.queryByRole("link", { name: /Импорт/ })).toBeNull();
  });

  it("is one compact table with the drawing's columns and no checkboxes", async () => {
    stub();
    renderWithProviders(<ChildrenPage />);

    const table = await screen.findByRole("table", { name: "Суралцагчийн жагсаалт" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      // ★ 2026-10-01, the client's order: №, Бүлэг, then the child.
      "№",
      "Бүлэг",
      "Нэр",
      "Регистр",
      "Хүйс",
      "Нас",
      // Хөнгөлөлт only once «ESIS Хөнгөлөлттэй» has been pulled (2026-09-29).
      "ESIS төлөв",
      "Үйлдэл",
    ]);
    expect(within(table).queryByRole("checkbox")).toBeNull();

    const row = within(table).getByRole("row", { name: /Алтанзул1/ });
    expect(within(row).getByText("УР23262971")).toBeInTheDocument();
    expect(within(row).getByText(SEX_LABEL.FEMALE!)).toBeInTheDocument();
    expect(within(row).getByText("Ахлах А бүлэг")).toBeInTheDocument();
    expect(within(row).queryByText("—")).toBeNull();
    expect(row).toHaveTextContent("Холбогдсон");
  });

  it("invents no figures in the summary line", async () => {
    stub();
    renderWithProviders(<ChildrenPage />);

    await screen.findByRole("table", { name: "Суралцагчийн жагсаалт" });
    const summary = screen.getByText(/суралцагч ·/).closest("p")!;
    expect(summary.textContent).toMatch(/Нийт 526 суралцагч · Хөнгөлөлттэй — · Хөнгөлөлтгүй —/);
    expect(screen.getByText(/Нэгдсэн журмаар шинэчлэгдсэн: —/)).toBeInTheDocument();
    // The discount filter is drawn but cannot filter anything yet.
    expect(screen.getByRole("combobox", { name: "Хөнгөлөлт" })).toBeDisabled();
  });

  it("drops the summary cards and the ESIS panels", async () => {
    stub();
    renderWithProviders(<ChildrenPage />);

    await screen.findByRole("table", { name: "Суралцагчийн жагсаалт" });
    expect(screen.queryByText("Нийт хүүхэд")).toBeNull();
    expect(screen.queryByText("Охид")).toBeNull();
    expect(screen.queryByText("Бүлгийн суралцагчийн жагсаалт")).toBeNull();
  });

  it("pages twenty at a time and lets the director show fifty", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<ChildrenPage />);

    await screen.findByRole("table", { name: "Суралцагчийн жагсаалт" });
    expect(
      api.calls.some((c) => c.url.startsWith("/children?") && c.url.includes("pageSize=20")),
    ).toBe(true);

    await selectOption(user, "Хуудас тутамд", "50");
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.url.startsWith("/children?") && c.url.includes("pageSize=50")),
      ).toBe(true),
    );
  });

  it("filters by group through the API", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<ChildrenPage />);

    await screen.findByRole("table", { name: "Суралцагчийн жагсаалт" });
    await selectOption(user, "Бүлэг", "Ахлах А");
    await waitFor(() =>
      expect(api.calls.some((c) => c.url.includes(`groupId=${GROUP}`))).toBe(true),
    );
  });

  it("filters the API roster by ESIS link state", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<ChildrenPage />);

    await screen.findByRole("table", { name: "Суралцагчийн жагсаалт" });
    await selectOption(user, "ESIS төлөв", "ESIS-тэй холбоогүй");

    await waitFor(() =>
      expect(
        api.calls.some(
          (call) => call.url.startsWith("/children?") && call.url.includes("pageSize=100"),
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("table", { name: "Суралцагчийн жагсаалт" })).queryByText(
          "М.Алтанзул1",
        ),
      ).toBeNull(),
    );
    expect(
      within(screen.getByRole("table", { name: "Суралцагчийн жагсаалт" })).getByText("М.Алтанзул2"),
    ).toBeInTheDocument();
  });
});
