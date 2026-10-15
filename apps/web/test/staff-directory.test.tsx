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
const user_ = (id: string, lastName: string, firstName: string, role: string) =>
  user(id, lastName, firstName, role, "99000000");

function page(items: unknown[]) {
  return { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 };
}

function stub(extra: Parameters<typeof stubApi>[0] = []) {
  return stubApi([
    ...extra,
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: "/users/positions", body: ["Арга зүйч", "Бүлгийн багш"] },
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

    await user.click(await screen.findByRole("button", { name: /Анхбаяр Энх-Адьяа — үйлдэл/ }));
    for (const label of [
      "Мэдээлэл харах",
      "Мэдээлэл засах",
      "Бүлэг оноох / солих",
      "Системийн эрх тохируулах",
      "Нууц үг сэргээх",
      "Идэвхгүй болгох",
    ]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  /*
   * ★ #213: «Идэвхгүй болгох» closes this kindergarten's role, not the account
   * — `DELETE /memberships/:id`, never `PATCH /users/:id { isActive }`.
   */
  it("deactivates the membership here, not the whole account", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AdminUsersPage />);

    await user.click(await screen.findByRole("button", { name: /Анхбаяр Энх-Адьяа — үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: /Идэвхгүй болгох/ }));
    const membershipId = TEACHER.memberships[0]!.id;
    const api = stubApi([{ path: `/memberships/${membershipId}`, method: "DELETE", status: 204 }]);
    const dialog = await screen.findByRole("dialog", { name: "Идэвхгүй болгох уу?" });
    await user.click(within(dialog).getByRole("button", { name: "Идэвхгүй болгох" }));

    await waitFor(() =>
      expect(
        api.calls.some((c) => c.method === "DELETE" && c.url === `/memberships/${membershipId}`),
      ).toBe(true),
    );
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  /*
   * ★ 2026-10-15, the user: a kindergarten without ESIS invites a member of
   * staff who has never signed in from the row's ⋯ — a one-time link, through
   * `POST /users/:id/password-reset` until a reissue route exists.
   */
  it("invites, from the row, a member of staff who has never signed in — without ESIS", async () => {
    const user = userEvent.setup();
    const api = stub([
      { path: `/kindergartens/${KG}`, body: { esisInstitutionId: null } },
      {
        path: `/users/${TEACHER_ID}/password-reset`,
        method: "POST",
        body: { resetToken: "tok-123" },
      },
    ]);
    renderWithProviders(<AdminUsersPage />);

    await user.click(await screen.findByRole("button", { name: /Анхбаяр Энх-Адьяа — үйлдэл/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Урих/ }));
    const dialog = await screen.findByRole("dialog", { name: "Урих" });
    await user.click(within(dialog).getByRole("button", { name: "Урилга үүсгэх" }));

    expect(await screen.findByText("Урилгын холбоос")).toBeInTheDocument();
    expect(
      api.calls.some((c) => c.method === "POST" && c.url === `/users/${TEACHER_ID}/password-reset`),
    ).toBe(true);
  });

  it("offers no «Урих» with ESIS, nor to someone who has signed in", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/users/positions", body: [] },
      {
        path: "/users?roles=TEACHER",
        body: page([{ ...TEACHER, lastLoginAt: "2026-10-10T08:00:00Z" }]),
      },
      { path: "/users?roles=COOK", body: page([COOK]) },
      { path: `/kindergartens/${KG}`, body: { esisInstitutionId: null } },
    ]);
    const { unmount } = renderWithProviders(<AdminUsersPage />);

    await user.click(await screen.findByRole("button", { name: /Анхбаяр Энх-Адьяа — үйлдэл/ }));
    expect(await screen.findByRole("menuitem", { name: /Нууц үг сэргээх/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Урих/ })).not.toBeInTheDocument();
    unmount();

    stub([{ path: `/kindergartens/${KG}`, body: { esisInstitutionId: "12345" } }]);
    renderWithProviders(<AdminUsersPage />);
    await user.click(await screen.findByRole("button", { name: /Анхбаяр Энх-Адьяа — үйлдэл/ }));
    expect(await screen.findByRole("menuitem", { name: /Нууц үг сэргээх/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Урих/ })).not.toBeInTheDocument();
  });

  it("hands over a one-time reset link, or the server's reason it may not", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AdminUsersPage />);

    await user.click(await screen.findByRole("button", { name: /Анхбаяр Энх-Адьяа — үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: /Нууц үг сэргээх/ }));
    stubApi([
      {
        path: `/users/${TEACHER_ID}/password-reset`,
        method: "POST",
        status: 409,
        body: {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "Энэ хүн өөр байгууллагад бүртгэлтэй.",
          requestId: "t",
        },
      },
    ]);
    // Checked first — the same dialog as everywhere a link is handed over.
    const issue = await screen.findByRole("button", { name: "Холбоос үүсгэх" });
    expect(issue).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /мөн гэдгийг шалгасан/ }));
    await user.click(issue);

    expect(await screen.findByText("Энэ хүн өөр байгууллагад бүртгэлтэй.")).toBeInTheDocument();
  });

  /*
   * ★ 2026-10-14, the user: a director is reset by themself (SMS) or by
   * NomadKids — the row says so instead of an error; and one's own row has no
   * «Нууц үг сэргээх», since one's own password is changed in settings.
   */
  it("tells who resets a director, and leaves the option off one's own row", async () => {
    const user = userEvent.setup();
    const DIRECTOR = user_("77777777-7777-4777-8777-000000000003", "Дорж", "Сараа", "ADMIN");
    const ME = user_("11111111-1111-4111-8111-111111111111", "Би", "Өөрөө", "ADMIN");
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/users/positions", body: [] },
      { path: "/users?roles=TEACHER", body: page([TEACHER]) },
      { path: "/users?roles=ADMIN", body: page([DIRECTOR, ME]) },
    ]);
    renderWithProviders(<AdminUsersPage />);

    await user.click(await screen.findByRole("button", { name: /Би Өөрөө — үйлдэл/ }));
    expect(screen.queryByRole("menuitem", { name: /Нууц үг сэргээх/ })).toBeNull();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: /Дорж Сараа — үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: /Нууц үг сэргээх/ }));
    const dialog = await screen.findByRole("dialog", { name: "Нууц үг сэргээх" });
    expect(dialog).toHaveTextContent("SMS-ээр өөрөө сэргээнэ");
    expect(within(dialog).getByRole("link", { name: "7213 4888" })).toHaveAttribute(
      "href",
      "tel:+97672134888",
    );
    expect(within(dialog).queryByRole("button", { name: "Холбоос үүсгэх" })).toBeNull();
    expect(api.calls.some((c) => c.url.endsWith("/password-reset"))).toBe(false);
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

  // A post is free text, so the choices are the ones in use; a category is a list.
  it("filters teachers by post and staff by category through the API", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<AdminUsersPage />);

    const teachers = (await screen.findByRole("heading", { name: "Багш" })).closest("section")!;
    await user.click(await within(teachers).findByLabelText("Албан тушаал"));
    await user.click(await screen.findByRole("option", { name: "Арга зүйч" }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.url.includes("position=%D0%90%D1%80%D0%B3%D0%B0"))).toBe(true),
    );

    const staff = screen.getByRole("heading", { name: "Ажилтан" }).closest("section")!;
    await user.click(within(staff).getByLabelText("Ангилал"));
    await user.click(await screen.findByRole("option", { name: "Үйлчилгээ" }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.url.includes("staffCategory=SERVICE"))).toBe(true),
    );
  });

  // It linked to `/admin/integrations/esis`, deleted 2026-09-14 — a 404.
  it("refreshes the ESIS staff roster in place rather than leaving the page", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/users", body: page([]) },
      {
        path: "/kindergartens/",
        method: "POST",
        body: { count: 13, skipped: 0, syncedAt: "2026-09-28T00:00:00.000Z" },
      },
    ]);
    renderWithProviders(<AdminUsersPage />);

    const section = (await screen.findByRole("heading", { name: "Багш" })).closest("section")!;
    await user.click(within(section).getByRole("button", { name: /ESIS татах/ }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url.endsWith("/esis/staff-roster/refresh")),
      ).toBe(true),
    );
    expect(
      await screen.findByText(/ESIS-ээс 13 ажилтны мэдээлэл шинэчлэгдлээ/),
    ).toBeInTheDocument();
  });

  it("links an ESIS person to an account that already exists", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/users", body: page([TEACHER, { ...COOK, esisPersonId: "esis-cook" }]) },
      {
        path: `/kindergartens/${KG}/esis/staff-roster/unclaimed`,
        body: page([
          {
            esisPersonId: "esis-teacher",
            lastName: "Анхбаяр",
            firstName: "Энх-Адьяа",
            positionName: "Багш",
            isInstructor: true,
            syncedAt: "2026-09-28T00:00:00.000Z",
          },
        ]),
      },
      { path: `/kindergartens/${KG}/esis/staff-link`, method: "POST", body: {} },
    ]);
    renderWithProviders(<AdminUsersPage />);

    await user.click(await screen.findByRole("button", { name: /бүртгэлтэй холбох/ }));
    const dialog = await screen.findByRole("dialog", { name: "Бүртгэлтэй холбох" });
    await user.click(within(dialog).getByRole("combobox"));
    // The cook already carries an ESIS person, so only the teacher is offered.
    expect(screen.queryByRole("option", { name: /Ёндонжамц/ })).toBeNull();
    await user.click(await screen.findByRole("option", { name: /Энх-Адьяа/ }));
    await user.click(within(dialog).getByRole("button", { name: "Холбох" }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.method === "POST" && c.url.endsWith("/esis/staff-link"))?.body,
      ).toEqual({
        userId: TEACHER_ID,
        esisPersonId: "esis-teacher",
      }),
    );
  });
});
