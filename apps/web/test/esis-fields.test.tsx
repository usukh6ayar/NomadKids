import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTER,
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import EsisIntegrationPage from "@/app/(app)/platform/[id]/esis/page";

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
/*
 * ★ The platform route, since 2026-09-14. This screen was
 * `/admin/integrations/esis` on `GET /kindergartens/:id/esis` and is now the
 * operator's, on `GET /platform/kindergartens/:id/esis` — the token, the
 * granted scope and the institution mapping are one deployment's properties,
 * and a director could clear none of the blockers it lists.
 */
const ESIS_PATH = `/platform/kindergartens/${KG}/esis`;

/**
 * A platform operator.
 *
 * ★ **No memberships**, which is the whole point of the role (CLAUDE.md §1.1)
 * and the reason this screen had to stop reading the tenant's own routes. A
 * stub that gave them an `ADMIN` membership would pass while the real operator
 * got 404s.
 */
const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

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
  /*
    ★ `grant` and `portalName` joined `esisOverviewSchema` on 2026-09-14 with
    the request register. Same trap the two notes below describe: omit them and
    the Zod parse throws, the page falls to its error state, and every test
    here reports a missing tab rather than a short payload.
  */
  grant: "APPROVED",
  portalName: name,
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
  responseMode: "LIVE",
  syncStatus: "PENDING",
  syncErrorCode: null,
  httpStatus: null,
  lastSyncAt: null,
  ...extra,
});

