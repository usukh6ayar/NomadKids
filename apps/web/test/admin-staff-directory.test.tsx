import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import AdminUsersPage from "@/app/(app)/admin/users/page";

/**
 * `/admin/users` — Багш, ажилтан, the unified staff directory.
 *
 * ★ The screen this replaced rendered our own accounts, ESIS `teacher/list`
 * and ESIS `school/staff` as three tables in a column, so one person could
 * appear three times and a director had to know which ministry service carried
 * which field. These cases pin the merge: **one row per person, joined on
 * `esisPersonId` and never on a name.**
 *
 * ★★ `test/setup.ts` deletes the ESIS token, so nothing here reaches the
 * ministry — the rows below are a stub of what `…/esis/resource` returns. That
 * is the right boundary for this file: whether ESIS answers at all is
 * `scripts/esis-probe.ts`'s business, and a green run here says nothing about
 * it (CLAUDE.md, "A green api suite proves nothing about ESIS").
 */

const KG = "33333333-3333-4333-8333-333333333333";
const CATALOG_PATH = `/kindergartens/${KG}/esis/catalog`;
const TEACHERS_READ = `/kindergartens/${KG}/esis/resource?resource=teachers`;
const STAFF_READ = `/kindergartens/${KG}/esis/resource?resource=staff`;

const GROUP = "44444444-4444-4444-8444-444444444444";
const BAYAR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOSOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OCHIR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Г.Баяр — a teacher, with an account, an ESIS id and a group. */
const bayar = {
  id: BAYAR,
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
};

/** Б.Сосорбурам — the нягтлан. No ESIS id: invited accounts never get one. */
const sosor = {
  id: SOSOR,
  username: "sosor",
  email: "sosor@example.mn",
  phone: null,
  lastName: "Батболд",
  firstName: "Сосорбурам",
  esisPersonId: null,
  isActive: true,
  memberships: [
    { id: "66666666-6666-4666-8666-666666666666", kindergartenId: KG, role: "ACCOUNTANT" },
  ],
};

/** Х.Очирмаа — a teacher with an account and **no group**. */
const ochir = {
  id: OCHIR,
  username: "ochir",
  email: null,
  phone: null,
  lastName: "Хүрэл",
  firstName: "Очирмаа",
  esisPersonId: "90000000000003",
  isActive: true,
  memberships: [
    { id: "77777777-7777-4777-8777-777777777777", kindergartenId: KG, role: "TEACHER" },
  ],
};

const accounts = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 200,
  total: items.length,
  totalPages: 1,
});

/** One group, with Г.Баяр assigned to it — the payload `GET /groups` returns. */
const groups = {
  items: [
    {
      id: GROUP,
      name: "Бага бүлэг",
      ageBand: "NURSERY",
      kindergartenId: KG,
      status: "ACTIVE",
      _count: { enrollments: 21 },
      teachers: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          role: "LEAD",
          endedOn: null,
          membership: {
            id: "55555555-5555-4555-8555-555555555555",
            user: { id: BAYAR, lastName: "Ганболд", firstName: "Баяр" },
          },
        },
      ],
    },
  ],
  page: 1,
  pageSize: 100,
  total: 1,
  totalPages: 1,
};

const endpoint = (key: string) => ({
  key,
  apiId: 55,
  slug: "API-000154",
  method: "GET",
  path: `/svc/api/hub/v2/${key}`,
  name: key,
  domain: "ROSTER",
  usage: "Ажилтан",
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
});

/**
 * ★ `teacherMovements` is in the catalog although the directory never folds it
 * in — that is the point of the tab case below. A panel whose service is
 * absent from the caller's catalog renders nothing at all, so leaving it out
 * would make "the tab did not fetch it" pass for the wrong reason.
 */
const catalog = {
  mode: "LIVE" as const,
  canRead: true,
  endpoints: [endpoint("teachers"), endpoint("staff"), endpoint("teacherMovements")],
};

const read = (rows: Record<string, string | null>[]) => ({
  resource: "staff",
  source: "LIVE" as const,
  status: "SUCCEEDED" as const,
  errorCode: null,
  count: rows.length,
  durationMs: 12,
  fields: [],
  rows,
  response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
});

/**
 * ESIS `teacher/list`, with Г.Баяр on it **twice**.
 *
 * ★ Not invented for the test. The service is keyed by `assignmentId` and a
 * teacher may hold more than one assignment, so it repeats people — which is
 * recorded in this project's notes on the two staff services. The second row
 * is the fuller one, and the directory must keep that one rather than the
 * first it happened to see.
 */
