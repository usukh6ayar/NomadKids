import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { EsisPullButton } from "@/components/esis/esis-pull-button";

/**
 * "ESIS-ээс татах" — the staff-facing pull, tested where it now lives.
 *
 * ★ **These five cases were in `esis-fields.test.tsx` until 2026-09-14**, where
 * they drove the button through the ESIS hub screen. That screen became the
 * platform operator's (`/platform/[id]/esis`) and lost the button, for a reason
 * worth keeping written down: a superadmin holds no `Membership`, so
 * `GET /kindergartens/:id/esis/resource` answers them 404 by design, and a
 * button that always fails is worse than no button.
 *
 * ★★ The button itself did not change and is still on the screens that need
 * it — the child import, the day sheet. So the cases move to the component
 * rather than being deleted: what they prove is the dialog's contract (the
 * field labels, the parameters it refuses to guess, the upstream refusal it
 * explains, the sample that disappears), and none of that was ever about the
 * hub.
 *
 * ★★★ The dialog reads `…/esis/catalog`, the role-scoped list — it read the
 * operator's overview until the same day, which is what would have broken
 * every one of these buttons for a director.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const CATALOG_PATH = `/kindergartens/${KG}/esis/catalog`;
const RESOURCE_PATH = `/kindergartens/${KG}/esis/resource`;

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
  { name: "regionName", label: "Бүс", io: "OUTPUT", ingested: true, sample: "Төвийн бүс" },
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
  usage: "Тест",
  previewable: true,
  readable: true,
  params: [],
  fields,
  fieldSource: "PORTAL",
  ingestedFieldCount: fields.filter((field) => field.ingested).length,
  grant: "APPROVED",
  portalName: name,
  sampleRow: Object.fromEntries(
    fields.filter((field) => field.ingested).map((field) => [field.name, field.sample]),
  ),
  sampleRows: [
    Object.fromEntries(
      fields.filter((field) => field.ingested).map((field) => [field.name, field.sample]),
    ),
  ],
  direction: "ESIS_TO_NOMADKIDS",
  targetModel: "Child",
  mappings: [],
  ...extra,
});

/** `GET …/esis/catalog` — the services this role may reach. */
function catalog(live: boolean) {
  return {
    mode: live ? "LIVE" : "DEMO",
    canRead: live,
    endpoints: [
      endpoint("organization", "Байгууллагын мэдээлэл", organizationFields),
      endpoint("groupAttendance", "Бүлгийн ирцийн тулгалт", organizationFields, {
        key: "groupAttendance",
        domain: "ATTENDANCE",
        previewable: false,
        params: ["studentGroupId", "dayDate"],
      }),
    ],
  };
}

/** One live read that succeeded, with the rows ESIS returned. */
const liveRead = (rows: Record<string, string | null>[]) => ({
  resource: "organization",
  source: "LIVE",
  status: "SUCCEEDED",
  errorCode: null,
  count: rows.length,
  durationMs: 42,
  fields: organizationFields,
  rows,
  response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
});

async function openDialog(resource: "organization" | "groupAttendance", name: RegExp) {
  renderWithProviders(<EsisPullButton resource={resource} />);
  await userEvent.click(await screen.findByRole("button", { name: /ESIS-ээс татах/ }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(name)).toBeInTheDocument();
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("ESIS-ээс татах", () => {
  it("drops the example entirely once ESIS returns real rows", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: RESOURCE_PATH,
        body: liveRead([
          { institutionId: "77777", institutionName: "Жинхэнэ цэцэрлэг", regionName: "Баруун" },
        ]),
      },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);

    const dialog = await openDialog("organization", /Байгууллагын мэдээлэл/);

    expect(await within(dialog).findByText("Жинхэнэ цэцэрлэг")).toBeInTheDocument();
    expect(within(dialog).getByText("Жинхэнэ цэцэрлэг")).toBeVisible();
    expect(
      within(dialog).getByText("Техникийн хариу харах").closest("details"),
    ).not.toHaveAttribute("open");
    expect(within(dialog).queryByText(/ESIS DEMO DATA/)).not.toBeInTheDocument();
    // The invented tenant name is not on screen beside the real one.
    expect(within(dialog).queryByText("Бяцхан нүүдэлчид (жишээ)")).not.toBeInTheDocument();
  });

  it("asks for the ESIS ids a parameterised service needs before calling", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: RESOURCE_PATH, body: { detail: "unused" } },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);

    const dialog = await openDialog("groupAttendance", /Бүлгийн ирцийн тулгалт/);

    expect(within(dialog).getByLabelText("ESIS бүлгийн дугаар")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Огноо")).toBeInTheDocument();
    // Nothing is fetched until the operator supplies the ministry's own id.
    expect(calls.some((call) => call.url.includes("/esis/resource"))).toBe(false);
  });

  it("renders returned values under the catalog's own field labels", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: RESOURCE_PATH,
        body: liveRead([
          { institutionId: "40305", institutionName: "Бяцхан нүүдэлчид", regionName: null },
        ]),
      },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);

    const dialog = await openDialog("organization", /Байгууллагын мэдээлэл/);

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
        path: RESOURCE_PATH,
        body: {
          ...liveRead([]),
          status: "FAILED",
          errorCode: "SCOPE_DENIED",
          durationMs: null,
          response: { SUCCESS_CODE: 403, RESPONSE_MESSAGE: "SCOPE_DENIED", RESULT: [] },
        },
      },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);

    const dialog = await openDialog("organization", /Байгууллагын мэдээлэл/);

    /*
     * ★ The plain sentence, not "эрх олгоогүй" — 2026-09-20. A refused scope
     * is the platform operator's to fix; the reader here can try again and
     * tell somebody, which is what this says. The code and the path stay
     * available behind `EsisNoAnswer`'s `technical`.
     */
    expect(await within(dialog).findByText(/Мэдээллийг татаж чадсангүй/)).toBeInTheDocument();
  });

  it("hides the pull control from a teacher", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: CATALOG_PATH, body: catalog(true) },
    ]);
    renderWithProviders(<EsisPullButton resource="organization" />);

    /*
     * The hiding is courtesy, not the control: `esis-admin.test.ts` proves the
     * API refuses a teacher whether or not the button was ever rendered.
     */
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /ESIS-ээс татах/ })).not.toBeInTheDocument(),
    );
  });
});
