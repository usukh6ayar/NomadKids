import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import QualificationsPage from "@/app/(app)/qualifications/page";

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
  path: `/svc/api/${key}`,
  name: key,
  domain: "ROSTER" as const,
  usage: "Мэргэшлийн зэргийн хүсэлт",
  previewable: false,
  readable: true,
  params,
  fields: [{ name: "requestId", label: "Хүсэлтийн дугаар", io: "OUTPUT" as const, ingested: true }],
  fieldSource: "ADAPTER" as const,
  ingestedFieldCount: 1,
  direction: "ESIS_TO_NOMADKIDS" as const,
  targetModel: "StaffRecord / ESIS qualification request",
  mappings: [],
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

const response = (resource: string, rows: Record<string, string | null>[]) => ({
  resource,
  endpoint: { method: "GET" as const, path: `/svc/api/${resource}` },
  source: "LIVE" as const,
  status: "SUCCEEDED" as const,
  errorCode: null,
  count: rows.length,
  durationMs: 8,
  fields: [{ name: "requestId", label: "Хүсэлтийн дугаар", io: "OUTPUT" as const, ingested: true }],
  rows,
  response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "SUCCESS", RESULT: rows },
});

beforeEach(() => vi.clearAllMocks());

describe("teacher qualification page", () => {
  it("loads the signed-in teacher's request without sending a register number", async () => {
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: CATALOG_PATH, body: catalog },
      {
        path: `${READ_PATH}?resource=degreeDecisions&requestId=7788`,
        body: response("degreeDecisions", [{ requestId: "7788" }]),
      },
      {
        path: `${READ_PATH}?resource=degreeHistory&requestId=7788`,
        body: response("degreeHistory", [{ requestId: "7788" }]),
      },
      {
        path: `${READ_PATH}?resource=degreeRequest`,
        body: response("degreeRequest", [{ requestId: "7788" }]),
      },
    ]);

    renderWithProviders(<QualificationsPage />);

    expect(await screen.findByRole("heading", { name: "Мэргэшлийн зэрэг" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Хүсэлт №7788" })).toBeInTheDocument();
    expect(screen.queryByLabelText("РД (регистрийн дугаар)")).toBeNull();

    await waitFor(() => {
      const reads = api.calls.filter((call) => call.url.startsWith(READ_PATH));
      expect(reads.some((call) => call.url === `${READ_PATH}?resource=degreeRequest`)).toBe(true);
      expect(
        reads.some((call) =>
          call.url.includes("resource=degreeDecisions&requestId=7788"),
        ),
      ).toBe(true);
      expect(reads.every((call) => !call.url.includes("registerNum="))).toBe(true);
    });
  });

  it("shows an empty state when ESIS has no request for the teacher", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `${READ_PATH}?resource=degreeRequest`,
        body: response("degreeRequest", []),
      },
    ]);

    renderWithProviders(<QualificationsPage />);

    expect(await screen.findByText("Мэргэшлийн зэргийн хүсэлт алга")).toBeInTheDocument();
  });
});
