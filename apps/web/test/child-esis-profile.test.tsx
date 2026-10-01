import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildDetail, EsisResourceKey } from "@kinder/contracts";
import { ChildEsisFields, ChildEsisProfile } from "@/components/child/child-esis";
import { EsisContactsWriteButton } from "@/components/esis/esis-write";
import { renderWithProviders, sessionFor } from "./support/render";

const KG = "33333333-3333-4333-8333-333333333333";
const PERSON = "90000000000001";

const child = {
  id: "44444444-4444-4444-8444-444444444444",
  kindergartenId: KG,
  lastName: "Ганболд",
  firstName: "Батбаяр",
  nationalId: "УБ12345678",
  sex: "MALE",
  dateOfBirth: "2021-04-12",
  status: "ACTIVE",
  isForeign: false,
  foreignId: null,
  healthNotes: null,
  photoMediaFileId: null,
  kindergarten: { id: KG, name: "Цэцэрлэг" },
  enrollments: [],
  guardianships: [],
} as unknown as ChildDetail;

const keys: EsisResourceKey[] = [
  "studentInfo",
  "studentCheck",
  "studentContacts",
  "studentContactsSave",
  "studentStatistics",
  "studentStatisticsSave",
  "studentCondition",
  "studentConditionSave",
];

function endpoint(key: EsisResourceKey) {
  return {
    key,
    apiId: null,
    slug: "UNLISTED",
    method: key.endsWith("Save") || key === "studentContacts" ? "POST" : "GET",
    path: `/svc/api/hub/v2/${key}`,
    name: key,
    domain: "ROSTER",
    usage: key,
    previewable: false,
    readable: !key.endsWith("Save"),
    params:
      key === "studentInfo"
        ? ["personRegNumber"]
        : ["studentCheck", "studentStatistics", "studentCondition"].includes(key)
          ? ["personId"]
          : [],
    fields: [],
    fieldSource: "ADAPTER",
    ingestedFieldCount: 0,
    sampleRow: {},
    sampleRows: [],
    accessStatus: "UNKNOWN",
    direction: key.endsWith("Save") ? "NOMADKIDS_TO_ESIS" : "ESIS_TO_NOMADKIDS",
    targetModel: "Child",
    mappings: [],
    responseMode: "LIVE",
    syncStatus: null,
    syncErrorCode: null,
    httpStatus: null,
    lastSyncAt: null,
  };
}

