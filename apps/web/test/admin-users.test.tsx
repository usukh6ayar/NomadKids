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
import AdminUsersPage from "@/app/(app)/admin/users/page";

/**
 * Managing an existing account — `PATCH /users/:id` and
 * `POST /users/:id/memberships`.
 *
 * ★ Both endpoints shipped with the users module and neither had a caller, so
 * an admin could create a user and revoke a role but never correct a mistyped
 * phone number or grant a second one.
 *
 * ★★ What these pin is the *contract*, because it is narrower than it looks.
 *
 * `updateUserSchema` accepts exactly `lastName`, `firstName`, `email`, `phone`
 * and `isActive` — `username` is absent from it, and the professional fields
 * belong to `PATCH /me/profile`. `addMembershipSchema` requires a
 * `kindergartenId` as well as a `role`, so a membership is a pair and not a
 * dropdown. A form that drifts from either would fail silently: Zod strips
 * unknown keys rather than rejecting them, so an extra field is simply lost.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const OTHER_KG = "77777777-7777-4777-8777-777777777777";
const USER = "44444444-4444-4444-8444-444444444444";

function user(over: Record<string, unknown> = {}) {
  return {
    id: USER,
    username: "bagsh9",
    email: "bagsh9@nomadkids.mn",
    phone: "99112233",
    lastName: "Дорж",
    firstName: "Болд",
    isActive: true,
    lastLoginAt: null,
    memberships: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        kindergartenId: KG,
        role: "TEACHER",
        isActive: true,
      },
    ],
    ...over,
  };
}

function stubUsers(over: Record<string, unknown> = {}, extra: Parameters<typeof stubApi>[0] = []) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    ...extra,
    {
      path: "/users?",
      body: { items: [user(over)], page: 1, pageSize: 50, total: 1, totalPages: 1 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("хэрэглэгч засах", () => {
  it("offers an edit action on the row", async () => {
    stubUsers();
    renderWithProviders(<AdminUsersPage />);

    expect(await screen.findByRole("button", { name: "Засах" })).toBeInTheDocument();
  });

  it("prefills the form from the row", async () => {
    stubUsers();
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/Овог/)).toHaveValue("Дорж");
    expect(within(dialog).getByLabelText(/Нэр/)).toHaveValue("Болд");
    expect(within(dialog).getByLabelText(/И-мэйл/)).toHaveValue("bagsh9@nomadkids.mn");
    expect(within(dialog).getByLabelText(/Утас/)).toHaveValue("99112233");
  });

  /**
   * ★ `username` is not in `updateUserSchema`. Rendering an input for it would
   * offer an edit the API silently drops — Zod strips unknown keys.
   */
  it("shows the login name as context, never as an editable field", async () => {
    stubUsers();
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/Нэвтрэх нэр: bagsh9/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Нэвтрэх нэр/)).toBeNull();
  });

  it("cancelling sends nothing", async () => {
    const { calls } = stubUsers();
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("submits exactly the fields the API accepts", async () => {
    const { calls } = stubUsers({}, [
      { path: `/users/${USER}`, method: "PATCH", body: user({ phone: "99000000" }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog");
    const phone = within(dialog).getByLabelText(/Утас/);
    await u.clear(phone);
    await u.type(phone, "99000000");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch!.url).toBe(`/users/${USER}`);
      expect(patch!.body).toEqual({
        lastName: "Дорж",
        firstName: "Болд",
        email: "bagsh9@nomadkids.mn",
        phone: "99000000",
        isActive: true,
      });
    });
  });

  /** An empty box means "no email", which the API spells `null`. `""` fails its
   *  format check, so the difference is between clearing and a 400. */
  it("clears an emptied email as null rather than an empty string", async () => {
    const { calls } = stubUsers({}, [
      { path: `/users/${USER}`, method: "PATCH", body: user({ email: null }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.clear(within(dialog).getByLabelText(/И-мэйл/));
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ email: null }),
    );
  });

  it("sends isActive false when the account is deactivated", async () => {
    const { calls } = stubUsers({}, [
      { path: `/users/${USER}`, method: "PATCH", body: user({ isActive: false }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByLabelText(/Идэвхтэй/));
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ isActive: false }),
    );
  });

  it("refetches the list and confirms with a toast", async () => {
    const { calls } = stubUsers({}, [{ path: `/users/${USER}`, method: "PATCH", body: user() }]);
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    await u.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Хадгалах" }),
    );

    await waitFor(() => {
      expect(
        calls.filter((c) => c.method === "GET" && c.url.startsWith("/users?")).length,
      ).toBeGreaterThan(1);
    });
    expect(await screen.findByText(/хадгалагдлаа/)).toBeInTheDocument();
  });

  /**
   * ★ A 400 names the field, so the message belongs under that input.
   *
   * This is not hypothetical: `demo-data.ts` seeds phone numbers as
   * `+9769900xxxx` straight through Prisma, bypassing `phoneSchema`, which
   * wants eight digits starting 5–9. Verified against the running API — opening
   * such a user and pressing save really does return
   * `errors: { phone: ["Утасны дугаар 8 оронтой байх ёстой"] }`. The admin has
   * to see which box is wrong, not a banner.
   */
  it("puts a field validation error under the field it belongs to", async () => {
    stubUsers({}, [
      {
        path: `/users/${USER}`,
        method: "PATCH",
        status: 400,
        body: {
          type: "about:blank",
          title: "Мэдээлэл буруу байна",
          status: 400,
          requestId: "test",
          errors: { phone: ["Утасны дугаар 8 оронтой байх ёстой"] },
          detail: "Утасны дугаар 8 оронтой байх ёстой",
        },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    const message = await within(dialog).findByText("Утасны дугаар 8 оронтой байх ёстой");
    expect(message).toBeInTheDocument();
    // Bound to the input, not just floating near it.
    const phone = within(dialog).getByLabelText(/Утас/);
    expect(phone.getAttribute("aria-describedby")).toContain(message.id);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  /** A 409 for a duplicate email carries no field name, so it belongs above the
   *  form rather than under an input — and it must not close the dialog. */
  it("keeps a conflict visible with the form still open", async () => {
    stubUsers({}, [
      {
        path: `/users/${USER}`,
        method: "PATCH",
        status: 409,
        body: {
          type: "about:blank",
          // ★ `detail`, not `title`. `problem.filter.ts` puts the exception's
          // message in `detail` and a generic status phrase in `title`, and
          // `errorMessage()` reads `detail`. A fixture that sets only `title`
          // tests a shape the API never sends.
          title: "Зөрчил",
          detail: "Энэ и-мэйл аль хэдийн бүртгэлтэй",
          status: 409,
          requestId: "test",
        },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    expect(await within(dialog).findByText(/аль хэдийн бүртгэлтэй/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("эрх нэмэх", () => {
  it("offers the action and asks for a role", async () => {
    stubUsers();
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Эрх нэмэх" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/^Эрх \*/)).toBeInTheDocument();
  });

  /**
   * ★ The pair, not just the role. `addMembershipSchema` requires
   * `kindergartenId`; a body without it is a 400.
   */
  it("posts a kindergarten and a role together", async () => {
    const { calls } = stubUsers({}, [
      { path: `/users/${USER}/memberships`, method: "POST", body: {} },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Эрх нэмэх" }));
    const dialog = await screen.findByRole("dialog");
    await selectOption(u, /^Эрх \*/, "Админ");
    await u.click(within(dialog).getByRole("button", { name: "Эрх нэмэх" }));

    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/memberships"));
      expect(post).toBeDefined();
      expect(post!.body).toEqual({ kindergartenId: KG, role: "ADMIN" });
    });
  });

  /**
   * ★★ One kindergarten is the normal case, and a select with one option is a
   * control nobody can use — the value still goes in the request.
   */
  it("hides the kindergarten picker when the admin runs only one", async () => {
    stubUsers();
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Эрх нэмэх" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Цэцэрлэг/)).toBeNull();
  });

  /** Shown so an admin can see a role is already held before submitting —
   *  without the form refusing a re-grant the API would have accepted. */
  it("reports the roles already held", async () => {
    stubUsers({
      memberships: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          kindergartenId: KG,
          role: "TEACHER",
          isActive: false,
        },
      ],
    });
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Эрх нэмэх" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Багш \(хураасан\)/)).toBeInTheDocument();
  });

  /**
   * ★★★ Re-granting an already-active role is a 409 whose message is the
   * explanation. The form shows it and stays open; it never pre-filters the
   * role list, because re-granting a *revoked* role is supposed to work.
   */
  it("surfaces the duplicate-role conflict from the API", async () => {
    stubUsers({}, [
      {
        path: `/users/${USER}/memberships`,
        method: "POST",
        status: 409,
        body: {
          type: "about:blank",
          title: "Зөрчил",
          detail: "Энэ хэрэглэгч аль хэдийн энэ эрхтэй байна",
          status: 409,
          requestId: "test",
        },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Эрх нэмэх" }));
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Эрх нэмэх" }));

    expect(await within(dialog).findByText(/аль хэдийн энэ эрхтэй/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers every role the API accepts, and no others", async () => {
    stubUsers();
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Эрх нэмэх" }));
    await u.click(await screen.findByLabelText(/^Эрх \*/));

    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["Багш", "Админ", "Эцэг эх"]);
  });
});

describe("эрхгүй тохиолдол", () => {
  /**
   * `addMembership` calls `assertAdmin` on the *target* kindergarten, so a
   * session with no ADMIN membership has nothing it may grant into. The button
   * is withheld rather than offered and refused.
   */
  it("shows no membership action when the session administers nothing", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/users?",
        body: { items: [user()], page: 1, pageSize: 50, total: 1, totalPages: 1 },
      },
    ]);
    renderWithProviders(<AdminUsersPage />);

    // `RequireRole roles={["ADMIN"]}` keeps a teacher off the screen entirely,
    // which is the stronger guarantee and the one worth asserting.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Эрх нэмэх" })).toBeNull());
  });

  it("does not offer a kindergarten this admin does not administer", async () => {
    stubUsers({}, [{ path: "/kindergartens", body: [{ id: OTHER_KG, name: "Өөр цэцэрлэг" }] }]);
    const u = userEvent.setup();
    renderWithProviders(<AdminUsersPage />);

    await u.click(await screen.findByRole("button", { name: "Эрх нэмэх" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Өөр цэцэрлэг")).toBeNull();
  });
});
