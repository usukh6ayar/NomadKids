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

    expect(await screen.findByRole("button", { name: /Шинэчлэх/ })).toBeInTheDocument();
    expect(screen.queryByText("Бяцхан нүүдэлчид (жишээ)")).toBeNull();
    expect(screen.queryByText("40305")).toBeNull();
  });

  /*
   * ★ The rule the client asked for on 2026-09-20: "хэрэглэгч … өөрөө гараар
   * дарж татмааргүй байна, автоматаар татсан байдаг байгаасай."
   *
   * The panel below passes **no** `autoRead` — it takes the default, which is
   * the thing under test. A director opening a screen with four panels on it
   * used to press four buttons before seeing anything.
   */
  it("reads on its own, with no autoRead and nothing pressed", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "organization",
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

    expect(await screen.findByText("Жинхэнэ цэцэрлэг")).toBeInTheDocument();
    // And it dates itself, which is the other half of data appearing unasked.
    expect(await screen.findByText(/Сүүлд татсан:/)).toBeInTheDocument();
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

    await userEvent.click(await screen.findByRole("button", { name: /Шинэчлэх/ }));

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

  it("searches ESIS by register only after Enter, then shows the returned record", async () => {
    const calls = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${ESIS_PATH}/resource`,
        body: {
          resource: "studentByRegister",
          source: "LIVE",
          status: "SUCCEEDED",
          errorCode: null,
          count: 1,
          durationMs: 12,
          fields: studentFields,
          rows: [{ firstName: "Батбаяр", personRegNumber: null }],
          response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: [] },
        },
      },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);
    renderWithProviders(<EsisDataPanel resource="studentByRegister" />);

    const input = await screen.findByRole("searchbox", { name: "РД (регистрийн дугаар)" });
    expect(input).toHaveAttribute("placeholder", "РД-ээр сурагч хайх");
    await userEvent.type(input, "уб11223344");
    expect(calls.calls.filter((call) => call.url.startsWith(`${ESIS_PATH}/resource`))).toHaveLength(
      0,
    );

    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("Батбаяр")).toBeInTheDocument();
    const reads = calls.calls.filter((call) => call.url.startsWith(`${ESIS_PATH}/resource`));
    expect(reads).toHaveLength(1);
    expect(reads[0]!.url).toContain("personRegNumber=%D0%A3%D0%91");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("does not claim there is no student when ESIS reading is unavailable", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="studentByRegister" />);

    await userEvent.type(await screen.findByRole("searchbox"), "УБ11223344{Enter}");
    expect(await screen.findByText("Мэдээллийг татаж чадсангүй")).toBeInTheDocument();
    expect(screen.queryByText("Мэдээлэл алга байна")).not.toBeInTheDocument();
    expect(calls.filter((call) => call.url.startsWith(`${ESIS_PATH}/resource`))).toHaveLength(0);
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
  it("shows a readable summary on each card, with other fields behind its detail", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="foodProducts" rows={wideRows} />);

    await screen.findByText("Гурилтай шөл");

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText("Код")).toHaveLength(2);
    expect(screen.getAllByText("Хэмжих нэгж")).toHaveLength(2);
    expect(screen.getAllByText("Төрөл")).toHaveLength(2);
    expect(screen.getAllByText("Илчлэг")).toHaveLength(2);
    expect(screen.queryByText("Уураг")).not.toBeInTheDocument();
    expect(screen.queryByText("Дараалал")).not.toBeInTheDocument();
  });

  it("keeps cards within the panel without a sideways table", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    const { container } = renderWithProviders(
      <EsisDataPanel resource="foodProducts" rows={wideRows} />,
    );

    await screen.findByText("Гурилтай шөл");

    expect(container.querySelector("table")).toBeNull();
    const cards = container.querySelectorAll("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.className).toContain("min-w-0");
    expect(cards[0]?.className).not.toMatch(/min-w-\[/);
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
    expect(screen.getAllByRole("button", { name: /Шинэчлэх/ })).toHaveLength(1);
    // One pull button is the measure now that the footer disclaimer is gone —
    // the assertion was always "the nested panel is not a second full panel".
  });

  it("keeps the detail service reachable when a list has only one record", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog(false) },
    ]);
    renderWithProviders(
      <EsisDataPanel
        resource="foodProducts"
        rows={wideRows.slice(0, 1)}
        detail={{ resources: ["foodKit"], param: { name: "productId", from: "productId" } }}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Гурилтай шөл" }));
    expect(await screen.findByText("Иж бүрдэл")).toBeInTheDocument();
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

    await waitFor(() => expect(screen.queryByRole("button", { name: /Шинэчлэх/ })).toBeNull());
    expect(screen.queryByText("Бяцхан нүүдэлчид (жишээ)")).toBeNull();
  });

  /* A role with no ESIS services at all — the endpoint answers 404. */
  it("renders nothing when the role reaches no ESIS service", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: CATALOG_PATH, status: 404, body: { title: "Олдсонгүй", status: 404 } },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    await waitFor(() => expect(screen.queryByRole("button", { name: /Шинэчлэх/ })).toBeNull());
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

    await userEvent.click(await screen.findByRole("button", { name: /Шинэчлэх/ }));

    /*
     * ★ The plain sentence, not "эрх олгоогүй" — 2026-09-20. A refused scope
     * is something the platform operator fixes; a director reading their own
     * kindergarten can only try again and tell somebody, which is what this
     * now says. The code and the path are still available to whoever is
     * diagnosing, behind `EsisNoAnswer`'s `technical`.
     */
    const failure = await screen.findByText(/Мэдээллийг татаж чадсангүй/);
    expect(failure).toBeInTheDocument();
    expect(screen.queryByText(/эрх олгоогүй/)).toBeNull();

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
    // And the path is nowhere on a product screen — see the note above.
    expect(screen.queryByText(/\/svc\/api\/hub\/v2\/organization/)).toBeNull();
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

    await userEvent.click(await screen.findByRole("button", { name: /Шинэчлэх/ }));

    expect(await screen.findByText("Жинхэнэ цэцэрлэг")).toBeInTheDocument();
    // The sweep's own date, not the moment this browser happened to press the button.
    expect(screen.getByText(/Сүүлд татсан:/)).toBeInTheDocument();
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

    await userEvent.click(await screen.findByRole("button", { name: /Шинэчлэх/ }));

    expect(await screen.findByText(/синк хийгдээгүй байна/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
