import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";

/**
 * "Холбосны дараа мэдээллүүд нь орж ирж байна гэж харна" — the client,
 * 2026-09-08.
 *
 * ★ What that asks for is an ordering, not a widget: the values are on the
 * screen **before** anything is pressed, the way `/settings` has shown a
 * teacher their own ESIS record since it shipped. A panel whose data appears
 * only after a button invites the reader to assume the button called the
 * ministry — which, with no token issued anywhere yet, it did not. So the first
 * test here is that the demo record renders on first paint, and the second is
 * that it is labelled while it does.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const ESIS_PATH = `/kindergartens/${KG}/esis`;
const CATALOG_PATH = `${ESIS_PATH}/catalog`;

/*
 * `stubApi` matches by `startsWith` in array order, so `…/esis/resource` has to
 * be listed before `…/esis` or the overview route swallows the read.
 */

type StubField = {
  name: string;
  label: string;
  io: "OUTPUT" | "INPUT";
  ingested: boolean;
  sample?: string;
  omitReason?: string;
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
];

const studentFields: StubField[] = [
  { name: "firstName", label: "Нэр", io: "OUTPUT", ingested: true, sample: "Батбаяр" },
  {
    name: "personRegNumber",
    label: "Регистрийн дугаар",
    io: "OUTPUT",
    ingested: false,
    omitReason: "ESIS_REQUEST.md §1.1 (b) — регистрийн дугаар татахгүй",
  },
];

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
  usage: "Цэцэрлэгийн албан нэр, хаяг, ангилал",
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
    ★ The sync-state half of the catalog row, required by
    `esisOverviewSchema` since 2026-09-09. Without them the typed client's
    Zod parse throws, the panel renders nothing, and every test below reports
    a missing element rather than a short payload.
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

/**
 * `GET /kindergartens/:id/esis/catalog` — what the panel actually reads.
 *
 * ★ It read the operator's `/esis` until 2026-09-09, which is `@Roles("ADMIN")`
 * and carries the deployment's token state, blockers and run history. The panel
 * needed the service list and one flag; the teacher's screens needed to render
 * at all. This payload is that, and nothing else.
 */
