import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import GroupDetailPage from "@/app/(app)/groups/[groupId]/page";

/**
 * A group's own page — the director's copy as two tables, client 2026-09-25:
 * "бүлгийн болон туслах багшийн мэдээлэл хүүхдийн нэрс хүснэгтээр харагд
 * Б.Ану". A teacher's copy is unchanged.
 */

const GROUP = "55555555-5555-4555-8555-555555555555";
const KG = "33333333-3333-4333-8333-333333333333";

const DETAIL = {
  id: GROUP,
  name: "Наран бүлэг",
  ageBand: "MIDDLE",
  kindergartenId: KG,
  status: "ACTIVE",
  _count: { enrollments: 2 },
  teachers: [
    {
      id: "66666666-6666-4666-8666-000000000002",
      role: "ASSISTANT",
      membership: {
        id: "77777777-7777-4777-8777-000000000002",
        user: { id: "88888888-8888-4888-8888-000000000002", lastName: "Дорж", firstName: "Сараа" },
      },
    },
    {
      id: "66666666-6666-4666-8666-000000000001",
      role: "LEAD",
      membership: {
        id: "77777777-7777-4777-8777-000000000001",
        user: { id: "88888888-8888-4888-8888-000000000001", lastName: "Бат", firstName: "Сувдаа" },
      },
    },
  ],
};

const ROSTER = {
  items: [
    {
      id: "99999999-9999-4999-8999-000000000001",
      lastName: "Болд",
      firstName: "Ану",
      dateOfBirth: "2021-04-12",
      kindergartenId: KG,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
};

function stub(role: "ADMIN" | "TEACHER") {
  stubApi([
    { path: "/auth/me", body: sessionFor([role]) },
    { path: `/groups/${GROUP}`, body: DETAIL },
    { path: "/children", body: ROSTER },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ groupId: GROUP });
});

describe("a group's page", () => {
  it("shows a director the teachers, lead first, as a table", async () => {
    stub("ADMIN");
    renderWithProviders(<GroupDetailPage />);

    const table = await screen.findByRole("table", { name: "Бүлгийн багш нар" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Бүлгийн багшБ.Сувдаа",
      "Туслах багшД.Сараа",
    ]);
  });

  it("shows a director the children as a table, named Б.Ану", async () => {
    stub("ADMIN");
    renderWithProviders(<GroupDetailPage />);

    const table = await screen.findByRole("table", { name: "Бүлгийн хүүхдүүд" });
    const link = within(table).getByRole("link", { name: /Б\.Ану/ });
    expect(link).toHaveAttribute("href", "/children/99999999-9999-4999-8999-000000000001/general");
    expect(within(table).getByText("1")).toBeInTheDocument();
    // No photographs in the director's table — 2026-09-25.
    expect(table.querySelector("img")).toBeNull();
  });

  // No count badge and no register doors on a director's copy — 2026-09-25.
  it("leaves the count and the three doors off a director's copy", async () => {
    stub("ADMIN");
    renderWithProviders(<GroupDetailPage />);

    await screen.findByRole("table", { name: "Бүлгийн хүүхдүүд" });
    expect(screen.queryByText("2 хүүхэд")).toBeNull();
    for (const hint of ["Өдрийн ирц бүртгэх", "Хоолны бүртгэл", "Улирлын үнэлгээ"]) {
      expect(screen.queryByText(hint)).toBeNull();
    }
  });

  it("keeps a teacher's copy as it was", async () => {
    stub("TEACHER");
    renderWithProviders(<GroupDetailPage />);

    expect(await screen.findByText("Болд Ану")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("2 хүүхэд")).toBeInTheDocument();
    expect(screen.getByText("Өдрийн ирц бүртгэх")).toBeInTheDocument();
  });
});
