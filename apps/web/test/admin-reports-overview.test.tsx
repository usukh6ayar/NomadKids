import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupReport } from "@kinder/contracts";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
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

function renderAdminReport() {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
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

  return renderWithProviders(<ReportsPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("the administrator report", () => {
  it("shows a kindergarten-wide summary instead of a group picker", async () => {
    renderAdminReport();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Цэцэрлэгийн нэгдсэн тайлан" }),
    ).toBeInTheDocument();
    const summary = await screen.findByRole("region", { name: "Тайлангийн товч үзүүлэлт" });

    for (const label of [
      "Нийт хүүхэд",
      "Нийт бүлэг",
      "Ирц",
      "Явцын үнэлгээ",
      "Судалгааны явц",
    ]) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    }
    expect(within(summary).getByText("49")).toBeInTheDocument();
    expect(within(summary).getByText("2")).toBeInTheDocument();
    expect(within(summary).getByText("91%")).toBeInTheDocument();
    expect(within(summary).getByText("90%")).toBeInTheDocument();
    expect(within(summary).getByText("67%")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Бүлэг сонгох" })).toBeNull();
  });

  it("keeps only the two group-comparison charts below the summary", async () => {
    renderAdminReport();

    expect(await screen.findByRole("heading", { name: "Бүлгүүдийн харьцуулалт" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ирцийн хувь (бүлэг тус бүр)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Явцын үнэлгээний гүйцэтгэл" })).toBeInTheDocument();
    expect(screen.getByLabelText("Дэлбээ бүлгийн ирц: 95%")).toBeInTheDocument();
    expect(screen.getByLabelText("Нархан бүлгийн явцын үнэлгээ: 80%")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Бүлгүүдийн нэгдсэн тайлан" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Сарын онцлох үзүүлэлт" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Анхаарах зүйл" })).toBeNull();
  });

  it("uses a single month selector", async () => {
    renderAdminReport();

    await screen.findByRole("heading", { name: "Цэцэрлэгийн нэгдсэн тайлан" });
    expect(screen.getByLabelText("Тайлангийн сар")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Тайлангийн хугацаа" })).toBeNull();
  });
});
