import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChildEnrollmentArchive } from "@/components/child/enrollment-archive";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";

const CHILD = "11111111-1111-4111-8111-111111111111";

function stubArchive() {
  stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    {
      path: `/children/${CHILD}/enrollment-archive`,
      body: {
        child: {
          id: CHILD,
          lastName: "Ганболд",
          firstName: "Батбаяр",
          dateOfBirth: "2021-04-12",
        },
        current: {
          id: "22222222-2222-4222-8222-222222222222",
          startedOn: "2026-09-01",
          schoolYear: {
            id: "33333333-3333-4333-8333-333333333333",
            name: "2026-2027",
          },
          kindergarten: {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Бяцхан нүүдэлчид цэцэрлэг",
            address: "Баянгол дүүрэг, 3-р хороо",
            capacity: 120,
            groupCount: 6,
            phone: null,
            email: null,
            description: null,
          },
          group: {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Дэлбээ бүлэг",
            ageBand: "MIDDLE",
            childCount: 18,
            schedule: null,
            rules: null,
          },
          teachers: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              lastName: "Дэлгэрмаа",
              firstName: "Сувдаа",
              role: "LEAD",
              specialization: "СӨБ-ийн багш",
              education: "МУБИС",
              phone: "99001234",
              email: "suvdaa@nomadkids.mn",
            },
            {
              id: "67676767-6767-4676-8676-676767676767",
              lastName: "Дорж",
              firstName: "Сараа",
              role: "ASSISTANT",
              specialization: "Туслах багш",
              education: "МУБИС",
              phone: "99112233",
              email: "saraa@nomadkids.mn",
            },
          ],
        },
        history: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            status: "TRANSFERRED",
            startedOn: "2025-09-01",
            endedOn: "2026-08-31",
            kindergarten: {
              id: "88888888-8888-4888-8888-888888888888",
              name: "Нархан цэцэрлэг",
              address: "Сүхбаатар дүүрэг, 8-р хороо",
              capacity: 100,
              groupCount: 5,
            },
            group: {
              id: "99999999-9999-4999-8999-999999999999",
              name: "Бүжин бүлэг",
              ageBand: "JUNIOR",
              childCount: 20,
            },
            teachers: [
              {
                id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                lastName: "Өюунцэцэг",
                firstName: "Болор",
                role: "LEAD",
              },
              {
                id: "efefefef-efef-4efe-8efe-efefefefefef",
                lastName: "Болд",
                firstName: "Номин",
                role: "ASSISTANT",
              },
            ],
            schoolYear: {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              name: "2025-2026",
            },
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            status: "TRANSFERRED",
            startedOn: "2024-09-02",
            endedOn: "2025-08-31",
            kindergarten: {
              id: "88888888-8888-4888-8888-888888888888",
              name: "Нархан цэцэрлэг",
              address: null,
              capacity: null,
              groupCount: 5,
            },
            group: {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              name: "Алаг үрс бүлэг",
              ageBand: "NURSERY",
              childCount: 16,
            },
            teachers: [],
            schoolYear: {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              name: "2024-2025",
            },
          },
        ],
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("суралцсан түүх", () => {
  /*
    ★ 2026-10-01: the same shape as the other tabs — the current kindergarten
    as rows, then tables for its teachers and the earlier placements. No folds.
  */
  /*
   * The family's view — client, 2026-10-06: the kindergarten first, then the
   * group, then the group's teachers with their faces, the assistant included.
   */
  it("opens on the kindergarten, then the group, then both teachers", async () => {
    stubArchive();
    renderWithProviders(<ChildEnrollmentArchive childId={CHILD} />);

    const kindergarten = await screen.findByRole("region", {
      name: "Бяцхан нүүдэлчид цэцэрлэг",
    });
    expect(within(kindergarten).getByText("Баянгол дүүрэг, 3-р хороо")).toBeInTheDocument();
    // Every fact the staff card has — 2026-10-06, "мэдээллүүд маш дутуу".
    expect(within(kindergarten).getByText("120 хүүхэд")).toBeInTheDocument();
    expect(within(kindergarten).getByText("6 бүлэг")).toBeInTheDocument();

    const group = screen.getByRole("region", { name: "Дэлбээ бүлэг" });
    expect(within(group).getByText("Ахлах бүлэг")).toBeInTheDocument();
    expect(within(group).getByText("18 хүүхэд")).toBeInTheDocument();
    expect(within(group).getByText("2026.09.01")).toBeInTheDocument();
    // No picture on the group — 2026-10-06.
    expect(group.querySelector("svg, img")).toBeNull();

    // The kindergarten comes before the group, and the group before the teachers.
    const teachers = screen.getByRole("region", { name: "Багш нар" });
    expect(
      kindergarten.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(group.compareDocumentPosition(teachers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const lead = within(teachers).getByText("Дэлгэрмаа Сувдаа").closest("li")!;
    expect(within(lead).getByText("Бүлгийн багш")).toBeInTheDocument();
    expect(within(lead).getByText("СӨБ-ийн багш")).toBeInTheDocument();
    expect(within(lead).getByText("МУБИС")).toBeInTheDocument();
    expect(within(lead).getByRole("link", { name: "suvdaa@nomadkids.mn" })).toHaveAttribute(
      "href",
      "mailto:suvdaa@nomadkids.mn",
    );
    expect(within(lead).getByRole("link", { name: /99001234/ })).toHaveAttribute(
      "href",
      "tel:99001234",
    );

    const assistant = within(teachers).getByText("Дорж Сараа").closest("li")!;
    expect(within(assistant).getByText("Багшийн туслах")).toBeInTheDocument();
  });

  it("lists the past placements in a table, with the age the child was", async () => {
    stubArchive();
    renderWithProviders(<ChildEnrollmentArchive childId={CHILD} />);

    const past = await screen.findByRole("region", { name: "Өмнөх суралцсан түүх" });
    const rows = within(past).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByText("2025-2026")).toBeInTheDocument();
    // Born 2021-04-12, enrolled 2025-09-01.
    expect(within(rows[0]!).getByText("4 нас")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Нархан цэцэрлэг")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Бүжин бүлэг · Дунд бүлэг · 20 хүүхэд")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Шилжсэн")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Өюунцэцэг Болор")).toBeInTheDocument();
    expect(within(rows[0]!).queryByText("Болд Номин")).toBeNull();
    expect(within(rows[0]!).getByText("2025.09.01 – 2026.08.31")).toBeInTheDocument();
    // A past teacher is a name — never a phone number or an address.
    expect(within(rows[0]!).queryByRole("link")).toBeNull();

    expect(within(rows[1]!).getByText("2024-2025")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("3 нас")).toBeInTheDocument();
  });

  it("shows a guardian no ESIS section", async () => {
    stubArchive();
    renderWithProviders(<ChildEnrollmentArchive childId={CHILD} />);

    await screen.findByRole("region", { name: "Өмнөх суралцсан түүх" });
    expect(screen.queryByText("ЭСИС дэх шилжилт")).toBeNull();
  });
});

