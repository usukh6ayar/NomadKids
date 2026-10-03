import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import AdminGroupsPage from "@/app/(app)/admin/groups/page";

/**
 * Managing an existing group — `PATCH /groups/:id` and `DELETE /groups/:id`.
 *
 * ★ The two operations look alike and are not alike, which is the whole reason
 * this file is careful about which control does what.
 *
 * `PATCH { status: "ARCHIVED" | "ACTIVE" }` is a flag the row keeps: the group
 * stays in every listing, keeps its children, and flips back with one press.
 * `DELETE` runs `archiveGroup`, which sets `deletedAt` — after which
 * `baseWhere` hides the row from every query in the product and no endpoint
 * restores it. So the first is a toggle with no confirmation and the second is
 * confirmed, and these assert that the screen keeps them apart.
 *
 * ★★ `DELETE` also refuses while children are enrolled, with a 409 whose
 * message names the count and says what to do. That message is the instruction,
 * so it has to survive on screen rather than pass in a toast.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const YEAR = "55555555-5555-4555-8555-555555555555";

function group(over: Record<string, unknown> = {}) {
  return {
    id: GROUP,
    name: "Дунд бүлэг",
    ageBand: "JUNIOR",
    kindergartenId: KG,
    schoolYearId: YEAR,
    status: "ACTIVE",
    schoolYear: { id: YEAR, name: "2026-2027", isCurrent: true },
    _count: { enrollments: 0 },
    photoMediaFileId: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("эрх", () => {
  /** `RequireRole roles={["ADMIN"]}` gates the whole screen; a teacher never
   *  reaches any of these controls. */
  it("keeps a teacher off the screen entirely", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups",
        body: { items: [group()], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await waitFor(() => expect(screen.queryByRole("button", { name: /— засах/ })).toBeNull());
    expect(screen.queryByRole("button", { name: /архивлах/i })).toBeNull();
  });
});

