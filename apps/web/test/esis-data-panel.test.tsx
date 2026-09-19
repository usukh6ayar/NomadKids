import { screen, waitFor } from "@testing-library/react";
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

/**
 * A service wide enough to prove the table drops columns — eight fields.
 *
 * ★ Modelled on the real `foodProducts`, which carries fifteen. Five is what
 * the table draws; the rest are what pressing a row reveals.
 */
const wideFields: StubField[] = [
  { name: "productId", label: "Код", io: "OUTPUT", ingested: true, sample: "5107" },
  { name: "productName", label: "Нэр", io: "OUTPUT", ingested: true, sample: "Гурилтай шөл" },
  { name: "measureCode", label: "Хэмжих нэгж", io: "OUTPUT", ingested: true, sample: "порц" },
  { name: "productType", label: "Төрөл", io: "OUTPUT", ingested: true, sample: "SOUP" },
  { name: "calories", label: "Илчлэг", io: "OUTPUT", ingested: true, sample: "245" },
  { name: "proteins", label: "Уураг", io: "OUTPUT", ingested: true, sample: "9.8" },
  { name: "fats", label: "Өөх тос", io: "OUTPUT", ingested: true, sample: "7.2" },
  { name: "sequence", label: "Дараалал", io: "OUTPUT", ingested: true, sample: "17" },
];

/** The drill-down target — keyed on `:productId`, so it has no panel of its
 * own and is only reachable by opening a `foodProducts` row. */
const kitFields: StubField[] = [
  { name: "productId", label: "Код", io: "OUTPUT", ingested: true, sample: "5240" },
  { name: "productType", label: "Хоолны төрөл", io: "OUTPUT", ingested: true, sample: "BREAKFAST" },
  { name: "calories", label: "Илчлэг", io: "OUTPUT", ingested: true, sample: "318" },
];

const wideRows = [
  {
    productId: "5107",
    productName: "Гурилтай шөл",
    measureCode: "порц",
    productType: "SOUP",
    calories: "245",
    proteins: "9.8",
    fats: "7.2",
    sequence: "17",
  },
  {
    productId: "5108",
    productName: "Ногоотой шөл",
    measureCode: "порц",
    productType: "SOUP",
    calories: "168",
    proteins: "6.4",
    fats: "5.1",
    sequence: "18",
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
  responseMode: "LIVE",
  syncStatus: "PENDING",
  syncErrorCode: null,
  httpStatus: null,
  lastSyncAt: null,
  ...extra,
});

/**
 * `GET /kindergartens/:id/esis/catalog` — what the panel actually reads.
 *
 * ★ It read the operator's `/esis` until 2026-09-09 — the payload with the
 * deployment's token state, blockers and run history. The panel needed the
 * service list and one flag; the teacher's screens needed to render at all.
 * This payload is that, and nothing else.
 *
 * ★★ The split earned its keep on 2026-09-14, when that operator route moved to
 * `GET /platform/kindergartens/:id/esis` and `@SuperAdmin()`. Every panel here
 * kept working without an edit, because none of them had read it for three
 * years' worth of reasons written above.
 */
