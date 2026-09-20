import { screen, waitFor } from "@testing-library/react";
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

function stubRoster() {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
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
   * ★ The regression this file exists for.
   *
   * The panel had no `autoRead`, which was invisible while it fell back to
   * sample rows: something was always drawn. With the samples removed, the
   * screen a director opened was a heading and nothing else.
   */
  it("reads the roster on open, without anything being pressed", async () => {
    stubRoster();
    renderWithProviders(<ChildrenPage />);

    expect(await screen.findByText("Батбаяр")).toBeInTheDocument();
    expect(screen.getByText("Намуун")).toBeInTheDocument();
    expect(screen.getByText("Тэмүүлэн")).toBeInTheDocument();
  });

  /*
   * ★★ The figures are counted from the response the table drew, not from
   * `/children/summary`. One source, so the header cannot contradict the rows
   * beneath it.
   */
  it("counts its figures from the ESIS response", async () => {
    stubRoster();
    renderWithProviders(<ChildrenPage />);

    // Three ESIS rows — not the one local child the href matcher reads.
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("asks /children/summary for nothing", async () => {
    stubRoster();
    renderWithProviders(<ChildrenPage />);

    await screen.findByText("Батбаяр");
    const calls = vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.includes("/children/summary"))).toBe(false);
  });

  /*
   * ★★★ A row still opens the child it names — the half of the old
   * hand-built roster worth keeping. `liveHref` matches the ESIS row against
   * the local record by name and date of birth; a child ESIS holds that this
   * kindergarten has not registered leads nowhere rather than to a guess.
   */
  it("links a row to the local child it names, and only that one", async () => {
    stubRoster();
    renderWithProviders(<ChildrenPage />);

    await screen.findByText("Батбаяр");
    await waitFor(() =>
      /*
       * ★ `/Ганболд Батбаяр/`, not `"Батбаяр"` — the roster draws records as
       * cards now and a card titles itself with the surname in front, which is
       * how a reader tells two Батбаярs apart. The link is the same link; only
       * its accessible name grew.
       */
      expect(screen.getByRole("link", { name: /Ганболд Батбаяр/ })).toHaveAttribute(
        "href",
        "/children/55555555-5555-4555-8555-555555555555/general",
      ),
    );

    // Namuun and Temuulen are in ESIS and not in this kindergarten's records.
    expect(screen.queryByRole("link", { name: /Намуун/ })).toBeNull();
    expect(screen.getByText("Намуун")).toBeInTheDocument();
  });
});
