import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        reads.some((call) => call.url.includes("resource=degreeDecisions&requestId=7788")),
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

/*
 * ★ «Миний хүсэлт» and «Шинэ хүсэлт» — 2026-10-07, ready for the API the
 * backend is being asked for: GET and POST /me/qualification-requests.
 */
describe("the teacher's own requests", () => {
  const MINE = "/me/qualification-requests";
  const mineRow = (id: string, degree: string, status: string) => ({
    id,
    person: { firstName: "Сувдаа", lastName: "Дорж" },
    position: "Бүлгийн багш",
    degree,
    status,
    submittedAt: "2026-10-07T00:00:00.000Z",
    isMine: true,
  });

  function stubMine(items: unknown[] | null, post?: { status: number; body: unknown }) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: CATALOG_PATH, body: catalog },
      { path: READ_PATH, body: response("degreeRequest", []) },
      ...(post ? [{ path: MINE, method: "POST", status: post.status, body: post.body }] : []),
      items === null
        ? { path: MINE, status: 404, body: { title: "Not found", status: 404 } }
        : {
            path: MINE,
            body: { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 },
          },
    ]);
  }

  it("lists them by degree, open first, with the verdict beside each", async () => {
    stubMine([mineRow("a", "Заах аргач", "IN_REVIEW"), mineRow("b", "Тэргүүлэх", "APPROVED")]);
    renderWithProviders(<QualificationsPage />);

    const open = await screen.findByRole("region", { name: "Явцад" });
    expect(within(open).getByText("Заах аргач")).toBeInTheDocument();
    expect(within(open).getByText("Хянаж буй")).toBeInTheDocument();
    const done = screen.getByRole("region", { name: "Шийдвэрлэгдсэн" });
    expect(within(done).getByText("Тэргүүлэх")).toBeInTheDocument();
    expect(within(done).getByText("Шийдвэрлэсэн")).toBeInTheDocument();
  });

  it("sends a new request and reads the list again", async () => {
    const user = userEvent.setup();
    const api = stubMine([], { status: 201, body: mineRow("c", "Заах аргач", "NEW") });
    renderWithProviders(<QualificationsPage />);

    await user.click(await screen.findByRole("button", { name: /Шинэ хүсэлт/ }));
    const dialog = await screen.findByRole("dialog", { name: "Шинэ хүсэлт" });
    await user.type(within(dialog).getByLabelText(/Ажилласан жил/), "6");
    await user.type(within(dialog).getByLabelText("Тайлбар"), "Ахлах багшаар 2 жил");
    await user.click(within(dialog).getByRole("button", { name: "Илгээх" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST" && call.url === MINE)?.body).toEqual({
        degree: "Заах аргач",
        position: "Бүлгийн багш",
        yearsOfService: 6,
        note: "Ахлах багшаар 2 жил",
      }),
    );
    expect(await screen.findByText("Хүсэлт илгээгдлээ.")).toBeInTheDocument();
  });

  it("says the server is not ready while the endpoint answers 404", async () => {
    const user = userEvent.setup();
    stubMine(null, { status: 404, body: { title: "Not found", status: 404 } });
    renderWithProviders(<QualificationsPage />);

    expect(
      await screen.findByText("Хүсэлтийн сервер холболт хараахан бэлэн болоогүй байна."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Шинэ хүсэлт/ }));
    const dialog = await screen.findByRole("dialog", { name: "Шинэ хүсэлт" });
    await user.type(within(dialog).getByLabelText(/Ажилласан жил/), "3");
    await user.click(within(dialog).getByRole("button", { name: "Илгээх" }));

    // The dialog stays open with what was typed; a toast names the cause.
    expect(
      await screen.findAllByText("Хүсэлтийн сервер холболт хараахан бэлэн болоогүй байна."),
    ).toHaveLength(2);
    expect(screen.getByRole("dialog", { name: "Шинэ хүсэлт" })).toBeInTheDocument();
  });
});
