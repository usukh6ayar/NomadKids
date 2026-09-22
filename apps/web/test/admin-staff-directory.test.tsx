import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import AdminUsersPage from "@/app/(app)/admin/users/page";

/**
 * `/admin/users` — who works here, and where that answer comes from.
 *
 * ★ **The screen had no test at all** until 2026-09-22, which is worth
 * recording rather than quietly fixing: CLAUDE.md §4.4 names
 * `admin-users.test.tsx` as one of the intermittent failures it is still
 * chasing, and that file does not exist in the tree. So the flake it describes
 * cannot recur here, and the screen it described has been unguarded since
 * whenever it went. This file does not restore those cases — it covers the
 * section added today.
 *
 * ★★ The client, 2026-09-22: "Багш ажилчид хэсэг рүү орохоор ссайзаас татах
 * хэсгүүд зай бага эзлэх, дээд хэсэгт бүртгэгдсэн багш ажилчдыг харуулах."
 */

/** `sessionFor`'s kindergarten, which the page reads off the session. */
const KG = "33333333-3333-4333-8333-333333333333";

const overview = {
  counts: { children: 12, groups: 3, staff: 2, families: 9, activeFamilies: 7 },
};

const staff = {
  items: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      username: "bayar",
      email: null,
      phone: "99112233",
      lastName: "Ганболд",
      firstName: "Баяр",
      esisPersonId: "90000000000001",
      isActive: true,
      memberships: [
        { id: "55555555-5555-4555-8555-555555555555", kindergartenId: KG, role: "TEACHER" },
      ],
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      username: "tuya",
      email: "tuya@example.mn",
      phone: null,
      lastName: "Дорж",
      firstName: "Туяа",
      esisPersonId: null,
      isActive: true,
      /*
       * ★ Two roles in one kindergarten, which is the case the roles cell is
       * written for. A cook who also keeps the books is ordinary in a small
       * kindergarten, and showing one of the two would hide the other on the
       * only screen that lists it.
       */
      memberships: [
        { id: "77777777-7777-4777-8777-777777777777", kindergartenId: KG, role: "COOK" },
        { id: "88888888-8888-4888-8888-888888888888", kindergartenId: KG, role: "ACCOUNTANT" },
      ],
    },
  ],
  page: 1,
  pageSize: 200,
  total: 2,
  totalPages: 1,
};

/** No ESIS: the catalog 404s, so both ministry panels render nothing. */
function stubScreen() {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: "/dashboard/admin", body: overview },
    { path: "/users", body: staff },
  ]);
}

describe("/admin/users — бүртгэгдсэн ажилтан", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the kindergarten's own staff accounts", async () => {
    stubScreen();
    renderWithProviders(<AdminUsersPage />);

    expect(await screen.findByText("Г.Баяр")).toBeInTheDocument();
    expect(screen.getByText("Д.Туяа")).toBeInTheDocument();
    expect(screen.getByText("Багш")).toBeInTheDocument();
  });

  /*
   * ★ Every role they hold, joined — not the first membership. The failure this
   * catches is silent: the cell would read "Тогооч" and nothing on the screen
   * would say the same person is also the нягтлан.
   */
  it("names every role a person holds here", async () => {
    stubScreen();
    renderWithProviders(<AdminUsersPage />);

    await screen.findByText("Д.Туяа");
    expect(screen.getByText("Тогооч, Нягтлан")).toBeInTheDocument();
  });

  /*
   * ★★ **The request the section is built on was already being made.**
   *
   * `staffAccounts` fetched two hundred accounts to map an ESIS `personId` onto
   * one of them and rendered none of them — its own note says so. The table
   * reads that query; it must not add a third.
   *
   * ★ Two is the correct number, not one. The screen deliberately keeps a
   * separate `pageSize: 1` request for the count tile — its docblock gives the
   * reason: merging them "would make the count tile depend on a list it does
   * not read". So this asserts the pair, and that one of them is the 200 the
   * table draws.
   */
  it("adds no /users request of its own", async () => {
    stubScreen();
    renderWithProviders(<AdminUsersPage />);

    await screen.findByText("Г.Баяр");
    const userCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map((call) => String(call[0]))
      .filter((url) => url.includes("/users?"));

    expect(userCalls).toHaveLength(2);
    expect(userCalls.filter((url) => url.includes("pageSize=200"))).toHaveLength(1);
    expect(userCalls.filter((url) => url.includes("pageSize=1"))).toHaveLength(1);
  });

  /*
   * ★ The ordering *is* the request — "дээд хэсэгт бүртгэгдсэн багш ажилчдыг
   * харуулах". Asserting both headings exist would pass with them the wrong way
   * round, so this compares their positions in the document.
   */
  it("puts the registered staff above the rest of the screen", async () => {
    stubScreen();
    renderWithProviders(<AdminUsersPage />);

    /*
     * ★ Wait for a **row**, not the heading. The heading renders immediately —
     * it sits outside the loading branch — so waiting on it resolves while the
     * `/users` request is still in flight and the section is still a skeleton.
     * The first version of this test did that and failed looking for a table
     * that had not been drawn yet.
     */
    await screen.findByText("Г.Баяр");

    const heading = screen.getByText("Бүртгэгдсэн багш, ажилтан");
    const table = screen.getByRole("table");
    const tiles = screen.getByText("Багш, ажилтан");

    // The count tiles, then the heading, then its table — in that order.
    expect(tiles.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /*
   * ★ A skeleton while the request is in flight, not "nobody has registered".
   *
   * The empty state tells a director to go and invite people, so showing it
   * before the answer arrives gives the wrong instruction to somebody whose
   * staff list is full. This is also what makes the case below mean anything:
   * without the split, asserting the empty state would pass against a screen
   * that had simply not loaded.
   */
  it("does not claim the list is empty while it is still loading", () => {
    stubScreen();
    renderWithProviders(<AdminUsersPage />);

    expect(screen.queryByText("Бүртгэгдсэн ажилтан байхгүй")).toBeNull();
  });

  it("says what to do when nobody has registered yet", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/dashboard/admin", body: overview },
      { path: "/users", body: { items: [], page: 1, pageSize: 200, total: 0, totalPages: 0 } },
    ]);
    renderWithProviders(<AdminUsersPage />);

    expect(await screen.findByText("Бүртгэгдсэн ажилтан байхгүй")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
