import { screen, waitFor, within } from "@testing-library/react";
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
    {
      path: "/users",
      body: {
        items: [
          {
            id: "88888888-8888-4888-8888-000000000001",
            lastName: "Бат",
            firstName: "Сувдаа",
            phone: "99112233",
            memberships: [],
          },
        ],
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      },
    },
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
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Үүрэг", "Нэр", "Регистр", "Утас"]);
    // The telephone comes from the staff list; no account stores a register.
    await waitFor(() =>
      expect(rows.map((row) => row.textContent)).toEqual([
        "Бүлгийн багшБ.Сувдаа—99112233",
        "Туслах багшД.Сараа——",
      ]),
    );
  });

  // The Суралцагч roster's own table — 2026-09-25, "ийм загвараар".
  it("shows a director the children in the roster's table", async () => {
    stub("ADMIN");
    renderWithProviders(<GroupDetailPage />);

    const table = await screen.findByRole("table", { name: "Бүлгийн хүүхдүүд" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      "№",
      "Суралцагчийн нэр",
      // No register in this fixture, so no column of dashes (2026-09-29).
      "Хүйс",
      "Бүлэг",
      "ESIS төлөв",
      "Үйлдэл",
    ]);
    const link = within(table).getByRole("link", { name: "Болд Ану" });
    expect(link).toHaveAttribute("href", "/children/99999999-9999-4999-8999-000000000001/general");
    // No photographs in the director's table — 2026-09-25.
    expect(table.querySelector("img")).toBeNull();
    // Unclipped, so the ⋯ menu opens whole.
    for (
      let node = table.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      expect(node.className).not.toMatch(/overflow-(hidden|x-auto|auto)/);
    }
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