function catalog(live: boolean) {
  return {
    mode: "LIVE" as const,
    canRead: live,
    endpoints: [
      endpoint("organization", "Байгууллагын мэдээлэл", organizationFields),
      endpoint("foodProducts", "Бэлэн бүтээгдэхүүн", wideFields, {
        key: "foodProducts",
        apiId: 124,
        slug: "API-000223",
        domain: "FOOD",
      }),
      endpoint("foodKit", "Иж бүрдэл", kitFields, {
        key: "foodKit",
        apiId: 126,
        slug: "API-000225",
        domain: "FOOD",
        params: ["productId"],
      }),
      endpoint("studentByRegister", "Суралцагчийг РД-ээр хайх", studentFields, {
        key: "studentByRegister",
        apiId: 45,
        slug: "API-000144",
        domain: "ROSTER",
        previewable: false,
        params: ["personRegNumber"],
        fieldSource: "PORTAL",
      }),
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("ESIS мэдээллийн панел", () => {
  /*
   * ★ **Inverted on 2026-09-14.** This asserted that the panel painted
   * "Бяцхан нүүдэлчид (жишээ)" and institution 40305 before anything was
   * pressed — a fabricated tenant, on a director's screen, deliberately
   * unlabelled since 2026-09-08. The client ended it: "ene esis ni real zuil
   * shuu".
   *
   * What the panel owes on first paint is now the opposite — no values, the
   * service named, and the control that fetches real ones.
   */
  it("paints no invented record before anything is pressed", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    expect(
      await screen.findByRole("button", { name: /ESIS-ээс мэдээллээ татах/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Бяцхан нүүдэлчид (жишээ)")).toBeNull();
    expect(screen.queryByText("40305")).toBeNull();
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

    const input = await screen.findByLabelText("РД (регистрийн дугаар)");
    expect(input).toHaveValue("");
    expect(screen.getByText(/хадгалахгүй/)).toBeInTheDocument();
    /*
     * ★ The `slug · api-45 · GET /path` line was asserted here until
     * 2026-09-19 and is gone with it: a director has no api id, and the panel
     * now reads as part of the product rather than as a request inspector.
     * `/platform/[id]/esis` is where those identifiers live.
     */
    expect(screen.queryByText(/api-45/)).not.toBeInTheDocument();
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

  /*
   * ★ A live row still opens the child it names — 2026-09-14.
   *
   * `hrefs` is index-aligned with the caller's rows and is therefore dropped
   * the moment ESIS answers: the ministry's roster is not in our order and
   * need not be the same set of children. `liveHref` is the replacement — the
   * caller looks at the returned row and decides where it leads.
   *
   * ★★ The case that must lead nowhere is asserted too. A row matching no
   * local child, or matching two, gets no link rather than a guess: opening
   * somebody else's record is worse than opening nothing.
   */
  it("links a live row to the child it names, and only when that is unambiguous", async () => {
    const rows = [
      { institutionId: "1", institutionName: "Ганболд Батбаяр" },
      { institutionId: "2", institutionName: "Тодорхойгүй Хүүхэд" },
    ];
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
          source: "LIVE",
          status: "SUCCEEDED",
          errorCode: null,
          count: rows.length,
          durationMs: 12,
          fields: organizationFields,
          rows,
          response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
        },
      },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);

    renderWithProviders(
      <EsisDataPanel
        resource="organization"
        autoRead
        linkField="institutionName"
        liveHref={(row) =>
          row.institutionName === "Ганболд Батбаяр" ? "/children/aaa/general" : null
        }
      />,
    );

    expect(await screen.findByRole("link", { name: "Ганболд Батбаяр" })).toHaveAttribute(
      "href",
      "/children/aaa/general",
    );
    expect(screen.queryByRole("link", { name: "Тодорхойгүй Хүүхэд" })).toBeNull();
    expect(screen.getByText("Тодорхойгүй Хүүхэд")).toBeInTheDocument();
  });

  /*
   * ★ "хүснэгтүүдийг зүгээр энгийн харагдуул. хажуу тийшээ scroll ntr
   * хийхгүй" — the client, 2026-09-09.
   *
   * `esis-rows.tsx` used to set a pixel floor by column count (720, 1400 or
   * 2400), so a wide service scrolled sideways by construction. These three
   * cases are the replacement contract: the table shows five columns, the rest
   * of the record is one press away, and no floor is emitted.
   */
  it("shows at most five columns, however many the service carries", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="foodProducts" rows={wideRows} />);

    await screen.findByText("Гурилтай шөл");

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Код", "Нэр", "Хэмжих нэгж", "Төрөл", "Илчлэг"]);
    // The sixth and eighth fields exist on the record and not in the table.
    expect(headers).not.toContain("Уураг");
    expect(headers).not.toContain("Дараалал");
  });

  it("puts no minimum width on the table, so nothing scrolls sideways", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    const { container } = renderWithProviders(
      <EsisDataPanel resource="foodProducts" rows={wideRows} />,
    );

    await screen.findByText("Гурилтай шөл");

    const table = container.querySelector("table");
    // `min-w-0`, never a pixel floor — the assertion is on the *class*, since
    // jsdom computes no layout to measure.
    expect(table?.className).not.toMatch(/min-w-\[/);
    expect(table?.className).toContain("min-w-0");

    /*
     * ★★ And on the `<table>`, not the Card around it.
     *
     * `TableShell`'s `className` lands on the wrapping Card, so `table-fixed`
     * passed there does nothing — the table falls back to auto layout, the
     * `truncate` on each cell stops ellipsing and starts *widening*, and the
     * sideways scroll this whole change removed comes straight back through
     * `overflow-x-auto`. That was the shipped state until it was looked for;
     * asserting on the element rather than the component is what makes the
     * difference visible. `tableClassName` is the prop that lands here.
     */
    expect(table?.className).toContain("table-fixed");
    expect(container.querySelector("[data-ui-table]")?.className).not.toContain("table-fixed");
  });

  it("reveals every field of the row that was pressed", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="foodProducts" rows={wideRows} />);

    await screen.findByText("Гурилтай шөл");
    // Absent until asked for — it is one of the columns the table drops.
    expect(screen.queryByText("Уураг")).toBeNull();

    await user.click(screen.getByText("Гурилтай шөл"));

    // The dropped fields, and this row's values for them.
    expect(await screen.findByText("Уураг")).toBeInTheDocument();
    expect(screen.getByText("Дараалал")).toBeInTheDocument();
    expect(screen.getByText("9.8")).toBeInTheDocument();
    // And not the other row's — one row opens, not the table.
    expect(screen.queryByText("6.4")).toBeNull();
  });

  /*
   * ★ The drill-down to a *second service* — how `foodKit` is reachable at
   * all. It keys on `:productId`, so a panel of its own would ask the cook to
   * type a ministry product code; opening a row supplies it.
   */
  it("reads the detail service for the row that was opened", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(
      <EsisDataPanel
        resource="foodProducts"
        rows={wideRows}
        detail={{
          resources: ["foodKit"],
          param: { name: "productId", from: "productId" },
        }}
      />,
    );

    await screen.findByText("Гурилтай шөл");
    // Closed: the detail service is not on the screen at all.
    expect(screen.queryByText("Иж бүрдэл")).toBeNull();

    await user.click(screen.getByText("Гурилтай шөл"));

    expect(await screen.findByText("Иж бүрдэл")).toBeInTheDocument();

    /*
     * ★★ Compact, not a second full panel. A nested panel with its own
     * database icon, slug line, record badge, pull button and footer
     * disclaimer is a page inside a table cell — and there would be one per
     * detail service, per opened row.
     */
    expect(screen.getAllByRole("button", { name: /ESIS-ээс мэдээллээ татах/ })).toHaveLength(1);
    // One pull button is the measure now that the footer disclaimer is gone —
    // the assertion was always "the nested panel is not a second full panel".
  });

  /*
   * ★ A row does one thing or the other. `/children`'s roster leads to a
   * child's own page, which is a better дэлгэрэнгүй than any panel draws, and
   * opening a second answer underneath the first would be worse than either.
   */
  it("does not expand a row that already leads somewhere", async () => {
    const user = userEvent.setup();
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
        hrefs={["/children/aaa/general", null]}
        linkField="institutionName"
      />,
    );

    await screen.findByText("Нэг");
    await user.click(screen.getByText("Хоёр"));

    // No second copy of the value appeared beneath it, and no row announces
    // itself as expandable.
    expect(screen.getAllByText("Хоёр")).toHaveLength(1);
    expect(document.querySelector("[aria-expanded]")).toBeNull();
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
  /*
   * ★ A parameter the screen already knows is not a question — 2026-09-09.
   *
   * The panel asked for every path value a service declares, so a child's own
   * record showed a register-number box beside data drawn from that very
   * number: a second search on a screen about one person. Searching by
   * register is how you find a child *among many*, and that is the roster's
   * panel, where the caller supplies nothing and the field is still asked for.
   */
  /*
   * ★★ And a screen already about one record asks for nothing at all — the
   * client did not want the "add a регистр first" sentence in its place
   * either. The panel shows what ESIS holds; a live pull simply waits for the
   * number to reach the record.
   */
  it("asks for nothing on a screen that identifies its own record", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="studentByRegister" askForParams={false} />);

    expect(await screen.findByText("Суралцагчийг РД-ээр хайх")).toBeInTheDocument();
    /*
     * The assertion this test is named for: `askForParams={false}` means no
     * register-number box on a screen that already identifies its child.
     *
     * ★ It used to add "and the record is still drawn", proved by finding
     * "Батбаяр" — a sample. With the samples gone the panel draws nothing
     * until a live read lands, so what remains is the absence of the input.
     */
    expect(screen.queryByLabelText("Регистрийн дугаар")).toBeNull();
  });

  it("asks for nothing the caller already supplied", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(
      <EsisDataPanel resource="studentByRegister" params={{ personRegNumber: "УБ11223344" }} />,
    );

    expect(await screen.findByText("Суралцагчийг РД-ээр хайх")).toBeInTheDocument();
    expect(screen.queryByLabelText("Регистрийн дугаар")).toBeNull();
  });

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

            ★★ `endpoint` joined it on 2026-09-14 so a failed read can name the
            service that did not answer. It is optional in the schema — older
            payloads still parse — so a fixture that omits it simply renders no
            path, which is why it is spelled out here.
          */
          endpoint: { method: "GET", path: "/svc/api/hub/v2/organization" },
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

    /*
     * ★ **Inverted on 2026-09-14.** The line here read "the demo record stays:
     * a refused scope is not a reason to blank the screen", and it was exactly
     * backwards — a refused scope is the one moment the screen must not look
     * populated. A director who could not tell a fabricated tenant from their
     * own was being shown a working integration over a failed call.
     *
     * The endpoint is named instead, which is the thing they can act on.
     */
    expect(screen.queryByText("Бяцхан нүүдэлчид (жишээ)")).toBeNull();
    /*
     * `getAllByText`: the panel names the endpoint in two places on a failed
     * read — the `EsisNoAnswer` card where the table would have been, and the
     * request/response block below it. Both are the point; pinning one would
     * break on the next layout change without protecting anything.
     */
    expect(screen.getAllByText(/\/svc\/api\/hub\/v2\/organization/).length).toBeGreaterThan(0);
  });

  /*
   * ★ Plan `2026-09-16-esis-sync-tiers.md` Task 7 — "the screens read the
   * copy". A reference resource (buildings, rooms, the cook/* catalogues, …)
   * now answers `source: "STORE"` with a `syncedAt`, and this panel is where
   * a director or a cook actually looks at one. The screen has to say the
   * value came from a monthly copy rather than reading as though it just
   * asked the ministry.
   */
  it("renders the stored copy and says when it was synced", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
          source: "STORE",
          status: "SUCCEEDED",
          errorCode: null,
          count: 1,
          durationMs: null,
          fields: organizationFields,
          rows: [{ institutionId: "77777", institutionName: "Жинхэнэ цэцэрлэг" }],
          syncedAt: "2026-09-01T03:10:00.000Z",
          response: {
            SUCCESS_CODE: 200,
            RESPONSE_MESSAGE: "SUCCESS",
            RESULT: [{ institutionId: "77777", institutionName: "Жинхэнэ цэцэрлэг" }],
          },
        },
      },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    await userEvent.click(await screen.findByRole("button", { name: /ESIS-ээс мэдээллээ татах/ }));

    expect(await screen.findByText("Жинхэнэ цэцэрлэг")).toBeInTheDocument();
    // The sweep's own date, not the moment this browser happened to press the button.
    expect(screen.getByText(/Сүүлд шинэчилсэн:/)).toBeInTheDocument();
  });

  /*
   * ★ **No live fallback when the store is empty — a decision, not an
   * oversight** (plan §0(a), Task 7). The screen must say what to do next
   * (CLAUDE.md §5) rather than rendering an empty table that looks like ESIS
   * simply had nothing.
   */
  it("tells the reader to sync rather than rendering an empty table", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
          endpoint: { method: "GET", path: "/svc/api/hub/v2/cook/product" },
          source: "STORE",
          status: "FAILED",
          errorCode: "NOT_SYNCED",
          count: 0,
          durationMs: null,
          fields: organizationFields,
          rows: [],
          syncedAt: null,
          response: { SUCCESS_CODE: 0, RESPONSE_MESSAGE: "NOT_SYNCED", RESULT: [] },
        },
      },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    await userEvent.click(await screen.findByRole("button", { name: /ESIS-ээс мэдээллээ татах/ }));

    expect(await screen.findByText(/синк хийгдээгүй байна/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
