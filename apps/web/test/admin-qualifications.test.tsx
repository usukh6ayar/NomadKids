import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import AdminQualificationsPage from "@/app/(app)/admin/qualifications/page";

const KG = "33333333-3333-4333-8333-333333333333";
const CATALOG_PATH = `/kindergartens/${KG}/esis/catalog`;
const READ_PATH = `/kindergartens/${KG}/esis/resource`;

const endpoint = (
  key: "degreeRequest" | "degreeDecisions" | "degreeHistory",
  apiId: number,
  params: string[],
) => ({
  key,
  apiId,
  slug: `API-${apiId}`,
  method: "GET" as const,
  path:
    key === "degreeRequest"
      ? "/svc/api/zereg/get/request/:registerNum"
      : `/svc/api/hub/v2/${key}`,
  name: key,
  domain: "ROSTER" as const,
  usage: "Мэргэшлийн зэргийн хүсэлт",
  previewable: false,
  readable: true,
  params,
  fields: [{ name: "requestId", label: "Хүсэлтийн дугаар", io: "OUTPUT" as const, ingested: true }],
  fieldSource: "ADAPTER" as const,
  ingestedFieldCount: 1,
  accessStatus: "UNKNOWN" as const,
  direction: "ESIS_TO_NOMADKIDS" as const,
  targetModel: "StaffRecord / ESIS qualification request",
  mappings: [],
  responseMode: "LIVE" as const,
  syncStatus: "PENDING" as const,
  syncErrorCode: null,
  httpStatus: null,
  lastSyncAt: null,
});

const catalog = {
  mode: "LIVE" as const,
  canRead: true,
  endpoints: [
    endpoint("degreeRequest", 119, ["registerNum"]),
    endpoint("degreeDecisions", 167, ["requestId"]),
    endpoint("degreeHistory", 170, ["requestId"]),
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("Мэргэшлийн зэрэг page", () => {
  it("gets requestId from API 119 only after the admin submits a register number", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog },
      {
        path: READ_PATH,
        body: {
          resource: "degreeRequest",
          endpoint: { method: "GET", path: "/svc/api/zereg/get/request/:registerNum" },
          source: "LIVE",
          status: "SUCCEEDED",
          errorCode: null,
          count: 1,
          durationMs: 8,
          fields: catalog.endpoints[0]!.fields,
          rows: [{ requestId: "7788" }],
          response: {
            SUCCESS_CODE: 200,
            RESPONSE_MESSAGE: "SUCCESS",
            RESULT: [{ requestId: "7788" }],
          },
        },
      },
    ]);

    renderWithProviders(<AdminQualificationsPage />);

    expect(await screen.findByRole("heading", { name: "Мэргэшлийн зэрэг" })).toBeInTheDocument();
    expect(screen.getByText(/API 119-д багшийн РД-г өгч/)).toBeInTheDocument();
    expect(api.calls.filter((call) => call.url.startsWith(READ_PATH))).toEqual([]);

    await user.type(await screen.findByLabelText("РД (регистрийн дугаар)"), "уб12345678");
    await user.click(screen.getByRole("button", { name: "Хүсэлтийн дугаар авах" }));

    await waitFor(() =>
      expect(api.calls.some((call) => call.url.startsWith(READ_PATH))).toBe(true),
    );
    expect(api.calls.find((call) => call.url.startsWith(READ_PATH))?.url).toContain(
      "resource=degreeRequest&registerNum=%D0%A3%D0%9112345678",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() =>
      expect(screen.getByLabelText("Хүсэлтийн дугаар авах").textContent).toContain("7788"),
    );
  });

  it("keeps decision, history, and the real-write warning on the dedicated page", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog },
    ]);

    renderWithProviders(<AdminQualificationsPage />);

    expect(await screen.findByRole("heading", { name: "Хүсэлтийн шийдвэрлэлт" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Хүсэлтийн түүх" })).toBeInTheDocument();
    expect(screen.getByText(/API 165 нь ESIS-д бодит хүсэлт хадгалдаг/)).toBeInTheDocument();
  });
});
