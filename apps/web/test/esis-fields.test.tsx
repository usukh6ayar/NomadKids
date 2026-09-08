import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTER,
  renderWithProviders,
  sessionFor,
  setSearchParams,
  stubApi,
} from "./support/render";
import EsisIntegrationPage from "@/app/(app)/admin/integrations/esis/page";

/**
 * "Гаралтын утгуудыг бүгдийг нь дэлгэцэнд харуулах" — the client, 2026-09-08.
 *
 * ★ The thing under test is the *contract*, not a happy-path fetch. No ESIS
 * token exists on any deployment yet, so what the screen has to prove is that
 * the field names are already known: every output field of every service, and
 * the ones this product refuses with the document that refused them. A test
 * that only checked a populated table would pass on an empty catalog.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const ESIS_PATH = `/kindergartens/${KG}/esis`;

const organizationFields: StubField[] = [
  {
    name: "institutionId",
    label: "Байгууллагын код",
    io: "OUTPUT",
    ingested: true,
    sample: "40305",
  },
  {
    name: "institutionName",
    label: "Байгууллагын нэр",
    io: "OUTPUT",
    ingested: true,
    sample: "Бяцхан нүүдэлчид (жишээ)",
  },
  { name: "regionName", label: "Бүс", io: "OUTPUT", ingested: true, sample: "Төвийн бүс" },
];

const studentFields: StubField[] = [
  {
    name: "personId",
    label: "ESIS хүний дугаар",
    io: "OUTPUT",
    ingested: true,
    sample: "90000000000001",
  },
  { name: "firstName", label: "Нэр", io: "OUTPUT", ingested: true, sample: "Батбаяр" },
  {
    name: "personRegNumber",
    label: "Регистрийн дугаар",
    io: "OUTPUT",
    ingested: false,
    omitReason: "ESIS_REQUEST.md §1.1 (b) — регистрийн дугаар татахгүй",
  },
];

type StubField = {
  name: string;
  label: string;
  io: "OUTPUT" | "INPUT";
  ingested: boolean;
  sample?: string;
  omitReason?: string;
};

const endpoint = (
  key: string,
  name: string,
  fields: StubField[],
  extra: Record<string, unknown> = {},
) => ({
  key,
  apiId: 59,
  slug: "API-000158",
  method: "GET",
  path: `/svc/api/hub/v2/${key}`,
  name,
  domain: "ORGANIZATION",
  usage: "Тест",
  previewable: true,
  readable: true,
  params: [],
  fields,
  fieldSource: "PORTAL",
  ingestedFieldCount: fields.filter((field) => field.ingested).length,
  sampleRow: Object.fromEntries(
    fields.filter((field) => field.ingested).map((field) => [field.name, field.sample]),
  ),
  accessStatus: "UNKNOWN",
  ...extra,
});

function overview(canPreview: boolean) {
  return {
    deployment: {
      configured: canPreview,
      baseUrl: "https://hubv2.esis.edu.mn",
      hasToken: canPreview,
    },
    connection: {
      mapped: canPreview,
      institutionId: canPreview ? "40305" : null,
      environment: canPreview ? "TEST" : null,
      mappedAt: null,
      mappingMatchesDeployment: canPreview,
    },
    stages: [
      { code: "C1", label: "API каталог", status: "READY" },
      { code: "C2", label: "Код ба schema", status: "READY" },
      { code: "C3", label: "Token ба API эрх", status: canPreview ? "READY" : "WAITING" },
      { code: "C4", label: "Test орчны шалгалт", status: "WAITING" },
      { code: "C5", label: "Production sync", status: "WAITING" },
    ],
    endpoints: [
      endpoint("organization", "Байгууллагын мэдээлэл", organizationFields),
      endpoint("students", "Суралцагчийн жагсаалт", studentFields, {
        key: "students",
        domain: "ROSTER",
        fieldSource: "PORTAL",
        note: "Суралцагчийн нэмэлт мэдээлэл — §1.3-аар хүсээгүй.",
      }),
      endpoint("groupAttendance", "Бүлгийн ирцийн тулгалт", organizationFields, {
        key: "groupAttendance",
        domain: "ATTENDANCE",
        previewable: false,
        params: ["studentGroupId", "dayDate"],
      }),
    ],
    recentRuns: [],
    canPreview,
    blockers: canPreview ? [] : ["Server дээр ESIS token болон endpoint тохируулаагүй байна."],
  };
}

/**
 * The always-visible field block for one service.
 *
 * ★ The service name appears twice on the tab — once as a row of the API
 * matrix, once as the summary of its field list — so a bare text query is
 * ambiguous by construction. Anchoring on the marked section picks the
 * field list without depending on which of the two renders first.
 */
function fieldsFor(name: string): HTMLElement {
  const heading = screen.getAllByText(name).find((node) => node.closest("[data-esis-fields]"));
  if (!heading) throw new Error(`No field list for ${name}`);
  return heading.closest("[data-esis-fields]") as HTMLElement;
}

