import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import ChildrenPage from "@/app/(app)/children/page";

/**
 * «Суралцагч» for the PE/music teacher and the doctor — 2026-10-15.
 *
 * ★ Pinned: neither falls into the parent's «Миний хүүхдүүд», and each row
 * opens the one screen that role is for.
 */

const CHILD = "99999999-9999-4999-8999-000000000001";

function roster() {
  return {
    items: [
      {
        id: CHILD,
        lastName: "Мандах",
        firstName: "Алтанзул",
        nationalId: null,
        dateOfBirth: "2021-03-04",
        enrollments: [
          {
            id: "88888888-8888-4888-8888-000000000001",
            group: { id: "55555555-5555-4555-8555-555555555555", name: "Дэлбээ", ageBand: null },
          },
        ],
      },
    ],
    page: 1,
    pageSize: 30,
    total: 1,
    totalPages: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the children list for a PE/music teacher and a doctor", () => {
  it("sends a doctor's row to the child's health tab", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["DOCTOR"]) },
      { path: "/children?", body: roster() },
    ]);
    renderWithProviders(<ChildrenPage />);

    const link = await screen.findByRole("link", { name: /Алтанзул/ });
    expect(link).toHaveAttribute("href", `/children/${CHILD}/general?tab=health`);
    expect(screen.queryByText(/Миний хүүхдүүд/)).toBeNull();
  });

  it("sends a PE teacher's row to the child's observations", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PE_TEACHER"]) },
      { path: "/children?", body: roster() },
    ]);
    renderWithProviders(<ChildrenPage />);

    const link = await screen.findByRole("link", { name: /Алтанзул/ });
    expect(link).toHaveAttribute("href", `/children/${CHILD}/observations`);
  });

  it("tells a PE teacher with no group what happens next", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["MUSIC_TEACHER"]) },
      { path: "/children?", body: { items: [], page: 1, pageSize: 30, total: 0, totalPages: 0 } },
    ]);
    renderWithProviders(<ChildrenPage />);

    expect(await screen.findByText(/Захирал таныг бүлэгт хуваарилсны дараа/)).toBeInTheDocument();
  });
});
