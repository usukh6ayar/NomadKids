import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, stubApi } from "./support/render";
import { GroupGraduationLetter } from "@/components/child/group-graduation-letter";

/**
 * One graduation letter for the whole group, or for children picked by name —
 * the user, 2026-10-17.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const ANU = {
  id: "99999999-9999-4999-8999-000000000001",
  lastName: "Болд",
  firstName: "Ану",
  dateOfBirth: "2021-04-12",
  kindergartenId: KG,
  enrollments: [],
};
const TEMUUJIN = {
  id: "99999999-9999-4999-8999-000000000002",
  lastName: "Дорж",
  firstName: "Тэмүүжин",
  dateOfBirth: "2021-06-01",
  kindergartenId: KG,
  enrollments: [],
};

const GROUP = "55555555-5555-4555-8555-555555555555";
const ROSTER = {
  path: `/children?groupId=${GROUP}`,
  method: "GET",
  body: { items: [ANU, TEMUUJIN], page: 1, pageSize: 100, total: 2, totalPages: 1 },
};

const letterPath = (id: string) => `/children/${id}/graduation-letter`;

beforeEach(() => {
  vi.clearAllMocks();
});

function patches(calls: { url: string; method: string; body?: unknown }[]) {
  return calls.filter((c) => c.method === "PATCH");
}

describe("the group's graduation letter", () => {
  it("saves one letter to every child in the group", async () => {
    const { calls } = stubApi([
      ROSTER,
      { path: letterPath(ANU.id), method: "GET", body: { letter: null } },
      { path: letterPath(TEMUUJIN.id), method: "GET", body: { letter: null } },
      { path: letterPath(ANU.id), method: "PATCH", body: { letter: "Хайрт сурагчдаа" } },
      { path: letterPath(TEMUUJIN.id), method: "PATCH", body: { letter: "Хайрт сурагчдаа" } },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<GroupGraduationLetter groupId={GROUP} />);

    await user.click(screen.getByRole("button", { name: "Захиа" }));
    await user.type(screen.getByLabelText("Төгсөлтийн багшийн захиа"), "Хайрт сурагчдаа");
    expect(await screen.findByLabelText("Бүх хүүхэд (2)")).toBeChecked();
    await user.click(await screen.findByRole("button", { name: "Хадгалах (2)" }));

    await waitFor(() => expect(patches(calls)).toHaveLength(2));
    expect(
      patches(calls)
        .map((c) => c.url)
        .sort(),
    ).toEqual([letterPath(ANU.id), letterPath(TEMUUJIN.id)].sort());
    expect(patches(calls)[0]!.body).toEqual({ letter: "Хайрт сурагчдаа" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Төгсөлтийн захиа" })).not.toBeInTheDocument(),
    );
  });

  it("saves to the picked child only, and asks before replacing their letter", async () => {
    const { calls } = stubApi([
      ROSTER,
      { path: letterPath(ANU.id), method: "GET", body: { letter: "Өмнөх захиа" } },
      { path: letterPath(TEMUUJIN.id), method: "GET", body: { letter: null } },
      { path: letterPath(ANU.id), method: "PATCH", body: { letter: "Шинэ" } },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<GroupGraduationLetter groupId={GROUP} />);

    await user.click(screen.getByRole("button", { name: "Захиа" }));
    await user.type(screen.getByLabelText("Төгсөлтийн багшийн захиа"), "Шинэ");
    await user.click(await screen.findByLabelText("Хүүхэд сонгох"));
    expect(await screen.findByText("Захиатай")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Болд Ану"));
    await user.click(screen.getByRole("button", { name: "Хадгалах (1)" }));

    // The first press only asks.
    expect(await screen.findByRole("alert")).toHaveTextContent("Болд Ану");
    expect(patches(calls)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Солих" }));
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    expect(patches(calls)[0]!.url).toBe(letterPath(ANU.id));
  });

  it("names the child whose save failed and retries only them", async () => {
    const { calls } = stubApi([
      ROSTER,
      { path: letterPath(ANU.id), method: "GET", body: { letter: null } },
      { path: letterPath(TEMUUJIN.id), method: "GET", body: { letter: null } },
      { path: letterPath(ANU.id), method: "PATCH", body: { letter: "Захиа" } },
      {
        path: letterPath(TEMUUJIN.id),
        method: "PATCH",
        status: 500,
        body: { type: "about:blank", title: "Алдаа", status: 500, requestId: "t" },
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<GroupGraduationLetter groupId={GROUP} />);

    await user.click(screen.getByRole("button", { name: "Захиа" }));
    await user.type(screen.getByLabelText("Төгсөлтийн багшийн захиа"), "Захиа");
    await user.click(await screen.findByRole("button", { name: "Хадгалах (2)" }));

    expect(await screen.findByText(/хадгалагдсангүй: Дорж Тэмүүжин\./)).toBeInTheDocument();
    const before = patches(calls).length;

    await user.click(screen.getByRole("button", { name: "Дахин оролдох" }));
    await waitFor(() => expect(patches(calls).length).toBeGreaterThan(before));
    expect(
      patches(calls)
        .slice(before)
        .map((c) => c.url),
    ).toEqual([letterPath(TEMUUJIN.id)]);
  });
});
