import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { EsisAcademicOrgCard, EsisTeacherListCard } from "@/components/esis/esis-teacher-cards";

const KG = "33333333-3333-4333-8333-333333333333";

function endpoint(key: string, path: string) {
  return {
    key,
    name: key,
    domain: "ROSTER",
    usage: "Багш",
    apiId: 1,
    slug: "api-1",
    method: "GET",
    path,
    params: [],
    previewable: true,
    readable: true,
    fields: [],
    fieldSource: "PORTAL",
    ingestedFieldCount: 0,
    grant: "APPROVED",
    portalName: key,
    accessStatus: "UNKNOWN",
    direction: "ESIS_TO_NOMADKIDS",
    targetModel: "Staff",
    mappings: [],
    responseMode: "LIVE",
    syncStatus: "PENDING",
    syncErrorCode: null,
    httpStatus: null,
    lastSyncAt: null,
  };
}

function read(resource: string, path: string, rows: Record<string, string | null>[]) {
  return {
    resource,
    endpoint: { method: "GET", path },
    source: "LIVE" as const,
    status: "SUCCEEDED" as const,
    errorCode: null,
    count: rows.length,
    durationMs: 12,
    fields: [],
    rows,
    response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
  };
}

const ORG_PATH = "/svc/api/hub/v2/teacher/academic-org";
const TEACHERS_PATH = "/svc/api/hub/v2/teachers/list";

function stub() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/kindergartens/${KG}/esis/catalog`,
      body: {
        mode: "LIVE",
        canRead: true,
        endpoints: [endpoint("teacherAcademicOrg", ORG_PATH), endpoint("teachers", TEACHERS_PATH)],
      },
    },
    {
      path: `/kindergartens/${KG}/esis/resource?resource=teacherAcademicOrg`,
      body: read("teacherAcademicOrg", ORG_PATH, [
        {
          institutionId: "42778",
          personId: "900123",
          jobCode: "2342",
          jobName: "Багш",
          subjectDepartmentId: "551",
          subjectDepartmentName: "Бага бүлгийн заах аргын нэгдэл",
        },
      ]),
    },
    {
      path: `/kindergartens/${KG}/esis/resource?resource=teachers`,
      body: read("teachers", TEACHERS_PATH, [
        {
          institutionId: "42778",
          assignmentId: "a-2",
          personId: "900124",
          instructorId: "77",
          lastName: "дорж",
          firstName: "сараа",
          positionName: "Туслах багш",
          instructorTypeId: "3",
          instructorTypeName: "Туслах",
          subjectDepartmentId: "552",
          subjectDepartmentName: "Дунд бүлгийн нэгдэл",
          instructorAvailability: "Ажиллаж байгаа",
        },
        {
          institutionId: "42778",
          assignmentId: "a-1",
          personId: "900123",
          instructorId: "76",
          lastName: "Бат",
          firstName: "Номин",
          positionName: "Багш",
          instructorTypeId: "1",
          instructorTypeName: "Үндсэн",
          subjectDepartmentId: "551",
          subjectDepartmentName: "Бага бүлгийн заах аргын нэгдэл",
          instructorAvailability: "Ажиллаж байгаа",
        },
      ]),
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("settings — ESIS teacher sections", () => {
  /** 2026-10-02: names and posts, never ESIS's ids and codes. */
  it("shows the teacher's unit and post without ESIS codes", async () => {
    stub();
    renderWithProviders(<EsisAcademicOrgCard />);

    const section = await screen.findByRole("region", { name: "Заах аргын нэгдэл" });
    expect(await within(section).findByText("Бага бүлгийн заах аргын нэгдэл")).toBeInTheDocument();
    expect(within(section).getByText("Багш")).toBeInTheDocument();
    for (const code of ["42778", "900123", "2342", "551"]) {
      expect(within(section).queryByText(code)).toBeNull();
    }
    expect(within(section).queryByText(/код|дугаар/i)).toBeNull();
  });

  it("lists teachers by name with readable columns only", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<EsisTeacherListCard />);

    const table = await screen.findByRole("table", { name: "ЭСИС-ийн багшийн жагсаалт" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      "№",
      "Овог, нэр",
      "Албан тушаал",
      "Багшийн төрөл",
      "Заах аргын нэгдэл",
      "Ажиллах боломж",
    ]);
    const names = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1]!.textContent);
    expect(names).toEqual(["Бат Номин", "Дорж Сараа"]);
    expect(within(table).queryByText("900124")).toBeNull();

    await user.type(screen.getByRole("searchbox", { name: "Багш хайх" }), "туслах");
    expect(within(table).queryByText("Бат Номин")).toBeNull();
    expect(within(table).getByText("Дорж Сараа")).toBeInTheDocument();
  });
});
