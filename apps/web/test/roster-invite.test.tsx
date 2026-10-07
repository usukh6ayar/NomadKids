import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { StudentRosterTable } from "@/components/child/admin-roster";

/**
 * «Урих» on a child's ⋯ in the teacher's «Суралцагч» — client, 2026-10-06:
 * a parent is invited from the row, without opening the child.
 */

const CHILD = {
  id: "22222222-2222-4222-8222-222222222222",
  lastName: "Батжаргал",
  firstName: "Ану",
  sex: "FEMALE",
  dateOfBirth: "2022-01-25",
  status: "ACTIVE",
  enrollments: [],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inviting from the roster row", () => {
  it("offers «Урих» to a teacher and opens the invitation sheet", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    renderWithProviders(<StudentRosterTable items={[CHILD]} forTeacher />);

    await user.click(screen.getByRole("button", { name: "Батжаргал Ану — үйлдэл" }));
    await user.click(await screen.findByRole("menuitem", { name: "Урих" }));

    expect(
      await screen.findByRole("dialog", { name: "Батжаргал Ану — эцэг эх урих" }),
    ).toBeInTheDocument();
  });

  it("leaves the administrator's roster menu as it was", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN"]) }]);
    renderWithProviders(<StudentRosterTable items={[CHILD]} />);

    await user.click(screen.getByRole("button", { name: "Батжаргал Ану — үйлдэл" }));
    await screen.findByRole("menuitem", { name: "Дэлгэрэнгүй" });
    expect(screen.queryByRole("menuitem", { name: "Урих" })).toBeNull();
  });

  /** Client, 2026-10-06: «Устгах», red, for whoever the API lets delete. */
  it("lets an administrator delete a child after confirming", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/children/22222222-2222-4222-8222-222222222222", method: "DELETE", body: {} },
    ]);
    renderWithProviders(<StudentRosterTable items={[CHILD]} />);

    await user.click(screen.getByRole("button", { name: "Батжаргал Ану — үйлдэл" }));
    const remove = await screen.findByRole("menuitem", { name: "Устгах" });
    expect(remove.className).toMatch(/text-danger/);
    await user.click(remove);

    const confirm = await screen.findByRole("dialog", { name: /устгах уу/ });
    expect(confirm).toHaveTextContent("Батжаргал Ану-г устгах уу?");
    await user.click(within(confirm).getByRole("button", { name: "Устгах" }));

    await waitFor(() =>
      expect(
        api.calls.some(
          (call) =>
            call.method === "DELETE" &&
            call.url === "/children/22222222-2222-4222-8222-222222222222",
        ),
      ).toBe(true),
    );
  });

  it("does not offer «Устгах» to a teacher", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    renderWithProviders(<StudentRosterTable items={[CHILD]} forTeacher />);

    await user.click(screen.getByRole("button", { name: "Батжаргал Ану — үйлдэл" }));
    await screen.findByRole("menuitem", { name: "Урих" });
    expect(screen.queryByRole("menuitem", { name: "Устгах" })).toBeNull();
  });
});
