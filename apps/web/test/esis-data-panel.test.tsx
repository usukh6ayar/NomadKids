import { screen, within } from "@testing-library/react";
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
  ...extra,
});

function overview(configured: boolean) {
  return {
    deployment: {
      configured,
      baseUrl: "https://hubv2.esis.edu.mn",
      hasToken: configured,
    },
    connection: {
      mapped: configured,
      institutionId: configured ? "40305" : null,
      environment: configured ? ("TEST" as const) : null,
      mappedAt: null,
      mappingMatchesDeployment: configured,
    },
    stages: [
      { code: "C1", label: "API каталог", status: "READY" },
      { code: "C2", label: "Код ба schema", status: "READY" },
      { code: "C3", label: "Token ба API эрх", status: configured ? "READY" : "WAITING" },
      { code: "C4", label: "Test орчны шалгалт", status: "WAITING" },
      { code: "C5", label: "Production sync", status: "WAITING" },
    ],
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
    recentRuns: [],
    canPreview: configured,
    blockers: configured ? [] : ["Server дээр ESIS token болон endpoint тохируулаагүй байна."],
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
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    expect(await screen.findByText("Бяцхан нүүдэлчид (жишээ)")).toBeInTheDocument();
    expect(screen.getByText("40305")).toBeInTheDocument();
    // Present *and* labelled, on the same view.
    expect(screen.getByText("Demo ESIS синк")).toBeInTheDocument();
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
          status: "SUCCEEDED",
          errorCode: null,
          count: 1,
          durationMs: 42,
          fields: organizationFields,
          rows: [{ institutionId: "77777", institutionName: "Жинхэнэ цэцэрлэг" }],
        },
      },
      { path: ESIS_PATH, body: overview(true) },
    ]);
    renderWithProviders(<EsisDataPanel resource="organization" />);

    await userEvent.click(await screen.findByRole("button", { name: /ESIS-ээс мэдээллээ татах/ }));

    expect(await screen.findByText("Жинхэнэ цэцэрлэг")).toBeInTheDocument();
    expect(screen.queryByText("Бяцхан нүүдэлчид (жишээ)")).not.toBeInTheDocument();
    expect(screen.queryByText("Demo ESIS синк")).not.toBeInTheDocument();
    expect(screen.getByText("Бодит ESIS синк")).toBeInTheDocument();
  });

  /*
   * ★★ Every other service pre-fills its ESIS ids in demo mode so the panel is
   * complete on first paint. A national identifier has no safe invented value,
   * so this field stays empty and the panel says where the number goes.
   */
  it("never pre-fills a register number, and says it is not kept", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    renderWithProviders(<EsisDataPanel resource="studentByRegister" />);

    const input = await screen.findByLabelText("Регистрийн дугаар");
    expect(input).toHaveValue("");
    expect(screen.getByText(/хадгалахгүй/)).toBeInTheDocument();
    // A service whose portal entry has not been read says so rather than "ID null".
    expect(screen.getByText(/ID тодруулах/)).toBeInTheDocument();
  });

  it("renders nothing for a teacher, because the route answers 404", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: ESIS_PATH, body: overview(false) },
    ]);
    const { container } = renderWithProviders(<EsisDataPanel resource="organization" />);

    await screen.findByText((_, node) => node === container, { exact: false }).catch(() => null);
    expect(screen.queryByRole("button", { name: /ESIS-ээс мэдээллээ татах/ })).toBeNull();
  });

  it("explains an upstream refusal instead of showing an empty panel", async () => {
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
    renderWithProviders(<EsisDataPanel resource="organization" />);

    await userEvent.click(await screen.findByRole("button", { name: /ESIS-ээс мэдээллээ татах/ }));

    const failure = await screen.findByText(/эрх олгоогүй/);
    expect(failure).toBeInTheDocument();
    // The demo record stays: a refused scope is not a reason to blank the screen.
    expect(within(document.body).getByText("Бяцхан нүүдэлчид (жишээ)")).toBeInTheDocument();
  });
});
