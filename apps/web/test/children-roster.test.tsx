import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import ChildrenPage from "@/app/(app)/children/page";

/**
 * `/children` — the roster, and where its numbers come from.
 *
 * ★ **The whole screen reads ESIS — 2026-09-14**, at the client's instruction:
 * "local data gej baihgui bugd l esis ees tatagdana shuu."
 *
 * Before that the table was this kindergarten's own children relabelled under
 * ESIS field names, and the three figures above it were counted by
 * `/children/summary`. Two sources, one screen: they agreed only because the
 * local rows had been seeded from ESIS in the first place, and would have
 * disagreed the moment the ministry enrolled a child nobody had imported.
 *
 * ★★ These tests pin the two things that failure would have looked like on
 * screen — an empty table, and figures that came from somewhere else.
 */

/*
 * ★ The id `sessionFor` puts on its memberships. The page reads
 * `primaryKindergartenId` off the session, so the stub paths have to match it
 * or every ESIS call 404s into an empty screen — which is exactly the failure
 * this file is here to catch, and would then "pass" for the wrong reason.
 */
const KG = "33333333-3333-4333-8333-333333333333";

const studentFields = [
  { name: "lastName", label: "Овог", io: "OUTPUT" as const, ingested: true, summary: 1 },
  { name: "firstName", label: "Нэр", io: "OUTPUT" as const, ingested: true, summary: 2 },
  { name: "genderCode", label: "Хүйс", io: "OUTPUT" as const, ingested: true, summary: 3 },
  { name: "dateOfBirth", label: "Төрсөн огноо", io: "OUTPUT" as const, ingested: true, summary: 4 },
  { name: "personRegNumber", label: "Регистр", io: "OUTPUT" as const, ingested: false },
];

/** Three children, so the sex split has something to divide. */
const rows = [
  { lastName: "Ганболд", firstName: "Батбаяр", genderCode: "M", dateOfBirth: "2021-04-12" },
  { lastName: "Дорж", firstName: "Намуун", genderCode: "F", dateOfBirth: "2022-05-30" },
  { lastName: "Пүрэв", firstName: "Тэмүүлэн", genderCode: "F", dateOfBirth: "2023-01-09" },
];

const catalog = {
  mode: "LIVE" as const,
  canRead: true,
  endpoints: [
    {
      key: "students",
      name: "Суралцагчийн жагсаалт",
      domain: "ROSTER",
      usage: "Бүртгэл, бүлэг",
      apiId: 100004874669777,
      slug: "api-8",
      method: "GET",
      path: "/svc/api/hub/v2/students/list",
      params: [],
      previewable: true,
      readable: true,
      fields: studentFields,
      fieldSource: "PORTAL",
      ingestedFieldCount: 4,
      grant: "APPROVED",
      portalName: "Суралцагчийн жагсаалт",
      accessStatus: "UNKNOWN",
      direction: "ESIS_TO_NOMADKIDS",
      targetModel: "Child",
      mappings: [],
      responseMode: "LIVE",
      syncStatus: "PENDING",
      syncErrorCode: null,
      httpStatus: null,
      lastSyncAt: null,
    },
  ],
};

const read = {
  resource: "students",
  endpoint: { method: "GET", path: "/svc/api/hub/v2/students/list" },
  source: "LIVE" as const,
  status: "SUCCEEDED" as const,
  errorCode: null,
  count: rows.length,
  durationMs: 21,
  fields: studentFields,
  rows,
  response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
};

/** The local roster, still read — it is what a row's link resolves against. */
const localChildren = {
  items: [
    {
      // A real uuid: `childSummarySchema` validates it, and a `child-1` makes
      // the whole parse throw — the list comes back undefined and the link
      // this test is about never renders, for a reason nothing on screen shows.
      id: "55555555-5555-4555-8555-555555555555",
      lastName: "Ганболд",
      firstName: "Батбаяр",
      sex: "MALE",
      dateOfBirth: "2021-04-12T00:00:00.000Z",
      status: "ACTIVE",
      enrollments: [],
    },
  ],
  page: 1,
  pageSize: 100,
  total: 1,
  totalPages: 1,
};

function stubRoster(roles: ("ADMIN" | "TEACHER")[] = ["ADMIN"]) {
  stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: `/kindergartens/${KG}/esis/resource`, body: read },
    { path: `/kindergartens/${KG}/esis/catalog`, body: catalog },
    { path: "/children", body: localChildren },
  ]);
}

describe("/children — ESIS roster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearchParams("");
  });

  /*
   * ★ **A teacher does not get the institution's roll — 2026-09-22.**
   *
   * The client: "Багш: Зөвхөн тухайн бүлгийн суралцагчдын нэр харагдана."
   * `students/list` answers for the whole institution and takes no group
   * parameter, so the panel is a director's. Намуун and Тэмүүлэн are in the
   * ESIS response and in no group this teacher teaches; if the panel renders
   * for a teacher they appear, which is the failure this pins.
   *
   * ★★ It asserts on the *names*, not on the panel's heading. A heading could
   * be renamed and the children would still be on screen — the thing the
   * client objected to is a child's name, so that is what the test reads.
   */
  it("a teacher is not shown the institution's ESIS roster", async () => {
    stubRoster(["TEACHER"]);
    renderWithProviders(<ChildrenPage />);

    // Their own group's child, from `GET /children`, which the API has scoped.
    // ★ 2026-10-01: a plain table, no photograph, the name as "Г.Батбаяр" and
    // the columns in the client's order — numbered, and no Бүлэг column,
    // since a teacher's rows are all their own group.
    expect(await screen.findByText("Г.Батбаяр")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Суралцагчдын жагсаалт" });
    expect(table.querySelector("img")).toBeNull();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent)
        .filter((text) => text !== "Үйлдэл"),
    ).toEqual(["№", "Нэр", "Регистр", "Хүйс", "Нас", "ESIS төлөв"]);

    expect(screen.queryByText("Намуун")).toBeNull();
    expect(screen.queryByText("Тэмүүлэн")).toBeNull();
  });

  /*
   * ★ **The request, not just the rendering.**
   *
   * A screen that drew the right names by filtering an institution-wide
   * response in the browser would pass the test above and still have sent
   * every child's name and birth date to a teacher's machine. `RosterSummary`
   * did exactly that — it read `?resource=students` to count three figures —
   * so this asserts the call is not made at all.
   *
   * ★★ `resource=students` specifically, not `/esis/resource`. The teacher
   * keeps two panels that legitimately use that route: `studentByRegister`
   * (their own client-requested РД search) and `groupStudents`, which is
   * group-scoped. Asserting on the route would ban those too and the test
   * would be pinning the wrong rule.
   */
  it("never asks ESIS for the institution's roll on a teacher's screen", async () => {
    stubRoster(["TEACHER"]);
    renderWithProviders(<ChildrenPage />);

    await screen.findByText("Г.Батбаяр");
    const calls = vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.includes("/children?"))).toBe(true);
    expect(calls.some((url) => url.includes("resource=students"))).toBe(false);
  });
});