/**
 * ЭСИС дэх шилжилт — only this child's moves (2026-10-01). `studentMovements`
 * answers for the whole institution; the rows are narrowed to this child by
 * ESIS's `personId` (from `studentInfo`, keyed by the регистр), or by овог,
 * нэр and төрсөн огноо when there is no регистр.
 */
describe("ЭСИС дэх шилжилт", () => {
  const KG = "33333333-3333-4333-8333-333333333333";

  function esisRead(resource: string, rows: Record<string, string | null>[]) {
    return {
      resource,
      endpoint: { method: "GET", path: `/svc/${resource}` },
      source: "LIVE",
      status: "SUCCEEDED",
      errorCode: null,
      count: rows.length,
      durationMs: 1,
      fields: Object.keys(rows[0] ?? {}).map((name, index) => ({
        name,
        label: name,
        io: "OUTPUT",
        ingested: true,
        summary: index + 1,
      })),
      rows,
      response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
    };
  }

  function endpoint(key: string) {
    return {
      key,
      name: key,
      domain: "ROSTER",
      usage: key,
      apiId: 1,
      slug: key,
      method: "GET",
      path: `/svc/${key}`,
      params:
        key === "studentInfo"
          ? ["personRegNumber"]
          : key === "studentMovements"
            ? ["beginDate"]
            : [],
      previewable: false,
      readable: true,
      fields: [],
      fieldSource: "PORTAL",
      ingestedFieldCount: 0,
      grant: "APPROVED",
      portalName: key,
      direction: "ESIS_TO_NOMADKIDS",
      targetModel: "Child",
      mappings: [],
    };
  }

  const movements = [
    {
      personId: "900",
      lastName: "Ганболд",
      firstName: "Батбаяр",
      dateOfBirth: "2021-04-12T00:00:00.000Z",
      actionName: "Шилжиж ирсэн",
      actionDate: "2026-09-01T00:00:00.000Z",
      studentGroupName: "Дэлбээ",
      academicLevelName: "Ахлах",
      programStatusName: "Суралцаж байгаа",
    },
    // Another child of the institution — must not appear.
    {
      personId: "901",
      lastName: "Дорж",
      firstName: "Намуун",
      dateOfBirth: "2022-05-30T00:00:00.000Z",
      actionName: "Гарсан",
      actionDate: "2026-09-10T00:00:00.000Z",
      studentGroupName: "Бүжин",
      academicLevelName: "Дунд",
      programStatusName: "Шилжсэн",
    },
  ];

  function stubStaff() {
    stubArchive();
    // `stubArchive` stubs as a guardian; re-stub the session and ESIS on top.
    const archiveCall = vi.mocked(globalThis.fetch).getMockImplementation()!;
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/kindergartens/${KG}/esis/catalog`,
        body: {
          mode: "LIVE",
          canRead: true,
          endpoints: [endpoint("studentMovements"), endpoint("studentInfo")],
        },
      },
      {
        path: `/kindergartens/${KG}/esis/resource?resource=studentMovements`,
        body: esisRead("studentMovements", movements),
      },
      {
        path: `/kindergartens/${KG}/esis/resource?resource=studentInfo`,
        body: esisRead("studentInfo", [{ personId: "900" }]),
      },
    ]);
    const esisCall = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      return url.includes("/esis/") || url.includes("/auth/me")
        ? esisCall(input, init)
        : archiveCall(input, init);
    });
  }

  it("lists only this child's moves, newest first", async () => {
    stubStaff();
    renderWithProviders(<ChildEnrollmentArchive childId={CHILD} nationalId="УШ21241200" />);

    const section = await screen.findByRole("region", { name: /ЭСИС дэх шилжилт/ });
    expect(await within(section).findByText("Шилжиж ирсэн")).toBeInTheDocument();
    expect(within(section).getByText("2026-09-01")).toBeInTheDocument();
    expect(within(section).queryByText("Гарсан")).toBeNull();
    expect(within(section).queryByText("Бүжин")).toBeNull();
  });

  it("falls back to name and birth date without a регистр", async () => {
    stubStaff();
    renderWithProviders(<ChildEnrollmentArchive childId={CHILD} />);

    const section = await screen.findByRole("region", { name: /ЭСИС дэх шилжилт/ });
    expect(await within(section).findByText("Шилжиж ирсэн")).toBeInTheDocument();
    expect(within(section).queryByText("Гарсан")).toBeNull();
  });
});
