import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import AdminGroupsPage from "@/app/(app)/admin/groups/page";

/**
 * `/admin/groups` — Бүлгүүд, the class grid.
 *
 * ★ **The question this screen exists to answer is "which class has nobody
 * teaching it".** It could not answer it until `GET /groups` carried its
 * assignments: the only way to learn a group's teacher was `GET /groups/:id`,
 * once per row, which is the N+1 §3.4 forbids. So the cases below are mostly
 * about the teacher — the card's block, the summary tile, and the fact that a
 * group is reached by its **local** id.
 *
 * ★★ The four controls `f265b03` deleted — Дэвшүүлэх, Засах, Архивлах,
 * Устгах — stay deleted. The role case at the foot is the one this file
 * already carried and is kept verbatim.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const BARE = "99999999-9999-4999-8999-999999999999";
const YEAR = "55555555-5555-4555-8555-555555555555";
const TEACHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function group(over: Record<string, unknown> = {}) {
  return {
    id: GROUP,
    name: "Бага бүлэг",
    ageBand: "NURSERY",
    kindergartenId: KG,
    schoolYearId: YEAR,
    status: "ACTIVE",
    schoolYear: { id: YEAR, name: "2026-2027", isCurrent: true },
    _count: { enrollments: 21 },
    photoMediaFileId: null,
    teachers: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        role: "LEAD",
        endedOn: null,
        membership: {
          id: "66666666-6666-4666-8666-666666666666",
          user: { id: TEACHER, lastName: "Ганболд", firstName: "Баяр" },
        },
      },
    ],
    ...over,
  };
}

/** A second class with no assignment — the row the summary tile counts. */
const bare = group({ id: BARE, name: "Дунд бүлэг", _count: { enrollments: 24 }, teachers: [] });

const list = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  totalPages: 1,
});

function stubScreen(items: unknown[] = [group(), bare]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: "/groups", body: list(items) },
  ]);
}

const card = (name: string) =>
  screen.getByRole("heading", { name }).closest("article") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("/admin/groups — бүлгийн жагсаалт", () => {
  it("draws a card per group with its roll and its teacher", async () => {
    stubScreen();
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });

    const staffed = card("Бага бүлэг");
    expect(within(staffed).getByText("21")).toBeInTheDocument();
    expect(within(staffed).getByText("Г.Баяр")).toBeInTheDocument();
    expect(within(staffed).getByText("Үндсэн багш")).toBeInTheDocument();
  });

  /*
   * ★ The state the screen is for. A group with no `GroupTeacher` row is a
   * group no teacher can open — `canAccessChild` resolves access through
   * exactly those rows — so it is called out on the card rather than left as
   * an empty space somebody has to notice.
   */
  it("flags a group with no teacher, and counts it", async () => {
    stubScreen();
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Дунд бүлэг" });

    expect(within(card("Дунд бүлэг")).getByText("Тохируулаагүй")).toBeInTheDocument();

    const tile = screen.getByText("Багшгүй").closest("div")!.parentElement!;
    expect(within(tile).getByText("1")).toBeInTheDocument();
  });

  /*
   * ★★ **The route is the local UUID.** `esisGroupId` is the ministry's key
   * for the same class; every screen behind this link resolves children
   * through `Enrollment`, which hangs off our own id, so the ESIS number must
   * never appear in a URL.
   */
  it("links a group to /groups/{local id}", async () => {
    stubScreen();
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });

    const link = within(card("Бага бүлэг")).getByRole("link");
    expect(link).toHaveAttribute("href", `/groups/${GROUP}`);
  });

  it("filters to the groups with nobody assigned", async () => {
    stubScreen();
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });

    await userEvent.click(screen.getByLabelText("Багшаар шүүх"));
    await userEvent.click(await screen.findByRole("option", { name: "Багшгүй" }));

    expect(screen.queryByRole("heading", { name: "Бага бүлэг" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Дунд бүлэг" })).toBeInTheDocument();
  });

  it("searches by name", async () => {
    stubScreen();
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });

    await userEvent.type(screen.getByLabelText("Бүлгийн нэрээр хайх"), "Дунд");
    expect(screen.queryByRole("heading", { name: "Бага бүлэг" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Дунд бүлэг" })).toBeInTheDocument();
  });

  /*
   * ★ The assignment dialog still opens and still writes `GroupTeacher`. It
   * is the one row control the client asked back for after `f265b03`, and the
   * only thing on this screen that changes who may reach a child.
   */
  it("opens the teacher dialog from a card", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: `/groups/${GROUP}`, body: group() },
      { path: "/groups", body: list([group(), bare]) },
      { path: "/users", body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 } },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });
    await userEvent.click(screen.getByRole("button", { name: "Бага бүлэг — багш хуваарилах" }));

    const dialog = await screen.findByRole("dialog", { name: /багш хуваарилалт/i });
    expect(within(dialog).getByText("Одоогийн багш")).toBeInTheDocument();
    expect(within(dialog).getByText("Г.Баяр")).toBeInTheDocument();
  });

  /*
   * ★★ The dialog must not offer to write to ESIS. The ministry's instructor
   * record goes through prepare → approve → send on the group's own page; a
   * button here would either bypass that or imply the local assignment had
   * already done it.
   */
  it("points at the approval flow instead of writing to ESIS itself", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: `/groups/${GROUP}`, body: group() },
      { path: "/groups", body: list([group()]) },
      { path: "/users", body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 } },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });
    await userEvent.click(screen.getByRole("button", { name: "Бага бүлэг — багш хуваарилах" }));

    const dialog = await screen.findByRole("dialog", { name: /багш хуваарилалт/i });
    expect(within(dialog).getByRole("link", { name: "бүлгийн хуудаснаас" })).toHaveAttribute(
      "href",
      `/groups/${GROUP}`,
    );
    expect(within(dialog).queryByRole("button", { name: /ЭСИС рүү илгээх/i })).toBeNull();
  });

  /*
   * ★ The ministry's own group tables are behind the second tab, so opening
   * this screen no longer reads two ESIS services before showing a class.
   */
  it("reads no ESIS service until the ЭСИС tab is opened", async () => {
    const api = stubScreen();
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });
    expect(api.calls.filter((call) => call.url.includes("/esis/"))).toHaveLength(0);
  });

  it("says what to do when there are no groups yet", async () => {
    stubScreen([]);
    renderWithProviders(<AdminGroupsPage />);

    expect(await screen.findByText("Бүлэг байхгүй байна")).toBeInTheDocument();
  });
});

describe("эрх", () => {
  /** `RequireRole roles={["ADMIN"]}` gates the whole screen; a teacher never
   *  reaches any of these controls. */
  it("keeps a teacher off the screen entirely", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/groups", body: list([group()]) },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await waitFor(() => expect(screen.queryByRole("button", { name: /— засах/ })).toBeNull());
    expect(screen.queryByRole("button", { name: /архивлах/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /багш хуваарилах/i })).toBeNull();
  });
});
