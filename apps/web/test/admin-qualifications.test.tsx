import { screen, waitFor, within } from "@testing-library/react";
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
    key === "degreeRequest" ? "/svc/api/zereg/get/request/:registerNum" : `/svc/api/hub/v2/${key}`,
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
    expect(api.calls.filter((call) => call.url.startsWith(READ_PATH))).toEqual([]);

    // Folded at the foot since 2026-10-07, under the request list.
    await user.click(screen.getByText("ЭСИС-ээс нэг хүсэлт шалгах"));

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

  it("keeps decision and history behind «ЭСИС-ээс нэг хүсэлт шалгах»", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog },
    ]);

    renderWithProviders(<AdminQualificationsPage />);

    await user.click(await screen.findByText("ЭСИС-ээс нэг хүсэлт шалгах"));
    expect(
      await screen.findByRole("heading", { name: "Хүсэлтийн шийдвэрлэлт" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Хүсэлтийн түүх" })).toBeInTheDocument();
  });

  /*
   * ★ The client's 2026-10-07 design, read from the list endpoint the backend
   * is being asked for — `GET /kindergartens/:id/qualification-requests`.
   */
  describe("the request list", () => {
    const LIST_PATH = `/kindergartens/${KG}/qualification-requests`;
    const YEAR = "44444444-4444-4444-8444-444444444444";
    const row = (
      id: string,
      firstName: string,
      lastName: string,
      status: string,
      isMine = false,
    ) => ({
      id,
      person: { firstName, lastName },
      position: "Бүлгийн багш",
      degree: "Заах аргач",
      status,
      submittedAt: "2026-10-07T00:00:00.000Z",
      isMine,
    });
    const ROWS = [
      row("r1", "Мөнхзол", "Чимэддорж", "NEW"),
      row("r2", "Энхсаруул", "Сүхбаатар", "NEW"),
      row("r3", "Галбадрах", "Гомбодорж", "APPROVED"),
      row("r4", "Сувдаа", "Дорж", "REJECTED", true),
    ];

    function stubList(items: unknown[] | null) {
      return stubApi([
        { path: "/auth/me", body: sessionFor(["ADMIN"]) },
        { path: CATALOG_PATH, body: catalog },
        {
          path: `/kindergartens/${KG}/school-years`,
          body: [{ id: YEAR, name: "2026-2027", isCurrent: true }],
        },
        items === null
          ? { path: LIST_PATH, status: 404, body: { title: "Not found", status: 404 } }
          : {
              path: LIST_PATH,
              body: { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 },
            },
      ]);
    }

    it("files open requests by status and counts the decided ones", async () => {
      const api = stubList(ROWS);
      renderWithProviders(<AdminQualificationsPage />);

      const fresh = await screen.findByRole("region", { name: "Шинэ" });
      expect(within(fresh).getByText("Чимэддорж Мөнхзол")).toBeInTheDocument();
      expect(within(fresh).getByText("Сүхбаатар Энхсаруул")).toBeInTheDocument();
      expect(within(fresh).getAllByText("Бүлгийн багш · Заах аргач")).toHaveLength(2);

      expect(screen.getByText("Нийт 2 хүсэлт")).toBeInTheDocument();
      expect(screen.getByText("Гомбодорж Галбадрах")).toBeInTheDocument();
      // The school year goes to the API as a filter.
      await waitFor(() =>
        expect(api.calls.find((call) => call.url.startsWith(LIST_PATH))?.url).toContain(
          `schoolYearId=${YEAR}`,
        ),
      );
    });

    it("shows the signed-in user's own requests under «Миний хүсэлт»", async () => {
      stubList(ROWS);
      renderWithProviders(<AdminQualificationsPage />);

      expect(await screen.findAllByText("Дорж Сувдаа")).toHaveLength(2);
      expect(screen.queryByText("Одоогоор хүсэлт байхгүй")).not.toBeInTheDocument();
    });

    it("narrows the open list by name", async () => {
      const user = userEvent.setup();
      stubList(ROWS);
      renderWithProviders(<AdminQualificationsPage />);

      await screen.findByRole("region", { name: "Шинэ" });
      await user.type(screen.getByPlaceholderText("Нэр, ажлын нэрээр хайх…"), "мөнх");
      const fresh = screen.getByRole("region", { name: "Шинэ" });
      expect(within(fresh).getByText("Чимэддорж Мөнхзол")).toBeInTheDocument();
      expect(within(fresh).queryByText("Сүхбаатар Энхсаруул")).not.toBeInTheDocument();
    });

    it("says the list is not wired yet while the endpoint answers 404", async () => {
      stubList(null);
      renderWithProviders(<AdminQualificationsPage />);

      expect(
        await screen.findByText(
          "Хүсэлтийн жагсаалтын сервер холболт хараахан бэлэн болоогүй байна.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Одоогоор хүсэлт байхгүй")).toBeInTheDocument();
      // «Шинэ хүсэлт» waits for API 165.
      expect(screen.getByRole("button", { name: /Шинэ хүсэлт/ })).toBeDisabled();
    });
  });
});
