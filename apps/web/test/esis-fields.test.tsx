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
  sampleRows: [
    Object.fromEntries(
      fields.filter((field) => field.ingested).map((field) => [field.name, field.sample]),
    ),
  ],
  accessStatus: "UNKNOWN",
  /*
    ★ The sync-state half of the catalog row, added to `esisOverviewSchema`
    on 2026-09-09 so the admin screen can say what each service last did and
    which of its fields lands where.

    A stub short of these does not fail visibly: the typed client parses with
    Zod, the parse throws, the page falls to its error state, and every test
    below reports a missing "Сервис ба талбар" tab instead of a short payload.
    The defaults describe a service that has been declared but never run,
    which is the state the tests below all start from.
  */
  direction: "ESIS_TO_NOMADKIDS",
  targetModel: "Child",
  mappings: [],
  responseMode: "DEMO",
  syncStatus: "DEMO_SUCCESS",
  syncErrorCode: null,
  httpStatus: null,
  lastSyncAt: null,
  ...extra,
});

function overview(canPreview: boolean) {
  return {
    /*
      ★ `demoMode` and `mode` are required by `esisOverviewSchema` as of
      2026-09-09, and a stub that omits them does not fail where you would
      expect: the typed client validates with Zod, the parse throws, and the
      page renders its error state — so all nine tests below reported "the
      Сервис ба талбар tab does not exist" rather than "the payload is short
      two fields". `canPreview` doubles as "is this deployment talking to the
      real ESIS", which is what it already meant for `configured` and
      `hasToken`.
    */
    deployment: {
      configured: canPreview,
      demoMode: !canPreview,
      mode: canPreview ? "LIVE" : "MOCK",
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
 * The field block for one service.
 *
 * ★ The service name appears twice on the tab — once as a row of the API
 * matrix, once as the summary of its field list — so a bare text query is
 * ambiguous by construction. Anchoring on the marked section picks the
 * field list without depending on which of the two renders first.
 *
 * ★★ 2026-09-09 — one service at a time, so this has to choose it.
 *
 * The tab used to stack every service's field block down the page and this
 * helper only had to find the right one among them. It is an "API endpoint"
 * `<select>` driving a single block now, so the helper picks the service
 * first and then reads the one block that exists. That is also why it is
 * `async`: the selection is a user event, not a query.
 */
async function fieldsFor(name: string): Promise<HTMLElement> {
  await userEvent.selectOptions(
    screen.getByRole("combobox"),
    screen.getByRole("option", { name: new RegExp(name) }),
  );

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

    const students = await fieldsFor("Суралцагчийн жагсаалт");
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

    expect(
      within(await fieldsFor("Байгууллагын мэдээлэл")).getByText("Каталогоос"),
    ).toBeInTheDocument();
    expect(
      within(await fieldsFor("Суралцагчийн жагсаалт")).getByText("Каталогоос"),
    ).toBeInTheDocument();
  });

  it("shows the demo ESIS field contract without an extra pull action", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    const details = await fieldsFor("Байгууллагын мэдээлэл");
    // ★ Renamed 2026-09-09: the badge was "Demo ESIS синк" and is now explicit
    // that nothing is connected. Same guarantee — a demo row is never shown
    // unlabelled — asserted against the wording the screen actually carries.
    expect(
      within(details).getByText(/ESIS DEMO DATA — LIVE CONNECTION NOT ACTIVE/),
    ).toBeInTheDocument();
    // ★ `getAllByText`, because a field name now appears twice in this block:
    // once in the definition row that names the service's key field, once in
    // the field list itself. The assertion is that the catalog names the
    // field at all, so either occurrence satisfies it — pinning one of the
    // two would break on the next layout change without protecting anything.
    expect(within(details).getAllByText("institutionId").length).toBeGreaterThan(0);
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
    const details = await fieldsFor("Байгууллагын мэдээлэл");
    // ★ Renamed 2026-09-09: the badge was "Demo ESIS синк" and is now explicit
    // that nothing is connected. Same guarantee — a demo row is never shown
    // unlabelled — asserted against the wording the screen actually carries.
    expect(
      within(details).getByText(/ESIS DEMO DATA — LIVE CONNECTION NOT ACTIVE/),
    ).toBeInTheDocument();
    expect(within(details).getByText("Төвийн бүс")).toBeInTheDocument();
    expect(within(details).getByText("Бяцхан нүүдэлчид (жишээ)")).toBeInTheDocument();
  });

  /*
   * ★ "Гаралтын утгуудыг бүгдийг нь" is a plural, and a roster service is where
   * that bites: one child under a heading that says ten is a screen the
   * operator cannot check anything against. Every demo record renders, and the
   * count beside them is the number of records rendered rather than a figure
   * kept by hand somewhere else.
   */
  it("renders every demo record of a list service, not only the first", async () => {
    const roster = endpoint("students", "Суралцагчийн жагсаалт", studentFields, {
      key: "students",
      domain: "ROSTER",
      sampleRows: [
        { personId: "90000000000001", firstName: "Батбаяр" },
        { personId: "90000000000002", firstName: "Ануужин" },
        { personId: "90000000000003", firstName: "Хулан" },
      ],
    });
    const body = overview(false);
    body.endpoints = [body.endpoints[0]!, roster];

    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: ESIS_PATH, body },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    const details = await fieldsFor("Суралцагчийн жагсаалт");

    expect(within(details).getByText("Батбаяр")).toBeInTheDocument();
    expect(within(details).getByText("Ануужин")).toBeInTheDocument();
    expect(within(details).getByText("Хулан")).toBeInTheDocument();
    expect(within(details).getByText("3 бичлэг")).toBeInTheDocument();
    // Three records and a header row, under the catalog's own labels.
    expect(within(details).getAllByRole("row")).toHaveLength(4);
  });

  it("drops the example entirely once ESIS returns real rows", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
          /*
            ★ `source` and `response` joined `esisResourceReadSchema` on
            2026-09-09: which transport answered, and the upstream envelope
            verbatim. These stubs are all LIVE pulls, and `response.RESULT`
            mirrors `rows` because that is what the real endpoint returns —
            `rows` is the parsed view of the same records.
          */
          source: "LIVE",
          status: "SUCCEEDED",
          errorCode: null,
          count: 1,
          durationMs: 42,
          fields: organizationFields,
          rows: [
            { institutionId: "77777", institutionName: "Жинхэнэ цэцэрлэг", regionName: "Баруун" },
          ],
          response: {
            SUCCESS_CODE: 200,
            RESPONSE_MESSAGE: "OK",
            RESULT: [
              { institutionId: "77777", institutionName: "Жинхэнэ цэцэрлэг", regionName: "Баруун" },
            ],
          },
        },
      },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    await userEvent.click(
      within(await fieldsFor("Байгууллагын мэдээлэл")).getByRole("button", {
        name: /ESIS-ээс татах/,
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Жинхэнэ цэцэрлэг")).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/ESIS DEMO DATA — LIVE CONNECTION NOT ACTIVE/),
    ).not.toBeInTheDocument();
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
      within(await fieldsFor("Бүлгийн ирцийн тулгалт")).getByRole("button", {
        name: /ESIS-ээс татах/,
      }),
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
          /*
            ★ `source` and `response` joined `esisResourceReadSchema` on
            2026-09-09: which transport answered, and the upstream envelope
            verbatim. These stubs are all LIVE pulls, and `response.RESULT`
            mirrors `rows` because that is what the real endpoint returns —
            `rows` is the parsed view of the same records.
          */
          source: "LIVE",
          status: "SUCCEEDED",
          errorCode: null,
          count: 1,
          durationMs: 42,
          fields: organizationFields,
          rows: [{ institutionId: "40305", institutionName: "Бяцхан нүүдэлчид", regionName: null }],
          response: {
            SUCCESS_CODE: 200,
            RESPONSE_MESSAGE: "OK",
            RESULT: [
              { institutionId: "40305", institutionName: "Бяцхан нүүдэлчид", regionName: null },
            ],
          },
        },
      },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    await userEvent.click(
      within(await fieldsFor("Байгууллагын мэдээлэл")).getByRole("button", {
        name: /ESIS-ээс татах/,
      }),
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
          /*
            ★ `source` and `response` joined `esisResourceReadSchema` on
            2026-09-09: which transport answered, and the upstream envelope
            verbatim. These stubs are all LIVE pulls, and `response.RESULT`
            mirrors `rows` because that is what the real endpoint returns —
            `rows` is the parsed view of the same records.
          */
          source: "LIVE",
          status: "FAILED",
          errorCode: "SCOPE_DENIED",
          count: 0,
          durationMs: null,
          fields: organizationFields,
          rows: [],
          response: {
            SUCCESS_CODE: 403,
            RESPONSE_MESSAGE: "SCOPE_DENIED",
            RESULT: [],
          },
        },
      },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    await userEvent.click(
      within(await fieldsFor("Байгууллагын мэдээлэл")).getByRole("button", {
        name: /ESIS-ээс татах/,
      }),
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
