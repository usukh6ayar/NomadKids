import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupReport } from "@kinder/contracts";
import {
  ROUTER,
  renderWithProviders,
  selectOption,
  sessionFor,
  setSearchParams,
  stubApi,
} from "./support/render";
import ReportsPage from "@/app/(app)/reports/page";

const KG = "33333333-3333-4333-8333-333333333333";
const FIRST_GROUP = "44444444-4444-4444-8444-444444444441";
const SECOND_GROUP = "44444444-4444-4444-8444-444444444442";
const TERM = "55555555-5555-4555-8555-555555555555";
const LANGUAGE = "66666666-6666-4666-8666-666666666661";
const COGNITIVE = "66666666-6666-4666-8666-666666666662";

function report(
  group: { id: string; name: string },
  values: {
    children: number;
    assessed: number;
    attended: number;
    recorded: number;
    observations: number;
    observedChildren: number;
    responded: number;
    language: number;
    cognitive: number;
    days: number[];
  },
): GroupReport {
  return {
    range: { from: "2026-09-01", to: "2026-09-30" },
    group,
    children: values.children,
    terms: [{ id: TERM, number: 1, name: "I улирал" }],
    attendance: {
      recorded: values.recorded,
      attended: values.attended,
      percent: Math.round((values.attended / values.recorded) * 100),
      byStatus: [],
      byDay: values.days.map((value, index) => ({
        date: `2026-09-0${index + 1}`,
        percent: value,
      })),
    },
    assessment: {
      assessed: values.assessed,
      byDomain: [
        { id: LANGUAGE, name: "Хэл яриа", count: values.language },
        { id: COGNITIVE, name: "Танин мэдэхүй", count: values.cognitive },
      ],
    },
    observations: {
      total: values.observations,
      children: values.observedChildren,
      byType: [],
    },
    surveys: {
      total: 2,
      responded: values.responded,
      percent: Math.round((values.responded / values.children) * 100),
      byKind: [],
    },
  };
}

const FIRST_REPORT = report(
  { id: FIRST_GROUP, name: "Дэлбээ" },
  {
    children: 24,
    assessed: 24,
    attended: 400,
    recorded: 420,
    observations: 30,
    observedChildren: 20,
    responded: 18,
    language: 24,
    cognitive: 20,
    days: [88, 92, 94],
  },
);

const SECOND_REPORT = report(
  { id: SECOND_GROUP, name: "Нархан" },
  {
    children: 25,
    assessed: 20,
    attended: 350,
    recorded: 400,
    observations: 22,
    observedChildren: 15,
    responded: 15,
    language: 20,
    cognitive: 15,
    days: [82, 86, 90],
  },
);

const FIRST_A79 = {
  children: [
    {
      childId: "77777777-7777-4777-8777-777777777771",
      firstName: "Ану",
      lastName: "Батжаргал",
      level: "III",
      achieved: 37,
      total: 46,
      byDomain: [
        { domain: "Мэдлэг", achieved: 8, total: 10 },
        { domain: "Чадвар", achieved: 20, total: 25 },
        { domain: "Төлөвшил", achieved: 9, total: 11 },
      ],
    },
    {
      childId: "77777777-7777-4777-8777-777777777772",
      firstName: "Тэмүүлэн",
      lastName: "Дорж",
      level: "III",
      achieved: 23,
      total: 46,
      byDomain: [
        { domain: "Мэдлэг", achieved: 5, total: 10 },
        { domain: "Чадвар", achieved: 12, total: 25 },
        { domain: "Төлөвшил", achieved: 6, total: 11 },
      ],
    },
  ],
};

const SECOND_A79 = {
  children: [
    {
      childId: "77777777-7777-4777-8777-777777777773",
      firstName: "Сарнай",
      lastName: "Эрдэнэ",
      level: "II",
      achieved: 9,
      total: 46,
      byDomain: [
        { domain: "Мэдлэг", achieved: 2, total: 10 },
        { domain: "Чадвар", achieved: 5, total: 25 },
        { domain: "Төлөвшил", achieved: 2, total: 11 },
      ],
    },
  ],
};

const NOT_FOUND = { status: 404, body: { title: "Not found", status: 404 } };

