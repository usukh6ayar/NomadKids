import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { childDetailSchema } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { ChildGeneralInfo } from "@/components/child/child-general-info";

/**
 * Ерөнхий, phase 2 of the 2026-10-01 tidy — ESIS folded into the cards.
 *
 * "ЭСИС дэх бүртгэл", "Сурагчийн ерөнхий мэдээлэл", "Өрхийн мэдээлэл" and
 * "Амьдрах орчин" were four more full sections. Their facts now sit on the
 * rows they describe, marked ЭСИС; the household pair is one folded section;
 * every ESIS field is still a link away ("ЭСИС-ийн бүх талбарыг харах"); and one
 * "ЭСИС-ээс татах" reads them all again.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const CHILD = "55555555-5555-4555-8555-555555555555";

const child = childDetailSchema.parse({
  id: CHILD,
  lastName: "Ганболд",
  firstName: "Батбаяр",
  sex: "MALE",
  dateOfBirth: "2021-04-12",
  nationalId: "УШ21241200",
  enrollments: [
    {
      id: "eeee1111-1111-4111-8111-eeeeeeeeeeee",
      group: { id: "44444444-4444-4444-8444-444444444444", name: "Ахлах А бүлэг" },
      schoolYear: { id: "ffff1111-1111-4111-8111-ffffffffffff", name: "2026-2027" },
      status: "ACTIVE",
      startedOn: "2026-09-01",
      endedOn: null,
    },
  ],
  guardianships: [
    {
      id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      relation: "MOTHER",
      canView: true,
      guardian: {
        id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
        lastName: "Бат",
        firstName: "Мөнхзул",
        phone: "99112233",
        email: null,
      },
    },
  ],
});

function endpoint(key: string, params: string[] = []) {
  return {
    key,
    name: key,
    domain: "ROSTER",
    usage: key,
    apiId: 1,
    slug: key,
    method: "GET",
    path: `/svc/${key}`,
    params,
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

const catalog = {
  mode: "LIVE" as const,
  canRead: true,
  endpoints: [
    endpoint("studentInfo", ["personRegNumber"]),
    endpoint("studentCheck"),
    endpoint("studentContacts"),
    endpoint("studentStatistics"),
    endpoint("studentCondition"),
    endpoint("studentStatisticsSave"),
    endpoint("studentConditionSave"),
  ],
};

function read(resource: string, rows: Record<string, string | null>[]) {
  const names = Object.keys(rows[0] ?? {});
  return {
    resource,
    endpoint: { method: "GET", path: `/svc/${resource}` },
    source: "LIVE" as const,
    status: "SUCCEEDED" as const,
    errorCode: null,
    count: rows.length,
    durationMs: 10,
    fields: names.map((name, index) => ({
      name,
      label: name,
      io: "OUTPUT" as const,
      ingested: true,
      summary: index + 1,
    })),
    rows,
    response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
  };
}

function stub(roles: ("ADMIN" | "PARENT")[] = ["ADMIN"]) {
  const resource = `/kindergartens/${KG}/esis/resource`;
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: `/kindergartens/${KG}/esis/catalog`, body: catalog },
    {
      path: `${resource}?resource=studentInfo`,
      body: read("studentInfo", [
        {
          familyName: "Боржигон",
          studentGroupName: "Ахлах Б бүлэг",
          programStatusName: "Шилжсэн",
          actionDate: "2026-06-02",
        },
      ]),
    },
    {
      path: `${resource}?resource=studentCheck`,
      body: read("studentCheck", [{ isRegistered: "true", message: "Бүртгэлтэй" }]),
    },
    {
      path: `${resource}?resource=studentContacts`,
      body: read("studentContacts", [
        // The mother — matched by her number, with a second number and a job.
        {
          section: "relInfo",
          studentContactId: "1",
          lastName: "Бат",
          firstName: "Мөнхзул",
          familyName: "Боржигон",
          legalEmployerName: "Цэцэгс майнинг",
          jobTitle: "оператор",
          phoneNumber: null,
        },
        { section: "relPhone", studentContactId: "1", phoneNumber: "99112233" },
        { section: "relPhone", studentContactId: "1", phoneNumber: "88001122" },
        // A guardian ESIS has and nobody here is linked to.
        {
          section: "relInfo",
          studentContactId: "2",
          lastName: "Дорж",
          firstName: "Ганбат",
          familyName: null,
          legalEmployerName: null,
          jobTitle: null,
          phoneNumber: null,
        },
        { section: "relPhone", studentContactId: "2", phoneNumber: "95551234" },
      ]),
    },
    {
      path: `${resource}?resource=studentCondition`,
      body: read("studentCondition", [
        {
          livingPlaceDistance: "1.5 км",
          enrollYear: "2025-09-01T00:00:00.000Z",
          annualTuitionFee: "1200000",
          dormitoryOwner: null,
        },
      ]),
    },
    { path: resource, body: read("other", []) },
  ]);
}

function render(isStaff = true) {
  return renderWithProviders(<ChildGeneralInfo child={child} childId={CHILD} isStaff={isStaff} />);
}

describe("Ерөнхий — ESIS folded into the cards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("puts ESIS's facts on the rows they describe, marked ЭСИС", async () => {
    stub();
    render();

    const general = await screen.findByRole("region", { name: "Ерөнхий мэдээлэл" });
    expect(await within(general).findByText("Боржигон")).toBeInTheDocument();
    expect(within(general).getByText(/Шилжсэн/)).toBeInTheDocument();
    expect(within(general).getByText(/2026-06-02/)).toBeInTheDocument();
    expect(await within(general).findByText("Бүртгэлтэй")).toBeInTheDocument();
    // ESIS files the child under another group, which is said on the group row.
    expect(within(general).getByText(/ЭСИС-д: Ахлах Б бүлэг/)).toBeInTheDocument();
    expect(within(general).getAllByText("ЭСИС").length).toBeGreaterThan(0);

    // Ургийн овог leads, then Овог and Нэр.
    const labels = within(general)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(labels.slice(0, 3)).toEqual(["Ургийн овог", "Овог", "Нэр"]);
  });

  it("folds the separate ESIS sections and keeps every field one press away", async () => {
    stub();
    render();

    await screen.findByRole("region", { name: "Ерөнхий мэдээлэл" });
    expect(screen.queryByRole("heading", { name: "Өрхийн мэдээлэл", level: 2 })).toBeNull();
    // Every ESIS field is a link at the foot, not a fold in the page.
    expect(screen.queryByText("ЭСИС-ийн бүх мэдээлэл")).toBeNull();
    expect(screen.getByRole("button", { name: /ЭСИС-ийн бүх талбарыг харах/ })).toBeInTheDocument();
    // Өрхийн мэдээлэл stays folded (its flags have no names) with its action.
    const fold = screen.getByText("Өрхийн мэдээлэл").closest("details")!;
    await userEvent.setup().click(within(fold).getByText("Өрхийн мэдээлэл"));
    await waitFor(() =>
      expect(within(fold).getAllByRole("button", { name: "ЭСИС рүү илгээх" })).toHaveLength(1),
    );
  });

  /*
    ★ Амьдрах орчин is a card like the rest — 2026-10-01, at the client's
    request. Only the fields ESIS filled, under their labels; an empty
    dormitory field is not drawn; the send action is in the heading.
  */
  it("draws Амьдрах орчин as a card of the fields ESIS filled", async () => {
    stub();
    render();

    const living = await screen.findByRole("region", { name: /Амьдрах орчин/ });
    expect(await within(living).findByText("Цэцэрлэг хүртэлх зай")).toBeInTheDocument();
    expect(within(living).getByText("1.5 км")).toBeInTheDocument();
    expect(within(living).getByText("2025-09-01")).toBeInTheDocument();
    expect(within(living).getByText("1,200,000 ₮")).toBeInTheDocument();
    expect(within(living).queryByText(/Дотуур байр/)).toBeNull();
    expect(
      await within(living).findByRole("button", { name: "ЭСИС рүү илгээх" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Өрх ба амьдрах орчин")).toBeNull();
  });

  it("reads every ESIS panel again from one button", async () => {
    const user = userEvent.setup();
    const api = stub();
    render();

    const button = await screen.findByRole("button", { name: /ЭСИС-ээс татах/ });
    const general = await screen.findByRole("region", { name: "Ерөнхий мэдээлэл" });
    await within(general).findByText("Боржигон");
    const before = api.calls.filter((call) => call.url.includes("/esis/resource")).length;

    await user.click(button);
    await waitFor(() =>
      expect(
        api.calls.filter((call) => call.url.includes("/esis/resource")).length,
      ).toBeGreaterThan(before),
    );
    expect(await screen.findByText("ЭСИС-ийн мэдээлэл шинэчлэгдлээ.")).toBeInTheDocument();
  });

  /*
    ★ Phase 3: ESIS's guardians read person by person into the cards — the
    same parent is no longer listed twice, and the ones ESIS has that nobody
    here is linked to are named once, below.
  */
  it("matches ESIS's guardians to the cards and lists the rest once", async () => {
    stub();
    render();

    const guardians = await screen.findByRole("region", { name: "Асран хамгаалагч" });
    expect(await within(guardians).findByText(/Цэцэгс майнинг · оператор/)).toBeInTheDocument();
    // ESIS has a second number for her, which this kindergarten does not.
    expect(within(guardians).getByText(/ЭСИС-д: 8800 1122/)).toBeInTheDocument();
    expect(
      within(guardians).getByText("ЭСИС-д бүртгэлтэй, системд холбогдоогүй (1)"),
    ).toBeInTheDocument();
    expect(within(guardians).getByText(/Дорж Ганбат/)).toBeInTheDocument();
    expect(within(guardians).getByText("9555 1234")).toBeInTheDocument();
    // The separate ESIS guardian table is gone.
    expect(screen.queryByText("ЭСИС дэх асран хамгаалагчид")).toBeNull();
  });

  /** The link opens every ESIS field in a dialog, from what the page already read. */
  it("opens every ESIS field in a dialog from the link at the foot", async () => {
    const user = userEvent.setup();
    const api = stub();
    render();

    const general = await screen.findByRole("region", { name: "Ерөнхий мэдээлэл" });
    await within(general).findByText("Боржигон");
    const before = api.calls.filter((call) => call.url.includes("/esis/resource")).length;

    await user.click(screen.getByRole("button", { name: /ЭСИС-ийн бүх талбарыг харах/ }));
    const dialog = await screen.findByRole("dialog", { name: "ЭСИС-ийн бүх мэдээлэл" });
    expect(within(dialog).getByText("Сурагчийн ерөнхий мэдээлэл")).toBeInTheDocument();
    expect((await within(dialog).findAllByText("Боржигон")).length).toBeGreaterThan(0);
    // Cached: opening the dialog asks ESIS nothing new.
    expect(api.calls.filter((call) => call.url.includes("/esis/resource")).length).toBe(before);
  });

  it("shows a guardian none of it", async () => {
    stub(["PARENT"]);
    render(false);

    await screen.findByRole("region", { name: "Ерөнхий мэдээлэл" });
    expect(screen.queryByText("Ургийн овог")).toBeNull();
    expect(screen.queryByRole("button", { name: /ЭСИС-ээс татах/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ЭСИС-ийн бүх талбарыг харах/ })).toBeNull();
  });
});