function overview(canPreview: boolean) {
  return {
    /*
      ★ `mode` is required by `esisOverviewSchema` and is now the literal
      `"LIVE"` — `demoMode` left the payload on 2026-09-14 with the mock
      transport. A stub that omits a required key does not fail where you would
      expect: the typed client validates with Zod, the parse throws, and the
      page renders its error state, so every test below reports "the Сервис ба
      талбар tab does not exist" rather than "the payload is short a field".
    */
    deployment: {
      configured: canPreview,
      mode: "LIVE",
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
    requests: {
      reviewedAt: "2026-09-14",
      counts: {
        total: 4,
        approved: 3,
        pending: 1,
        cancelled: 0,
        wired: 2,
        approvedUnwired: 1,
      },
      items: [
        {
          apiId: 59,
          name: "Байгууллагын ерөнхий мэдээлэл",
          group: "EBS",
          status: "APPROVED",
          requestedAt: "2026-09-11",
          serviceKey: "organization",
        },
        {
          apiId: 100004874669777,
          name: "Суралцагчийн жагсаалт",
          group: "EBS",
          status: "APPROVED",
          requestedAt: "2026-09-11",
          serviceKey: "students",
        },
        {
          apiId: 62,
          name: "Вакциний мэдээлэл",
          group: "EBS",
          status: "APPROVED",
          requestedAt: "2026-09-11",
          serviceKey: null,
        },
        {
          apiId: 147,
          name: "Сүү хөтөлбөрийн гүйцэтгэл хадгалах",
          group: "EBS",
          status: "PENDING",
          requestedAt: "2026-09-11",
          serviceKey: null,
        },
      ],
    },
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
  // The screen reads the kindergarten from the route now, not from the session:
  // an operator holds no membership to read a "primary" kindergarten from.
  setParams({ id: KG });
});

describe("ESIS гаралтын талбарууд", () => {
  it("names every output field, including the ones it refuses", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
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
      { path: "/auth/me", body: operator() },
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

  it("shows the field contract without an extra pull action", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    const details = await fieldsFor("Байгууллагын мэдээлэл");
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
   * ★ **Inverted on 2026-09-14.** This test used to assert that the screen
   * showed "Бяцхан нүүдэлчид (жишээ)" and "Төвийн бүс" — invented values for
   * an invented tenant — before anything had been read, behind a badge saying
   * so. The client ended that arrangement, so the test now pins the opposite:
   * those strings must not be on the screen at all.
   *
   * Kept rather than deleted because it is the regression that matters. The
   * easiest way to "fix" an empty-looking operator screen is to put a sample
   * back, and this fails the moment somebody does.
   */
  it("shows no invented values before anything has been read", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await openFieldsTab();
    const details = await fieldsFor("Байгууллагын мэдээлэл");

    expect(within(details).queryByText("Төвийн бүс")).not.toBeInTheDocument();
    expect(within(details).queryByText("Бяцхан нүүдэлчид (жишээ)")).not.toBeInTheDocument();
    // The contract is still there — it is a published fact, not a sample.
    expect(within(details).getByText("regionName")).toBeInTheDocument();
  });

  /*
   * ★ **Removed on 2026-09-14: "renders every demo record of a list service".**
   *
   * It asserted that a roster service drew all three of its invented children
   * — Батбаяр, Ануужин, Хулан — with "3 бичлэг" beside them. The reasoning was
   * sound for what it was ("one child under a heading that says ten is a
   * screen the operator cannot check anything against"), and the whole feature
   * it protected is gone: the operator screen shows the field contract now,
   * and records only when ESIS has actually returned some.
   *
   * The test above it — "shows no invented values before anything has been
   * read" — is what guards this area now.
   */

  /*
   * ★ The register tab, added 2026-09-14 with the move to the operator's
   * surface. "Хэдэн хүсэлт зөвшөөрөгдсөн, хэдийг ашиглаж байна" was the
   * client's own question, and the answer is a platform figure: one ESIS
   * developer account holds the grants for every kindergarten.
   */
  it("counts the ESIS grants and says how many are unused", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await userEvent.click(await screen.findByRole("tab", { name: /Эрхийн хүсэлт/ }));

    // The date the register was read off the portal, not "now".
    expect(await screen.findByText(/2026-09-14/)).toBeInTheDocument();
    expect(
      screen.getByText(/Зөвшөөрөгдсөн 3 сервисийн 2-г нь систем дуудаж байна/),
    ).toBeInTheDocument();

    // A granted service nothing calls is named as such rather than omitted.
    const row = screen.getByText("Вакциний мэдээлэл").closest("tr") as HTMLElement;
    expect(within(row).getByText("Холбоогүй")).toBeInTheDocument();
  });

  /*
   * ★ The authorization half of the move. `RequireSuperAdmin` renders nothing
   * and redirects, so a director who kept the old bookmark lands back on their
   * own dashboard — and the API answers 404 regardless, which is
   * `esis-admin`'s test, not this one.
   */
  it("keeps a kindergarten admin off the operator screen", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByRole("tab", { name: /Сервис ба талбар/ })).not.toBeInTheDocument();
  });
});

/**
 * The "Түүх" tab, since 2026-09-17 restored to `overview.recentRuns` — the
 * paginated `sync-runs` history and its "Татах" buttons moved to
 * `/admin/esis-sync/page.tsx`'s test file (`admin-esis-sync.test.tsx`), the
 * kindergarten `ADMIN`'s own screen. See that page's doc comment for why: the
 * platform operator's `isSuperAdmin` flag does not carry a tenant `ADMIN`
 * membership, so `sync-runs` 404s for a pure operator — this screen's own
 * `recentRuns` is the one history feed such an account can always reach.
 */
describe("ESIS-ийн ажиллагааны түүх", () => {
  it("shows a scheduled run as having no initiator", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: ESIS_PATH,
        body: {
          ...overview(true),
          recentRuns: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              status: "SUCCEEDED",
              resources: ["staff", "teachers"],
              summary: null,
              errorCode: null,
              startedAt: "2026-09-17T03:10:00.000Z",
              finishedAt: "2026-09-17T03:10:05.000Z",
              initiatedBy: null,
              mode: "LIVE",
            },
          ],
        },
      },
    ]);
    renderWithProviders(<EsisIntegrationPage />);

    await userEvent.click(await screen.findByRole("tab", { name: /Түүх/ }));

    expect(await screen.findByText("хуваарь")).toBeInTheDocument();
  });
});