const esisTeachers: Record<string, string | null>[] = [
  {
    personId: "90000000000001",
    assignmentId: "1",
    lastName: "Ганболд",
    firstName: "Баяр",
    positionName: "Бүлгийн багш",
    instructorTypeName: null,
    subjectDepartmentName: null,
  },
  {
    personId: "90000000000001",
    assignmentId: "2",
    lastName: "Ганболд",
    firstName: "Баяр",
    positionName: "Бүлгийн багш",
    instructorTypeName: "Үндсэн багш",
    subjectDepartmentName: "Бага насны хүүхдийн хөгжил",
  },
  {
    personId: "90000000000003",
    assignmentId: "3",
    lastName: "Хүрэл",
    firstName: "Очирмаа",
    positionName: "Бүлгийн багш",
  },
];

/**
 * `school/staff` — the superset, and the only place Д.Ганбат appears.
 *
 * ★ The shape is the live one, measured on institution 42778 on 2026-09-23
 * (`scripts/esis-staff-overlap-probe.ts`): `teacher/list` held 9 distinct
 * people across 10 rows, `school/staff` held 13, **nobody was in the first and
 * not the second**, and the four who were only in the second were a тогооч, a
 * second тогооч, a жижүүр and the эрхлэгч — not a teaching post among them.
 *
 * That is why Д.Ганбат is a тогооч here rather than a "Туслах багш", which is
 * what this fixture said first. It matters: the directory decides Төрөл by
 * *identity* — is this person in `teacher/list` — rather than by reading
 * "багш" out of a job title, and a fixture where the two disagree would be
 * asserting against a case the ministry does not produce.
 */
const esisStaff: Record<string, string | null>[] = [
  {
    personId: "90000000000001",
    assignmentId: "1",
    lastName: "Ганболд",
    firstName: "Баяр",
    positionName: "Бүлгийн багш",
    yearsOfService: "7",
    minor: "Бага боловсрол",
  },
  {
    personId: "90000000000009",
    assignmentId: "9",
    lastName: "Дорж",
    firstName: "Ганбат",
    positionName: "ахлах Тогооч",
    yearsOfService: "2",
  },
];

/** The whole screen, connected: our accounts, our groups, both ESIS services. */
function stubScreen(items: unknown[] = [bayar, sosor, ochir]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: CATALOG_PATH, body: catalog },
    { path: TEACHERS_READ, body: read(esisTeachers) },
    { path: STAFF_READ, body: read(esisStaff) },
    { path: "/groups", body: groups },
    { path: "/users", body: accounts(items) },
  ]);
}

beforeEach(() => vi.clearAllMocks());

describe("/admin/users — Багш, ажилтан", () => {
  /*
   * ★ The case the merge exists for. `teacher/list` carries Г.Баяр twice and
   * `school/staff` carries him a third time; he has one account. Four ESIS
   * rows describing three people must not become four rows on the screen.
   */
  it("shows a person once however many ESIS rows describe them", async () => {
    stubScreen();
    renderWithProviders(<AdminUsersPage />);

    await screen.findByText("Г.Баяр");
    expect(screen.getAllByText("Г.Баяр")).toHaveLength(1);
  });

  /*
   * ★★ **The screen asks for staff, and `PARENT` is not staff.**
   *
   * This is the regression the `STAFF_ROLES` contract was added for: the page
   * derived its filter from `ASSIGNABLE_ROLES`, which contains `PARENT` so an
   * administrator can repair a guardian's account — and asking for it here
   * requested every family in the kindergarten on a screen titled Багш,
   * ажилтан. The client's instruction is explicit: "ерөөсөө эцэг эх байхгүй".
   */
  it("never asks the API for guardians", async () => {
    const api = stubScreen();
    renderWithProviders(<AdminUsersPage />);

    await screen.findByText("Г.Баяр");
    const users = api.calls.filter((call) => call.url.startsWith("/users?"));
    expect(users).not.toHaveLength(0);
    for (const call of users) expect(call.url).not.toContain("PARENT");
  });

  /*
   * ★ ESIS silent is not ESIS broken. A kindergarten with no connection gets
   * its own staff list and no ministry columns — not an error, and not an empty
   * screen, which is what waiting on the ministry's two reads would produce.
   */
  it("still lists our own staff when ESIS answers nothing", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/groups", body: groups },
      { path: "/users", body: accounts([bayar, sosor]) },
      // No catalog stub: `…/esis/catalog` 404s, as it does with no connection.
    ]);
    renderWithProviders(<AdminUsersPage />);

    expect(await screen.findByText("Г.Баяр")).toBeInTheDocument();
    expect(screen.getByText("Б.Сосорбурам")).toBeInTheDocument();
    expect(screen.queryByText(/алдаа гарлаа/)).toBeNull();
  });
});