/*
  ★ A table — client, 2026-09-25: "бүлгүүд хүснэгт хэлбэрээр харагд".
*/
/*
  ★ The client's 2026-09-25 drawing: filters, a compact table, a pager, and
  the four row actions — using only the endpoints that already exist.
*/
describe("the group list", () => {
  function stubList(items = [group({ name: "Наран бүлэг", _count: { enrollments: 18 } })]) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: "/groups",
        body: { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 },
      },
      {
        path: `/kindergartens/${KG}/school-years`,
        body: [{ id: YEAR, name: "2026-2027", isCurrent: true, kindergartenId: KG }],
      },
    ]);
  }

  it("lays the groups out as the drawing's table", async () => {
    stubList();
    renderWithProviders(<AdminGroupsPage />);

    const table = await screen.findByRole("table", { name: "Бүлгүүдийн жагсаалт" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["№", "Бүлгийн нэр", "Насны бүлэг", "Хөтөлбөр", "Бүлгийн багш", "Хүүхэд", "Үйлдэл"]);

    const row = within(table).getByRole("row", { name: /Наран бүлэг/ });
    expect(within(row).getByRole("link", { name: "Наран бүлэг" })).toHaveAttribute(
      "href",
      `/groups/${GROUP}`,
    );
    expect(within(row).getByText("18")).toBeInTheDocument();
    // The list carries no teacher yet: a dash, never a guess.
    expect(within(row).getAllByRole("cell")[4]).toHaveTextContent(/^—$/);
  });

  /*
    ★ Titled "Анги, бүлэг", and the table does not scroll or clip — 2026-09-25:
    the ⋯ menu came out cut off inside a scrolling, clipped box.
  */
  it("is titled Анги, бүлэг and keeps its table unclipped", async () => {
    stubList();
    renderWithProviders(<AdminGroupsPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Анги, бүлэг" }),
    ).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Бүлгүүдийн жагсаалт" });
    for (
      let node = table.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      expect(node.className).not.toMatch(/overflow-(hidden|x-auto|auto)/);
    }
  });

  it("shows the header actions and an honest sync line", async () => {
    stubList();
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("table", { name: "Бүлгүүдийн жагсаалт" });
    expect(screen.getByRole("button", { name: /ESIS татах/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Бүлэг нэмэх/ })).toBeInTheDocument();
    // A sync line only after a pull; "— " before one said nothing (2026-09-29).
    expect(screen.queryByText(/Нэгдсэн журмаар шинэчлэгдсэн/)).toBeNull();
    expect(screen.getByText(/Нийт/).textContent).toMatch(/Нийт 1 бүлэг/);
  });

  /*
    ★ 2026-09-28 — «ESIS татах» saves: one POST pulls the years and the groups,
    and the director is told what changed and what could not be placed.
  */
  it("pulls years and groups from ESIS and says what changed", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/sync-groups`,
        method: "POST",
        body: {
          schoolYears: { created: 1, updated: 0 },
          groups: { created: 5, updated: 2 },
          warnings: ["«X» бүлгийн мэдээлэл дутуу тул алгасав."],
          syncedAt: "2026-09-28T10:00:00Z",
        },
      },
      {
        path: "/groups",
        body: { items: [group()], page: 1, pageSize: 100, total: 1, totalPages: 1 },
      },
      {
        path: `/kindergartens/${KG}/school-years`,
        body: [{ id: YEAR, name: "2026-2027", isCurrent: true, kindergartenId: KG }],
      },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await user.click(await screen.findByRole("button", { name: /ESIS татах/ }));

    expect(
      await screen.findByText(/Хичээлийн жил: 1 шинэ, 0 шинэчилсэн · Бүлэг: 5 шинэ, 2 шинэчилсэн/),
    ).toBeInTheDocument();
    expect(screen.getByText("«X» бүлгийн мэдээлэл дутуу тул алгасав.")).toBeInTheDocument();
    expect(
      api.calls.filter((c) => c.method === "POST" && c.url.endsWith("/esis/sync-groups")),
    ).toHaveLength(1);
  });

  it("offers the four row actions", async () => {
    const user = userEvent.setup();
    stubList();
    renderWithProviders(<AdminGroupsPage />);

    await user.click(await screen.findByRole("button", { name: "Наран бүлэг — үйлдэл" }));
    for (const label of ["Мэдээлэл засах", "Багш солих", "Суралцагчдыг харах", "Устгах"]) {
      expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("filters by name as the director types", async () => {
    const user = userEvent.setup();
    stubList([
      group({ name: "Наран бүлэг" }),
      group({ id: "12121212-1212-4121-8121-121212121212", name: "Дэлбээ бүлэг" }),
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("table", { name: "Бүлгүүдийн жагсаалт" });
    await user.type(screen.getByRole("searchbox", { name: /Бүлэг эсвэл багш хайх/ }), "Дэлбээ");
    expect(screen.queryByRole("link", { name: "Наран бүлэг" })).toBeNull();
    expect(screen.getByRole("link", { name: "Дэлбээ бүлэг" })).toBeInTheDocument();
  });

  it("asks for name, age band, programme and teacher when adding", async () => {
    const user = userEvent.setup();
    stubList();
    renderWithProviders(<AdminGroupsPage />);

    await user.click(await screen.findByRole("button", { name: /Бүлэг нэмэх/ }));
    const dialog = screen.getByRole("dialog", { name: "Бүлэг нэмэх" });
    for (const label of ["Бүлгийн нэр", "Насны бүлэг", "Хөтөлбөр", "Бүлгийн багш"]) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    expect(within(dialog).getByRole("button", { name: "Хадгалах" })).toBeDisabled();
  });

  /*
    ★ Багш хуваарилалт — 2026-09-25: two lists, each with its own add, a bin
    on every row, and the warning when nobody is left to add.
  */
  it("assigns teachers in two lists, lead and assistant", async () => {
    const user = userEvent.setup();
    const lead = {
      id: "61616161-6161-4616-8616-616161616161",
      role: "LEAD",
      endedOn: null,
      membership: {
        id: "62626262-6262-4626-8626-626262626262",
        user: {
          id: "63636363-6363-4636-8636-636363636363",
          lastName: "Дэлгэрмаа",
          firstName: "Сувдаа",
        },
      },
    };
    const assistant = {
      ...lead,
      id: "64646464-6464-4646-8646-646464646464",
      role: "ASSISTANT",
      membership: {
        id: "65656565-6565-4656-8656-656565656565",
        user: {
          id: "66666666-6666-4666-8666-666666666666",
          lastName: "Ариунаа",
          firstName: "Золжаргал",
        },
      },
    };
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/groups/${GROUP}`,
        body: { ...group({ name: "Дэлбээ" }), teachers: [lead, assistant] },
      },
      {
        path: "/groups",
        body: {
          items: [group({ name: "Дэлбээ" })],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
      { path: "/users", body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 } },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await user.click(await screen.findByRole("button", { name: "Дэлбээ — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: /Багш солих/ }));
    const dialog = await screen.findByRole("dialog", { name: "Дэлбээ — багш" });

    expect(within(dialog).getByRole("heading", { name: "Багш хуваарилалт" })).toBeInTheDocument();
    const leads = within(dialog).getByRole("region", { name: /Бүлгийн багш/ });
    expect(await within(leads).findByText("Дэлгэрмаа Сувдаа")).toBeInTheDocument();
    const assistants = within(dialog).getByRole("region", { name: /Багшийн туслах/ });
    expect(within(assistants).getByText("Ариунаа Золжаргал")).toBeInTheDocument();
    expect(
      within(assistants).getByRole("button", { name: "Ариунаа Золжаргал-г бүлгээс хасах" }),
    ).toBeInTheDocument();
    expect(await within(dialog).findByText(/Нэмэх багш алга/)).toBeInTheDocument();
    // No class-photo upload here since 2026-09-25.
    expect(within(dialog).queryByText("Ангийн зураг нэмэх")).toBeNull();
  });
});

/*
  ★ ЭСИС рүү илгээлт — the write queue, moved here from «ЭСИС холболт» on
  2026-10-01: the writes are prepared on this screen, so the record of what
  was sent and what ESIS answered sits under the groups.
*/
describe("ЭСИС рүү илгээлт", () => {
  it("lists the kindergarten's ESIS writes under the groups", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        body: {
          items: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              service: "groupCreate",
              apiId: 1,
              state: "PREPARED",
              payload: {},
              response: null,
              errorCode: null,
              sentAt: null,
              createdAt: "2026-10-01T09:00:00.000Z",
              groupId: GROUP,
              group: { id: GROUP, name: "Наран бүлэг" },
              preparedBy: null,
              approvedBy: null,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: "/groups",
        body: { items: [group()], page: 1, pageSize: 100, total: 1, totalPages: 1 },
      },
      { path: `/kindergartens/${KG}/school-years`, body: [] },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    const section = await screen.findByRole("region", { name: "ЭСИС рүү илгээлт" });
    expect(await within(section).findByText("Хүлээгдэж байна")).toBeInTheDocument();
  });
});