async function openFieldsTab() {
  await userEvent.click(await screen.findByRole("tab", { name: /Сервис ба талбар/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("ESIS гаралтын талбарууд", () => {
  it("names every output field, including the ones it refuses", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();

    const students = fieldsFor("Суралцагчийн жагсаалт");
    expect(within(students).getByText("personRegNumber")).toBeInTheDocument();
    expect(within(students).getByText(/ESIS_REQUEST.md §1.1/)).toBeInTheDocument();
    // The refusal is labelled as a decision, not left as an absence.
    expect(within(students).getAllByText("Авахгүй").length).toBeGreaterThan(0);
  });

  it("shows the catalog source for every published field set", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();

    expect(within(fieldsFor("Байгууллагын мэдээлэл")).getByText("Каталогоос")).toBeInTheDocument();
    expect(within(fieldsFor("Суралцагчийн жагсаалт")).getByText("Каталогоос")).toBeInTheDocument();
  });

  it("shows the demo ESIS field contract without an extra pull action", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    const details = fieldsFor("Байгууллагын мэдээлэл");
    expect(within(details).getByText("Demo ESIS синк")).toBeInTheDocument();
    expect(within(details).getByText("institutionId")).toBeInTheDocument();
    expect(within(details).getByText("regionName")).toBeInTheDocument();
    expect(
      within(details).queryByRole("button", { name: /ESIS-ээс татах/ }),
    ).not.toBeInTheDocument();
  });

  /*
   * ★ The demo row is useful before a live token exists and remains explicitly
   * labelled. The paired live test verifies that it disappears once ESIS
   * returns real rows.
   */
  it("shows populated demo ESIS values before any action", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    const details = fieldsFor("Байгууллагын мэдээлэл");
    expect(within(details).getByText("Demo ESIS синк")).toBeInTheDocument();
    expect(within(details).getByText("Төвийн бүс")).toBeInTheDocument();
    expect(within(details).getByText("Бяцхан нүүдэлчид (жишээ)")).toBeInTheDocument();
  });

  it("drops the example entirely once ESIS returns real rows", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
          status: "SUCCEEDED",
          errorCode: null,
          count: 1,
          durationMs: 42,
          fields: organizationFields,
          rows: [
            { institutionId: "77777", institutionName: "Жинхэнэ цэцэрлэг", regionName: "Баруун" },
          ],
        },
      },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    await userEvent.click(
      within(fieldsFor("Байгууллагын мэдээлэл")).getByRole("button", { name: /ESIS-ээс татах/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Жинхэнэ цэцэрлэг")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Demo ESIS синк/)).not.toBeInTheDocument();
    // The invented tenant name is not on screen beside the real one.
    expect(within(dialog).queryByText("Бяцхан нүүдэлчид (жишээ)")).not.toBeInTheDocument();
  });

  it("asks for the ESIS ids a parameterised service needs before calling", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: `${ESIS_PATH}/resource`, body: { detail: "unused" } },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    await userEvent.click(
      within(fieldsFor("Бүлгийн ирцийн тулгалт")).getByRole("button", { name: /ESIS-ээс татах/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("ESIS бүлгийн дугаар")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Огноо")).toBeInTheDocument();
    // Nothing is fetched until the operator supplies the ministry's own id.
    expect(calls.some((call) => call.url.includes("/esis/resource"))).toBe(false);
  });

  it("renders returned values under the catalog's own field labels", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
          status: "SUCCEEDED",
          errorCode: null,
          count: 1,
          durationMs: 42,
          fields: organizationFields,
          rows: [{ institutionId: "40305", institutionName: "Бяцхан нүүдэлчид", regionName: null }],
        },
      },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    await userEvent.click(
      within(fieldsFor("Байгууллагын мэдээлэл")).getByRole("button", { name: /ESIS-ээс татах/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Бяцхан нүүдэлчид")).toBeInTheDocument();
    expect(within(dialog).getByText("1 бичлэг")).toBeInTheDocument();
    /*
     * A field ESIS left empty is still shown, and says so. One record renders
     * as a definition list rather than a one-row table, matching how
     * `/admin/kindergarten` shows the same record — so the empty marker is that
     * page's "Бөглөөгүй", not a bare dash.
     */
    // "Бүс" labels both the record and its row in the field catalog below.
    expect(within(dialog).getAllByText("Бүс").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Бөглөөгүй").length).toBeGreaterThan(0);
  });

  it("explains an upstream refusal instead of showing an empty table", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
          status: "FAILED",
          errorCode: "SCOPE_DENIED",
          count: 0,
          durationMs: null,
          fields: organizationFields,
          rows: [],
        },
      },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    await userEvent.click(
      within(fieldsFor("Байгууллагын мэдээлэл")).getByRole("button", { name: /ESIS-ээс татах/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/эрх олгоогүй/)).toBeInTheDocument();
  });

  it("hides the pull control from a teacher", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    // `RequireRole` renders nothing and redirects, so the whole screen is gone.
    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByRole("button", { name: /ESIS-ээс татах/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /API эрх/ })).not.toBeInTheDocument();
  });
});