function resource(resource: EsisResourceKey, rows: Record<string, string | null>[]) {
  return {
    resource,
    source: "LIVE",
    status: "SUCCEEDED",
    errorCode: null,
    count: rows.length,
    durationMs: 20,
    fields: [],
    rows,
    response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: rows },
  };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("суралцагчийн нэгтгэсэн ESIS мэдээлэл", () => {
  it("uses the register lookup once, then reuses its personId for every child read", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const path = url.replace(/^.*\/v1/, "");
        calls.push(path);
        if (path === "/auth/me") return response(sessionFor(["ADMIN"]));
        if (path === `/kindergartens/${KG}/esis/catalog`) {
          return response({ mode: "LIVE", canRead: true, endpoints: keys.map(endpoint) });
        }
        const params = new URLSearchParams(path.split("?")[1]);
        const key = params.get("resource") as EsisResourceKey;
        if (key === "studentInfo") {
          return response(
            resource(key, [
              {
                personId: PERSON,
                familyName: "Боржигин",
                studentGroupName: "Наран бүлэг",
                academicYear: "2026-2027",
                programOfStudyName: "Сургуулийн өмнөх боловсрол",
              },
            ]),
          );
        }
        if (key === "studentCheck") {
          return response(
            resource(key, [
              { personId: PERSON, isRegistered: "true", statusName: "Суралцаж байгаа" },
            ]),
          );
        }
        if (key === "studentContacts") {
          return response(
            resource(key, [
              {
                personId: PERSON,
                contactId: "7001",
                relationTypeId: "1",
                relationTypeName: "Эх",
                lastName: "Дорж",
                firstName: "Сараа",
                phoneNumber: "99112233",
                address: "Баянзүрх дүүрэг",
                liveTogetherFlag: "true",
              },
              { personId: "999", firstName: "Өөр хүүхдийн асран хамгаалагч" },
            ]),
          );
        }
        if (key === "studentStatistics") {
          return response(
            resource(key, [
              { personId: PERSON, familyMemberCount: "4", familyTypeName: "Бүрэн өрх" },
            ]),
          );
        }
        return response(
          resource("studentCondition", [{ personId: PERSON, dwellingTypeName: "Орон сууц" }]),
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <ChildEsisProfile child={child}>
        <ChildEsisFields section="personal" />
        <ChildEsisFields section="education" />
        <ChildEsisFields section="guardian" />
      </ChildEsisProfile>,
    );
    await user.click(await screen.findByRole("button", { name: "ESIS-ээс татах" }));

    expect(await screen.findByText("Боржигин")).toBeInTheDocument();
    expect(screen.getByText("Сургуулийн өмнөх боловсрол")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ургийн овог")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Анги, бүлэг")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Бүртгэлийн төлөв")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ESIS-д бүртгэлтэй эсэх")).not.toBeInTheDocument();

    const reads = calls.filter((call) => call.includes("/esis/resource?"));
    expect(reads).toHaveLength(5);
    expect(reads[0]).toContain("resource=studentInfo");
    expect(reads[0]).toContain("personRegNumber=%D0%A3%D0%9112345678");
    for (const key of ["studentCheck", "studentStatistics", "studentCondition"]) {
      expect(reads.find((call) => call.includes(`resource=${key}`))).toContain(
        `personId=${PERSON}`,
      );
    }

    expect(screen.getByText("Баянзүрх дүүрэг")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Өөр хүүхдийн асран хамгаалагч")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Засах" })[0]!);
    expect(screen.getByLabelText("Ургийн овог")).toHaveValue("Боржигин");
  });

  it("includes every supported guardian field in the ESIS write form", async () => {
    let written: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const path = url.replace(/^.*\/v1/, "");
        if (path === "/auth/me") return response(sessionFor(["ADMIN"]));
        written = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response({
          resource: "studentContactsSave",
          source: "LIVE",
          status: "SUCCEEDED",
          errorCode: null,
          durationMs: 20,
          response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK" },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <EsisContactsWriteButton
        personId={PERSON}
        prefill={[
          {
            contactId: "7001",
            relationTypeId: "1",
            lastName: "Дорж",
            firstName: "Сараа",
            phoneNumber: "99112233",
            phoneNumber2: "88112233",
            email: "saraa@example.mn",
            address: "Баянзүрх дүүрэг",
            occupation: "Багш",
            workplace: "12-р сургууль",
            primaryFlag: true,
            liveTogetherFlag: true,
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "ЭСИС рүү илгээх" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Асран хамгаалагчийг ЭСИС рүү илгээх",
    });
    for (const label of [
      "ESIS холбоо барих дугаар",
      "Хамаарлын код",
      "Нэмэлт утас",
      "Хаяг",
      "Мэргэжил",
      "Ажлын газар",
      "Хүүхэдтэй хамт амьдардаг",
    ]) {
      expect(within(dialog).getByLabelText(new RegExp(label))).toBeInTheDocument();
    }
    expect(within(dialog).getByLabelText(/Нэмэлт утас/)).toHaveValue("88112233");
    expect(within(dialog).getByLabelText(/Ажлын газар/)).toHaveValue("12-р сургууль");

    await user.click(within(dialog).getByRole("button", { name: "Илгээх" }));
    await waitFor(() => expect(written).not.toBeNull());
    expect(written).toMatchObject({
      resource: "studentContactsSave",
      payload: {
        personId: Number(PERSON),
        contactList: [
          {
            contactId: 7001,
            relationTypeId: 1,
            phoneNumber2: "88112233",
            address: "Баянзүрх дүүрэг",
            occupation: "Багш",
            workplace: "12-р сургууль",
            liveTogetherFlag: true,
          },
        ],
      },
    });
  });
});
