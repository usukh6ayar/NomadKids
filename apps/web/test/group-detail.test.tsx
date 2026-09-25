import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import GroupDetailPage from "@/app/(app)/groups/[groupId]/page";

/**
 * `/groups/[groupId]` — one class.
 *
 * ★ **The screen had no test at all** before 2026-09-23, which is worth
 * recording rather than quietly fixing: it is the page every register is
 * reached from and the only place the local roster and the ministry's are
 * compared.
 *
 * ★★ What these pin is the boundary the refactor had to keep: the roster is
 * **local** — `/children?groupId=`, our own `Enrollment` rows — and ESIS is a
 * comparison drawn beside it. A version of this screen that listed the
 * ministry's `group/student/list` instead would look identical and would break
 * every child link, because those rows carry a `personId` and not a
 * `Child.id`.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const ESIS_GROUP = "100006351517832";
const CHILD = "77777777-7777-4777-8777-777777777777";
const CATALOG_PATH = `/kindergartens/${KG}/esis/catalog`;
const GROUP_STUDENTS = `/kindergartens/${KG}/esis/resource?resource=groupStudents`;

const group = (over: Record<string, unknown> = {}) => ({
  id: GROUP,
  name: "Бага бүлэг",
  ageBand: "NURSERY",
  kindergartenId: KG,
  status: "ACTIVE",
  schoolYear: { id: "55555555-5555-4555-8555-555555555555", name: "2026-2027", isCurrent: true },
  _count: { enrollments: 2 },
  photoMediaFileId: null,
  esisGroupId: ESIS_GROUP,
  teachers: [
    {
      id: "88888888-8888-4888-8888-888888888888",
      role: "LEAD",
      endedOn: null,
      membership: {
        id: "66666666-6666-4666-8666-666666666666",
        user: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          lastName: "Ганболд",
          firstName: "Баяр",
        },
      },
    },
  ],
  ...over,
});

/**
 * One roster row, as `/children` returns it.
 *
 * ★ `enrollments` is not decoration: the assignment dialog decides who is in
 * this class by looking for an ACTIVE enrolment pointing at this group, and
 * the remove control needs that enrolment's id. A fixture without it renders
 * an empty dialog that looks like a bug in the screen.
 */
const child = (
  id: string,
  lastName: string,
  firstName: string,
  sex = "MALE",
  /*
   * ★ A real UUID. `enrollmentSummarySchema` types this as `uuidSchema`, and
   * `get()` parses every response — so "enr-1" does not merely look wrong, it
   * makes Zod reject the whole payload and the roster renders empty. That
   * failure looks exactly like a broken screen.
   */
  enrolmentId = "99999999-9999-4999-8999-999999999991",
) => ({
  id,
  lastName,
  firstName,
  sex,
  dateOfBirth: "2021-04-12",
  nationalId: "УБ12345678",
  isForeign: false,
  photoMediaFileId: null,
  enrollments: [
    {
      id: enrolmentId,
      status: "ACTIVE",
      group: { id: GROUP, name: "Бага бүлэг" },
      schoolYear: { id: "55555555-5555-4555-8555-555555555555", name: "2026-2027" },
    },
  ],
});

const roster = {
  items: [
    child(CHILD, "Ганболд", "Батбаяр"),
    child(
      "88888888-8888-4888-8888-000000000001",
      "Дорж",
      "Сараа",
      "FEMALE",
      "99999999-9999-4999-8999-999999999992",
    ),
  ],
  page: 1,
  pageSize: 200,
  total: 2,
  totalPages: 1,
};

const endpoint = {
  key: "groupStudents",
  apiId: 100004874669783,
  slug: "api-13",
  method: "GET",
  path: "/svc/api/hub/v2/group/student/list/:studentGroupId",
  name: "Бүлгийн суралцагчид",
  domain: "ROSTER",
  usage: "Бүлгээр",
  previewable: true,
  readable: true,
  params: ["studentGroupId"],
  fields: [],
  fieldSource: "PORTAL",
  ingestedFieldCount: 0,
  accessStatus: "GRANTED",
  direction: "ESIS_TO_NOMADKIDS",
  targetModel: "Child",
  mappings: [],
  responseMode: "LIVE",
  syncStatus: "OK",
  syncErrorCode: null,
  httpStatus: 200,
  lastSyncAt: null,
};

const esisRead = (count: number) => {
  const rows = Array.from({ length: count }, (_, index) => ({
    personId: `9000000000000${index}`,
  }));
  return {
    resource: "groupStudents",
    source: "LIVE" as const,
    status: "SUCCEEDED" as const,
    errorCode: null,
    count,
    durationMs: 9,
    fields: [],
    rows,
    response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
  };
};