function catalog(live: boolean) {
  return {
    mode: live ? ("LIVE" as const) : ("DEMO" as const),
    canRead: live,
    endpoints: [
      endpoint("organization", "Байгууллагын мэдээлэл", organizationFields),
      endpoint("studentByRegister", "Регистрээр хайх", studentFields, {
        key: "studentByRegister",
        apiId: null,
        slug: "student/:personRegNumber",
        domain: "ROSTER",
        previewable: false,
        params: ["personRegNumber"],
        fieldSource: "ADAPTER",
      }),
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("ESIS мэдээллийн панел", () => {
  it("shows the ESIS record on the screen without anything being pressed", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    expect(await screen.findByText("Бяцхан нүүдэлчид (жишээ)")).toBeInTheDocument();
    expect(screen.getByText("40305")).toBeInTheDocument();
    /*
     * ★ No `Demo ESIS` badge — removed 2026-09-08 at the client's explicit
     * instruction, given twice. The panel reads as a connected source; where
     * the values actually come from is recorded in `esis-data-panel.tsx` and
     * shown on `/admin/integrations/esis`, which keeps its badges.
     */
    expect(screen.queryByText(/Demo ESIS/)).toBeNull();
    expect(screen.getByRole("button", { name: /ESIS-ээс мэдээллээ татах/ })).toBeInTheDocument();
  });

  /*
   * ★ The rule every ESIS surface keeps: the invented tenant is gone the moment
   * a real one arrives, rather than sitting beside it under a quieter label.
   */
  it("replaces the demo record with the live one after a pull", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
          /*
            ★ `source` and `response` joined `esisResourceReadSchema` on
            2026-09-09: which transport answered, and the upstream envelope
            verbatim. `rows` is the parsed view of the same records.
          */
          source: "LIVE",
          status: "SUCCEEDED",
          errorCode: null,
          count: 1,
          durationMs: 42,
          fields: organizationFields,
          rows: [{ institutionId: "77777", institutionName: "Жинхэнэ цэцэрлэг" }],
          response: {
            SUCCESS_CODE: 200,
            RESPONSE_MESSAGE: "OK",
            RESULT: [{ institutionId: "77777", institutionName: "Жинхэнэ цэцэрлэг" }],
          },
        },
      },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    await userEvent.click(await screen.findByRole("button", { name: /ESIS-ээс мэдээллээ татах/ }));

    expect(await screen.findByText("Жинхэнэ цэцэрлэг")).toBeInTheDocument();
    expect(screen.queryByText("Бяцхан нүүдэлчид (жишээ)")).not.toBeInTheDocument();
  });

  /*
   * ★★ Every other service pre-fills its ESIS ids in demo mode so the panel is
   * complete on first paint. A national identifier has no safe invented value,
   * so this field stays empty and the panel says where the number goes.
   */
  it("never pre-fills a register number, and says it is not kept", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="studentByRegister" />);

    const input = await screen.findByLabelText("Регистрийн дугаар");
    expect(input).toHaveValue("");
    expect(screen.getByText(/хадгалахгүй/)).toBeInTheDocument();
    // A service whose portal entry has not been read says so rather than "ID null".
    expect(screen.getByText(/ID тодруулах/)).toBeInTheDocument();
  });

  /*
   * ★ The reason `rows` exists at all — 2026-09-08.
   *
   * Removing the local roster took the way into a child's record with it, and
   * the catalog's own demo roster cannot replace it: those ten people are
   * invented and match no record this product holds, so a link on one of them
   * would lead nowhere. `/children` passes its own children instead, and every
   * row opens the record it names.
   */
  it("opens the record a row names when the caller supplies one", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(
      <EsisDataPanel
        resource="organization"
        rows={[
          { institutionId: "1", institutionName: "Алтанзул Мандах" },
          { institutionId: "2", institutionName: "Батжаргал Ану" },
        ]}
        hrefs={["/children/aaa/general", "/children/bbb/general"]}
        linkField="institutionName"
      />,
    );

    // The caller's records replace the catalog's, entirely.
    expect(await screen.findByText("Алтанзул Мандах")).toBeInTheDocument();
    expect(screen.queryByText("Бяцхан нүүдэлчид (жишээ)")).toBeNull();

    // The name itself is the link — no separate "Нээх" control to find first.
    expect(screen.getByRole("link", { name: "Алтанзул Мандах" })).toHaveAttribute(
      "href",
      "/children/aaa/general",
    );
    expect(screen.getByRole("link", { name: "Батжаргал Ану" })).toHaveAttribute(
      "href",
      "/children/bbb/general",
    );
  });

  it("offers no link when the caller supplies none", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(
      <EsisDataPanel
        resource="organization"
        rows={[
          { institutionId: "1", institutionName: "Нэг" },
          { institutionId: "2", institutionName: "Хоёр" },
        ]}
      />,
    );

    await screen.findByText("Нэг");
    expect(screen.queryByRole("link", { name: "Нэг" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Хоёр" })).toBeNull();
  });

  /*
   * ★ The role gate moved into the payload — 2026-09-09.
   *
   * The panel used to check `hasRole("ADMIN")` itself, because the endpoint it
   * read was admin-only. It reads the role-scoped catalog now, so a service the
   * caller may not reach is simply not in the response and the panel has
   * nothing to draw. The screens are shared: a cook opening one that carries a
   * teacher's panel should see the screen, not a hole where a permission
   * failed.
   */
  it("renders nothing for a service the catalog does not carry", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="foodMaterials" />);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /ESIS-ээс мэдээллээ татах/ })).toBeNull(),
    );
    expect(screen.queryByText("Бяцхан нүүдэлчид (жишээ)")).toBeNull();
  });

  /* A role with no ESIS services at all — the endpoint answers 404. */
  it("renders nothing when the role reaches no ESIS service", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: CATALOG_PATH, status: 404, body: { title: "Олдсонгүй", status: 404 } },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /ESIS-ээс мэдээллээ татах/ })).toBeNull(),
    );
  });

  it("explains an upstream refusal instead of showing an empty panel", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
          /*
            ★ `source` and `response` joined `esisResourceReadSchema` on
            2026-09-09: which transport answered, and the upstream envelope
            verbatim. `rows` is the parsed view of the same records.
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
      { path: CATALOG_PATH, body: catalog(true) },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    await userEvent.click(await screen.findByRole("button", { name: /ESIS-ээс мэдээллээ татах/ }));

    const failure = await screen.findByText(/эрх олгоогүй/);
    expect(failure).toBeInTheDocument();
    // The demo record stays: a refused scope is not a reason to blank the screen.
    expect(within(document.body).getByText("Бяцхан нүүдэлчид (жишээ)")).toBeInTheDocument();
  });
});