function renderAdminReport({ a79NotReady = false } = {}) {
  const api = stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    a79NotReady
      ? { path: `/groups/${FIRST_GROUP}/a79-summary`, ...NOT_FOUND }
      : { path: `/groups/${FIRST_GROUP}/a79-summary`, body: FIRST_A79 },
    a79NotReady
      ? { path: `/groups/${SECOND_GROUP}/a79-summary`, ...NOT_FOUND }
      : { path: `/groups/${SECOND_GROUP}/a79-summary`, body: SECOND_A79 },
    { path: `/groups/${FIRST_GROUP}/report`, body: FIRST_REPORT },
    { path: `/groups/${SECOND_GROUP}/report`, body: SECOND_REPORT },
    {
      path: "/groups",
      body: {
        items: [
          { id: FIRST_GROUP, name: "Дэлбээ", kindergartenId: KG, childCount: 24 },
          { id: SECOND_GROUP, name: "Нархан", kindergartenId: KG, childCount: 25 },
        ],
        page: 1,
        pageSize: 100,
        total: 2,
        totalPages: 1,
      },
    },
    {
      path: `/kindergartens/${KG}/terms`,
      body: [
        {
          id: TERM,
          number: 1,
          name: "I улирал",
          startsOn: "2026-09-01",
          endsOn: "2026-12-31",
        },
      ],
    },
  ]);

  renderWithProviders(<ReportsPage />);
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("the administrator report", () => {
  /*
    ★ The same screen a teacher sees — client, 2026-10-08: the kindergarten-wide
    overview was taken away ("буцаагаад багшийнх шиг болгоод өг").
  */
  it("is the teacher's report, with a group picker", async () => {
    renderAdminReport();

    expect(await screen.findByRole("heading", { level: 1, name: "Тайлан" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Цэцэрлэгийн нэгдсэн тайлан" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Хугацаа" })).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Нэгтгэл" })).toBeInTheDocument();
    expect(screen.getAllByText("Дэлбээ").length).toBeGreaterThan(0);
    // The group is a dropdown after the dates — 2026-10-08, the client.
    const user = userEvent.setup();
    await selectOption(user, "Бүлэг", "Нархан");
    expect(ROUTER.push).toHaveBeenCalledWith(`/reports?group=${SECOND_GROUP}`);
  });

  it("opens the group named in the address", async () => {
    setSearchParams(`group=${SECOND_GROUP}`);
    const api = renderAdminReport();

    await screen.findByRole("tab", { name: "Нэгтгэл" });
    expect(api.calls.some((call) => call.url.startsWith(`/groups/${SECOND_GROUP}/report`))).toBe(
      true,
    );
  });

  it("shows the kindergarten result chart with every group's indicators below", async () => {
    const user = userEvent.setup();
    const api = renderAdminReport();

    await user.click(await screen.findByRole("tab", { name: "Үр дүнгийн үнэлгээ" }));
    const panel = screen.getByRole("tabpanel", { name: "Үр дүнгийн үнэлгээ" });

    expect(
      within(panel).getByRole("heading", { name: "Цэцэрлэгийн нэгтгэл график" }),
    ).toBeInTheDocument();
    // Child-weighted: (80 + 50 + 20) / 3 = 50%, not the two group averages' 43%.
    expect(within(panel).getByRole("img", { name: "Цэцэрлэгийн дундаж: 50%" })).toBeInTheDocument();
    expect(within(panel).getByText("Хангалттай · 1")).toBeInTheDocument();
    expect(within(panel).getByText("Ахиж байна · 1")).toBeInTheDocument();
    expect(within(panel).getByText("Хөгжиж байна · 1")).toBeInTheDocument();

    const table = within(panel).getByRole("table", { name: "Бүлэг бүрийн үзүүлэлт" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["№", "Бүлэг", "Хүүхэд", "Мэдлэг", "Чадвар", "Төлөвшил", "Нийт", "Үр дүн"]);

    const first = within(table).getByRole("link", { name: "Дэлбээ" });
    expect(first).toHaveAttribute("href", `/groups/${FIRST_GROUP}/results`);
    expect(
      within(first.closest("tr")!)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["1", "Дэлбээ", "2", "65%", "64%", "69%", "65%", "Ахиж байна"]);

    const second = within(table).getByRole("link", { name: "Нархан" });
    expect(second).toHaveAttribute("href", `/groups/${SECOND_GROUP}/results`);
    expect(second.closest("tr")).toHaveTextContent("20%");

    for (const id of [FIRST_GROUP, SECOND_GROUP]) {
      expect(
        api.calls.some(
          (call) => call.url === `/groups/${id}/a79-summary?from=2026-09-01&to=2026-09-30`,
        ),
      ).toBe(true);
    }
  });

  // ★ No invented figures while the endpoint answers 404 — 2026-10-08.
  it("says there is no result yet, and draws no chart, while the groups' endpoint answers 404", async () => {
    const user = userEvent.setup();
    renderAdminReport({ a79NotReady: true });

    await user.click(await screen.findByRole("tab", { name: "Үр дүнгийн үнэлгээ" }));
    const panel = screen.getByRole("tabpanel", { name: "Үр дүнгийн үнэлгээ" });

    expect(await within(panel).findByText("Үр дүн хараахан гараагүй байна")).toBeInTheDocument();
    expect(within(panel).queryByText(/Жишээ/)).toBeNull();
    expect(within(panel).queryByRole("table")).toBeNull();
    expect(within(panel).queryByRole("img")).toBeNull();
  });
});