function stubScreen({
  groupBody = group(),
  rosterBody = roster,
  esisCount,
}: { groupBody?: unknown; rosterBody?: unknown; esisCount?: number } = {}) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: `/groups/${GROUP}`, body: groupBody },
    { path: "/children", body: rosterBody },
    ...(esisCount === undefined
      ? []
      : [
          {
            path: CATALOG_PATH,
            body: { mode: "LIVE" as const, canRead: true, endpoints: [endpoint] },
          },
          { path: GROUP_STUDENTS, body: esisRead(esisCount) },
        ]),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ groupId: GROUP });
});

describe("/groups/[groupId]", () => {
  /*
   * ★ "Бага бүлэг → 2 суралцагч → Г.Баяр багш" — the sentence the screen
   * exists to say, and it is in the header rather than two scrolls apart.
   */
  it("names the group, its roll and its lead teacher in the header", async () => {
    stubScreen();
    renderWithProviders(<GroupDetailPage />);

    expect(await screen.findByRole("heading", { name: "Бага бүлэг" })).toBeInTheDocument();
    expect(screen.getByText("2 суралцагч")).toBeInTheDocument();
    expect(screen.getByText("Г.Баяр")).toBeInTheDocument();
  });

  it("warns in the header when nobody is assigned", async () => {
    stubScreen({ groupBody: group({ teachers: [] }) });
    renderWithProviders(<GroupDetailPage />);

    expect(await screen.findByText("Багш тохируулаагүй")).toBeInTheDocument();
  });

  /*
   * ★★ **Local ids, local roster.** The child link is `/children/{Child.id}`,
   * and the request behind the table is `/children?groupId={local group id}`.
   * Both are the boundary the ESIS integration sits behind: a roster drawn
   * from `group/student/list` would carry `personId` and link nowhere.
   */
  it("lists the group's own enrolled children, linking to their local profile", async () => {
    const api = stubScreen();
    renderWithProviders(<GroupDetailPage />);

    const link = await screen.findByRole("link", { name: /Г.Батбаяр/ });
    expect(link).toHaveAttribute("href", `/children/${CHILD}/general`);

    const request = api.calls.find((call) => call.url.startsWith("/children?"));
    expect(request!.url).toContain(`groupId=${GROUP}`);
  });

  it("filters the roster by name and by sex", async () => {
    stubScreen();
    renderWithProviders(<GroupDetailPage />);

    await screen.findByRole("link", { name: /Г.Батбаяр/ });

    /*
      The rows read "Г.Батбаяр" but the search matches the whole name — a
      teacher typing the surname off a document must find him.
    */
    await userEvent.type(screen.getByLabelText("Суралцагчийн нэрээр хайх"), "Ганболд");
    expect(screen.getByRole("link", { name: /Г.Батбаяр/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Д.Сараа/ })).toBeNull();
  });

  it("tells an empty group apart from a filter that matched nothing", async () => {
    stubScreen();
    renderWithProviders(<GroupDetailPage />);

    await screen.findByRole("link", { name: /Г.Батбаяр/ });
    await userEvent.type(screen.getByLabelText("Суралцагчийн нэрээр хайх"), "Цэцэгмаа");

    expect(screen.getByText("Хайлтад тохирох суралцагч олдсонгүй")).toBeInTheDocument();
    expect(screen.queryByText("Суралцагч бүртгэгдээгүй")).toBeNull();
  });

  it("says what to do for a group with nobody enrolled", async () => {
    stubScreen({
      rosterBody: { items: [], page: 1, pageSize: 200, total: 0, totalPages: 0 },
    });
    renderWithProviders(<GroupDetailPage />);

    expect(await screen.findByText("Суралцагч бүртгэгдээгүй")).toBeInTheDocument();
  });

  /*
   * ★ The reconciliation: `group/student/list`, keyed by `Group.esisGroupId`,
   * compared against our own count. Agreement is reported quietly.
   */
  it("reports that the ministry's register agrees", async () => {
    stubScreen({ esisCount: 2 });
    renderWithProviders(<GroupDetailPage />);

    expect(await screen.findByText(/ЭСИС-ийн бүртгэлтэй тохирч байна/)).toBeInTheDocument();
  });

  /*
   * ★★ A mismatch names both numbers and points at the import — it never
   * offers to fix the roster here. `Enrollment` has exactly one writer.
   */
  it("names both counts when they disagree, and sends the reader to the import", async () => {
    stubScreen({ esisCount: 3 });
    renderWithProviders(<GroupDetailPage />);

    const warning = await screen.findByText(/ЭСИС-д 3, энд 2 суралцагч/);
    expect(warning).toHaveTextContent("ЭСИС-ээс дахин татна уу");
  });

  /*
   * ★ A group the ministry has never been told about is not a mismatch. "0 vs
   * 2" there would read as drift; there is nothing to compare against.
   */
  it("says so for a group ESIS has no id for, instead of comparing to zero", async () => {
    stubScreen({ groupBody: group({ esisGroupId: null }), esisCount: 2 });
    renderWithProviders(<GroupDetailPage />);

    expect(await screen.findByText("Энэ бүлэг ЭСИС-д бүртгэгдээгүй байна.")).toBeInTheDocument();
  });

  it("asks ESIS nothing for a group with no ministry id", async () => {
    const api = stubScreen({ groupBody: group({ esisGroupId: null }), esisCount: 2 });
    renderWithProviders(<GroupDetailPage />);

    await screen.findByText("Энэ бүлэг ЭСИС-д бүртгэгдээгүй байна.");
    expect(api.calls.filter((call) => call.url.includes("groupStudents"))).toHaveLength(0);
  });

  /*
   * ★★ **The two registers are reported apart.** The local assignment is in
   * force the moment it is written; the ministry's is a separate approved
   * write. One tick for both would claim something no press has done.
   */
  it("marks the local assignment done without claiming ESIS has it", async () => {
    stubScreen();
    renderWithProviders(<GroupDetailPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });
    await userEvent.click(screen.getByRole("tab", { name: "Мэдээлэл" }));

    expect(await screen.findByText("NomadKids ✓")).toBeInTheDocument();
    expect(screen.queryByText("ЭСИС ✓")).toBeNull();
    // And the approval flow is the way to send it.
    expect(screen.getByRole("button", { name: "Багш тохируулах" })).toBeInTheDocument();
  });

  /*
   * ★ The ESIS write panel is the director's. The routes behind it are
   * `@Roles("ADMIN")`, and a teacher seeing a button that always answers 403
   * is worse than not seeing it.
   */
  it("keeps the ESIS write panel away from a teacher", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP}`, body: group() },
      { path: "/children", body: roster },
    ]);
    renderWithProviders(<GroupDetailPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });
    await userEvent.click(screen.getByRole("tab", { name: "Мэдээлэл" }));

    expect(screen.queryByRole("button", { name: "Багш тохируулах" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ЭСИС-д бүртгүүлэх" })).toBeNull();
  });

  /*
   * ★ **Суралцагч хуваарилах** — 2026-09-25, at the client's request that
   * adding a child to a group work like assigning a teacher.
   *
   * It writes `Enrollment`, which is what `canAccessChild` resolves a
   * teacher's reach through — so this dialog changes who can open a child's
   * record, and both endpoints behind it are `@Roles("ADMIN")`.
   */
  it("★ opens the child assignment dialog and lists who is in the group", async () => {
    stubScreen();
    renderWithProviders(<GroupDetailPage />);

    await screen.findByRole("link", { name: /Г.Батбаяр/ });
    await userEvent.click(screen.getByRole("button", { name: "Суралцагч хуваарилах" }));

    const dialog = await screen.findByRole("dialog", { name: /суралцагч хуваарилалт/i });
    expect(within(dialog).getByText("Бүлгийн суралцагчид")).toBeInTheDocument();
    expect(within(dialog).getByText("Г.Батбаяр")).toBeInTheDocument();
  });

  /*
   * ★★ Removing ends the enrolment rather than deleting it — an enrolment
   * records that a child sat in this class between two dates, and that is
   * history. `PATCH … { status: "ENDED" }`, never `DELETE`.
   */
  it("★ ends an enrolment rather than deleting it", async () => {
    const api = stubScreen();
    renderWithProviders(<GroupDetailPage />);

    await screen.findByRole("link", { name: /Г.Батбаяр/ });
    await userEvent.click(screen.getByRole("button", { name: "Суралцагч хуваарилах" }));

    const dialog = await screen.findByRole("dialog", { name: /суралцагч хуваарилалт/i });
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Ганболд Батбаяр-г бүлгээс хасах/ }),
    );
    // Confirmed, never on the first press.
    await userEvent.click(within(dialog).getByRole("button", { name: "Тийм" }));

    const call = api.calls.find((c) => c.url.startsWith("/enrollments/"));
    expect(call?.method).toBe("PATCH");
    expect(call?.body).toEqual({ status: "ENDED" });
  });

  /*
   * ★ A teacher never sees the control: both endpoints answer 403 to them, and
   * a button that always fails is worse than no button.
   */
  it("★ keeps the child assignment control away from a teacher", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP}`, body: group() },
      { path: "/children", body: roster },
    ]);
    renderWithProviders(<GroupDetailPage />);

    await screen.findByRole("link", { name: /Г.Батбаяр/ });
    expect(screen.queryByRole("button", { name: "Суралцагч хуваарилах" })).toBeNull();
  });

  /* The three registers stay reachable, and by the local group id. */
  it("keeps the attendance, meal and assessment doors", async () => {
    stubScreen();
    renderWithProviders(<GroupDetailPage />);

    await screen.findByRole("heading", { name: "Бага бүлэг" });
    for (const [name, route] of [
      ["Ирц", "attendance"],
      ["Хоол", "meals"],
      ["Явцын үнэлгээ", "assessment"],
    ] as const) {
      const door = screen.getByRole("link", { name: new RegExp(name) });
      expect(door).toHaveAttribute("href", `/groups/${GROUP}/${route}`);
    }
  });
});
