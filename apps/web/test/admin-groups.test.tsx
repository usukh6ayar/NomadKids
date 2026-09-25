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

const CATALOG_PATH = `/kindergartens/${KG}/esis/catalog`;
const TEACHERS_READ = `/kindergartens/${KG}/esis/resource?resource=teachers`;

const esisEndpoint = {
  key: "teachers",
  apiId: 100004874669812,
  slug: "api-41",
  method: "GET",
  path: "/svc/api/hub/v2/teacher/list",
  name: "Багш нар",
  domain: "ROSTER",
  usage: "Багш",
  previewable: true,
  readable: true,
  params: [],
  fields: [],
  fieldSource: "PORTAL",
  ingestedFieldCount: 0,
  accessStatus: "GRANTED",
  direction: "ESIS_TO_NOMADKIDS",
  targetModel: "User",
  mappings: [],
  responseMode: "LIVE",
  syncStatus: "OK",
  syncErrorCode: null,
  httpStatus: 200,
  lastSyncAt: null,
};

/**
 * `teacher/list`, with the duplicate the service really produces.
 *
 * ★ Г.Баяр is already registered (his `esisPersonId` matches the account), so
 * he must **not** appear in the unregistered block. Х.Очирмаа has no account
 * and appears once — even though the ministry lists her twice, which it does
 * because the service is keyed by assignment.
 */
const esisTeacherRows: Record<string, string | null>[] = [
  {
    personId: "90000000000001",
    lastName: "Ганболд",
    firstName: "Баяр",
    positionName: "Бүлгийн багш",
  },
  {
    personId: "90000000000003",
    lastName: "Хүрэл",
    firstName: "Очирмаа",
    positionName: "Бүлгийн багш",
  },
  {
    personId: "90000000000003",
    lastName: "Хүрэл",
    firstName: "Очирмаа",
    positionName: "Туслах багш",
  },
];

const esisRead = (rows: Record<string, string | null>[]) => ({
  resource: "teachers",
  source: "LIVE" as const,
  status: "SUCCEEDED" as const,
  errorCode: null,
  count: rows.length,
  durationMs: 11,
  fields: [],
  rows,
  response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
});

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
   * ★★★ **Pick a teacher from what ESIS sends, not only from who registered**
   * — 2026-09-25, at the client's request.
   *
   * The ministry lists teachers this kindergarten has never invited. They are
   * shown and deliberately **not** selectable: `GroupTeacher` points at a
   * `Membership`, which every `canAccessChild` check resolves through, so a
   * person with no account cannot be granted a child. The invitation is what
   * makes them assignable, so that is what the row offers.
   */
  it("★ lists ESIS teachers who have no account here, with an invite", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: { mode: "LIVE", canRead: true, endpoints: [esisEndpoint] } },
      { path: TEACHERS_READ, body: esisRead(esisTeacherRows) },
      { path: `/groups/${GROUP}`, body: group() },
      { path: "/groups", body: list([group()]) },
      {
        path: "/users",
        body: {
          items: [
            {
              id: TEACHER,
              username: "bayar",
              lastName: "Ганболд",
              firstName: "Баяр",
              esisPersonId: "90000000000001",
              isActive: true,
              memberships: [
                { id: "66666666-6666-4666-8666-666666666666", kindergartenId: KG, role: "TEACHER" },
              ],
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });
    await userEvent.click(screen.getByRole("button", { name: "Бага бүлэг — багш хуваарилах" }));

    const dialog = await screen.findByRole("dialog", { name: /багш хуваарилалт/i });
    expect(await within(dialog).findByText("ЭСИС-д байгаа, бүртгэлгүй")).toBeInTheDocument();

    // Listed once, although `teacher/list` carries her twice.
    expect(within(dialog).getAllByText("Хүрэл Очирмаа")).toHaveLength(1);
    expect(within(dialog).getByRole("link", { name: "Урих" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
  });

  /*
   * ★ A teacher the ministry lists **and** this system has an account for is
   * already in the picker — putting them in the unregistered block too would
   * show the same person twice in one dialog, which is the duplication the
   * client asked to be rid of.
   */
  it("★ does not repeat a teacher who already has an account", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: { mode: "LIVE", canRead: true, endpoints: [esisEndpoint] } },
      { path: TEACHERS_READ, body: esisRead(esisTeacherRows) },
      { path: `/groups/${GROUP}`, body: group({ teachers: [] }) },
      { path: "/groups", body: list([group({ teachers: [] })]) },
      {
        path: "/users",
        body: {
          items: [
            {
              id: TEACHER,
              username: "bayar",
              lastName: "Ганболд",
              firstName: "Баяр",
              esisPersonId: "90000000000001",
              isActive: true,
              memberships: [
                { id: "66666666-6666-4666-8666-666666666666", kindergartenId: KG, role: "TEACHER" },
              ],
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });
    await userEvent.click(screen.getByRole("button", { name: "Бага бүлэг — багш хуваарилах" }));

    const dialog = await screen.findByRole("dialog", { name: /багш хуваарилалт/i });
    await within(dialog).findByText("ЭСИС-д байгаа, бүртгэлгүй");

    // He is selectable above; he must not also be listed as unregistered.
    const block = within(dialog).getByText("ЭСИС-д байгаа, бүртгэлгүй").closest("section")!;
    expect(within(block as HTMLElement).queryByText(/Ганболд/)).toBeNull();
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
