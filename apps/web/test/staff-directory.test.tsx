import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import AdminUsersPage from "@/app/(app)/admin/users/page";

/**
 * Багш ба Ажилтан — the director's staff directory, client 2026-09-25.
 *
 * ★ What is pinned beyond the layout is that nothing is invented: register,
 * group, category, birth and hire dates are not on a staff account, so they
 * read "—".
 */

const KG = "33333333-3333-4333-8333-333333333333";
const TEACHER_ID = "77777777-7777-4777-8777-000000000001";
const COOK_ID = "77777777-7777-4777-8777-000000000002";

function user(id: string, lastName: string, firstName: string, role: string, phone: string) {
  return {
    id,
    username: firstName.toLowerCase(),
    email: `${id.slice(-1)}@example.mn`,
    phone,
    lastName,
    firstName,
    isActive: true,
    lastLoginAt: null,
    memberships: [{ id: `${id.slice(0, -1)}9`, kindergartenId: KG, role, isActive: true }],
  };
}

const TEACHER = (() => {
  const base = user(TEACHER_ID, "Анхбаяр", "Энх-Адьяа", "TEACHER", "99112233");
  return {
    ...base,
    registerNumber: "УБ92010112",
    memberships: [
      {
        ...base.memberships[0]!,
        position: "Бүлгийн багш",
        groups: [{ id: "55555555-5555-4555-8555-555555555555", name: "Дэлбээ", role: "LEAD" }],
      },
    ],
  };
})();
const COOK = user(COOK_ID, "Батаа", "Ёндонжамц", "COOK", "88113344");

function page(items: unknown[]) {
  return { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 };
}

function stub() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: "/users?roles=TEACHER", body: page([TEACHER]) },
    { path: "/users?roles=COOK", body: page([COOK]) },
    { path: "/users?roles=ADMIN", body: page([COOK]) },
    { path: `/users/${TEACHER_ID}`, body: { ...TEACHER, specialization: "СӨБ-ийн багш" } },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the staff directory", () => {
  it("lists teachers and staff in two tables, inventing nothing", async () => {
    stub();
    renderWithProviders(<AdminUsersPage />);

    const teachers = await screen.findByRole("table", { name: "Багшийн жагсаалт" });
    expect(
      within(teachers)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["№", "Багшийн нэр", "Регистр", "Албан тушаал", "Хариуцсан бүлэг", "Утас", "Үйлдэл"]);
    const row = within(teachers).getByRole("row", { name: /А\.Энх-Адьяа/ });
    const cells = within(row).getAllByRole("cell");
    // #147's fields: register, the post held here, and the live groups.
    expect(cells[2]).toHaveTextContent("УБ92010112");
    expect(cells[3]).toHaveTextContent("Бүлгийн багш");
    expect(cells[4]).toHaveTextContent("Дэлбээ");
    expect(cells[5]).toHaveTextContent("99112233");

    const staff = await screen.findByRole("table", { name: "Ажилтны жагсаалт" });
    expect(within(staff).getByText("Батаа Ёндонжамц")).toBeInTheDocument();
    expect(within(staff).getByText("Тогооч")).toBeInTheDocument();
  });

  it("offers only the actions that exist", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AdminUsersPage />);

    const section = (await screen.findByRole("heading", { name: "Багш" })).closest("section")!;
    // The section's own filters, every page — `GET /users/export`.
    expect(within(section).getByRole("link", { name: /Excel/ }).getAttribute("href")).toContain(
      "/users/export?roles=TEACHER",
    );
    expect(within(section).getByRole("link", { name: /ESIS татах/ })).toHaveAttribute(
      "href",
      "/admin/integrations/esis",
    );

    await user.click(await screen.findByRole("button", { name: /Анхбаяр Энх-Адьяа — үйлдэл/ }));
    for (const label of [
      "Мэдээлэл харах",
      "Мэдээлэл засах",
      "Бүлэг оноох / солих",
      "Системийн эрх тохируулах",
      "Идэвхгүй болгох",
    ]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("starts an invitation in the section's own role", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AdminUsersPage />);

    await user.click(await screen.findByRole("button", { name: /Багш нэмэх/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: /Эрх/ })).toHaveTextContent("Багш");
  });

  it("narrows the staff table by position through the API", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<AdminUsersPage />);

    await screen.findByRole("table", { name: "Ажилтны жагсаалт" });
    const staff = screen.getByRole("heading", { name: "Ажилтан" }).closest("section")!;
    const position = within(staff).getByRole("combobox", { name: "Албан тушаал" });
    await user.click(position);
    await user.click(await screen.findByRole("option", { name: "Тогооч" }));
    await waitFor(() => expect(api.calls.some((c) => c.url.includes("roles=COOK"))).toBe(true));
  });

  it("opens the person in a side panel with its tabs", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AdminUsersPage />);

    await user.click(await screen.findByRole("button", { name: "А.Энх-Адьяа" }));
    const panel = await screen.findByRole("dialog", { name: "Багшийн мэдээлэл" });
    expect(await within(panel).findByText("Идэвхтэй")).toBeInTheDocument();
    expect(
      within(panel)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Ерөнхий", "Ажлын мэдээлэл", "Бүлэг/үүрэг", "Системийн эрх"]);
    expect(within(panel).getByText("99112233")).toBeInTheDocument();
    // The person's own record — and a dash for what nobody filled in, never a guess.
    expect(within(panel).getByText("Регистр").nextElementSibling).toHaveTextContent("УБ92010112");
    expect(within(panel).getByText("Төрсөн огноо").nextElementSibling).toHaveTextContent("—");

    await user.click(within(panel).getByRole("tab", { name: "Ажлын мэдээлэл" }));
    expect(within(panel).getByText("СӨБ-ийн багш")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Мэдээлэл засах" })).toBeInTheDocument();
  });

  /*
    ★ The post is the membership's, not the person's — #147. Албан тушаал goes
    to `PATCH /memberships/:id/profile`, the register to `PATCH /users/:id`.
  */
  it("saves the register to the person and the post to their membership", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/users/", method: "PATCH", body: {} },
      { path: "/memberships/", method: "PATCH", body: {} },
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/users?roles=TEACHER", body: page([TEACHER]) },
      { path: "/users?roles=ADMIN", body: page([COOK]) },
    ]);
    renderWithProviders(<AdminUsersPage />);

    await user.click(await screen.findByRole("button", { name: /Анхбаяр Энх-Адьяа — үйлдэл/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Мэдээлэл засах" }));
    const dialog = await screen.findByRole("dialog", { name: "Мэдээлэл засах" });
    const post = within(dialog).getByLabelText(/^Албан тушаал/);
    await user.clear(post);
    await user.type(post, "Арга зүйч");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const profile = api.calls.find(
        (c) =>
          c.method === "PATCH" && c.url === `/memberships/${TEACHER.memberships[0]!.id}/profile`,
      );
      expect(profile?.body).toMatchObject({ position: "Арга зүйч" });
    });
    const person = api.calls.find((c) => c.method === "PATCH" && c.url === `/users/${TEACHER_ID}`);
    expect(person?.body).toMatchObject({ registerNumber: "УБ92010112" });
  });
});
