import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChildGrowth } from "@/components/child/child-growth";
import { renderWithProviders, stubApi } from "./support/render";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";

const chart = {
  points: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      measuredOn: "2025-09-08",
      ageMonths: 52,
      ageYears: 52 / 12,
      heightCm: 104.1,
      weightKg: 16.8,
      headCircumferenceCm: null,
      note: "Жилийн эхний хэмжилт",
      recordedBy: null,
      heightChangeCm: null,
      weightChangeKg: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      measuredOn: "2026-03-10",
      ageMonths: 58,
      ageYears: 58 / 12,
      heightCm: 106.6,
      weightKg: 17.5,
      headCircumferenceCm: null,
      note: null,
      recordedBy: null,
      heightChangeCm: 2.5,
      weightChangeKg: 0.7,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      measuredOn: "2026-09-06",
      ageMonths: 64,
      ageYears: 64 / 12,
      heightCm: 108.4,
      weightKg: 18.2,
      headCircumferenceCm: null,
      note: "Улирлын хэмжилт",
      recordedBy: null,
      heightChangeCm: 1.8,
      weightChangeKg: 0.7,
    },
  ],
  reference: null,
};

function renderGrowth() {
  return renderWithProviders(
    <ChildGrowth
      childId={CHILD_ID}
      isStaff
      dateOfBirth="2021-04-12"
      currentSchoolYear="2026-2027"
    />,
  );
}

describe("seasonal child growth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /*
    ★ 2026-10-01: the latest measurement leads, and every measurement is one
    table, newest first — the current year's two seasons, then earlier years.
  */
  it("leads with the latest measurement and lists every one in a single table", async () => {
    stubApi([{ path: `/children/${CHILD_ID}/growth`, body: chart }]);
    renderGrowth();

    const latest = await screen.findByRole("region", { name: "Сүүлийн хэмжилт" });
    expect(within(latest).getByText("108.4 см")).toBeInTheDocument();
    expect(within(latest).getByText("+1.8 см өмнөхөөс")).toBeInTheDocument();
    expect(within(latest).getByText("18.2 кг")).toBeInTheDocument();
    expect(within(latest).getByText(/2026\.09\.06 хэмжсэн · 5 нас 4 сар/)).toBeInTheDocument();
    // No reference sent, so no band is claimed.
    expect(within(latest).queryByText(/мужид|мужаас/)).toBeNull();

    const table = screen.getByRole("table", { name: "Өсөлтийн бүх хэмжилт" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "2026–2027 хаврын хэмжилт",
      "2026–2027 намрын хэмжилт",
      "2025–2026 хаврын хэмжилт",
      "2025–2026 намрын хэмжилт",
    ]);
    expect(within(rows[0]!).getByText("Хүлээгдэж байна")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("108.4 см")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("+2.5 см · +0.7 кг")).toBeInTheDocument();
    // The two folds are gone.
    expect(screen.queryByText(/Өмнөх хичээлийн жилүүд/)).toBeNull();
  });

  /** The WHO ±2 SD band at the child's age, never a percentile, never a diagnosis. */
  it("says whether the latest figures sit inside the reference band", async () => {
    stubApi([
      {
        path: `/children/${CHILD_ID}/growth`,
        body: {
          ...chart,
          reference: {
            height: [
              { age: 5, median: 110, low: 100, high: 120 },
              { age: 6, median: 116, low: 106, high: 126 },
            ],
            weight: [
              { age: 5, median: 18, low: 19, high: 24 },
              { age: 6, median: 20, low: 20, high: 26 },
            ],
            source: {
              name: "ДЭМБ",
              version: "2006",
              publishedOn: "2006-04-27",
              url: "https://www.who.int/tools/child-growth-standards",
              disclaimer: "Эмнэлгийн онош биш.",
            },
          },
        },
      },
    ]);
    renderGrowth();

    const latest = await screen.findByRole("region", { name: "Сүүлийн хэмжилт" });
    expect(within(latest).getByText("Насны хэвийн мужид")).toBeInTheDocument();
    expect(within(latest).getByText("Насны мужаас доогуур")).toBeInTheDocument();
    expect(within(latest).getByText(/ДЭМБ-ын ±2 SD мужтай харьцуулсан/)).toBeInTheDocument();

    // ★ Phase 2: the chart, with the source and the "not a diagnosis" line
    // under it (RFP §7.2) — said once, there, rather than twice.
    const chartSection = screen.getByRole("region", { name: "Өсөлтийн график" });
    expect(
      within(chartSection).getByRole("group", { name: /Өндөр-ийн хугацааны график/ }),
    ).toBeInTheDocument();
    expect(
      within(chartSection).getByRole("group", { name: /Жин-ийн хугацааны график/ }),
    ).toBeInTheDocument();
    expect(within(chartSection).getByText(/ДЭМБ · 2006/)).toBeInTheDocument();
    expect(within(chartSection).getByText("Эмнэлгийн онош биш.")).toBeInTheDocument();
    expect(within(latest).queryByText(/Эмнэлгийн онош биш/)).toBeNull();
  });

  /** Without a reference (sex unknown) the chart says so rather than drawing a band. */
  it("draws the chart without a band when there is no reference", async () => {
    stubApi([{ path: `/children/${CHILD_ID}/growth`, body: chart }]);
    renderGrowth();

    const chartSection = await screen.findByRole("region", { name: "Өсөлтийн график" });
    expect(
      within(chartSection).getByRole("group", { name: /Өндөр-ийн хугацааны график/ }),
    ).toBeInTheDocument();
    expect(within(chartSection).getByText(/жишиг үзүүлэлт харуулаагүй/)).toBeInTheDocument();
    // The chart's own number table is off — the history table is below it.
    expect(within(chartSection).queryByText("Тоон утгыг харах")).toBeNull();
  });

  it("draws no chart before the first measurement", async () => {
    stubApi([{ path: `/children/${CHILD_ID}/growth`, body: { points: [], reference: null } }]);
    renderGrowth();

    expect(await screen.findByText("Хэмжилт бүртгэгдээгүй байна")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Өсөлтийн график" })).toBeNull();
  });

  it("opens an existing current-season measurement for editing", async () => {
    const user = userEvent.setup();
    stubApi([{ path: `/children/${CHILD_ID}/growth`, body: chart }]);
    renderGrowth();

    const autumn = await screen.findByRole("row", { name: "2026–2027 намрын хэмжилт" });
    await user.click(within(autumn).getByRole("button", { name: "Засах" }));

    const dialog = await screen.findByRole("dialog", { name: "Хэмжилт засах" });
    expect(within(dialog).getByLabelText("Хэмжсэн огноо *")).toHaveValue("2026-09-06");
    expect(within(dialog).getByLabelText("Өндөр (см)")).toHaveValue(108.4);
    expect(within(dialog).getByLabelText("Жин (кг)")).toHaveValue(18.2);
  });

  it("adds a measurement through the popup form and persists it", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: `/children/${CHILD_ID}/growth/`, method: "PUT", body: {} },
      { path: `/children/${CHILD_ID}/growth`, body: chart },
    ]);
    renderGrowth();

    await user.click(await screen.findByRole("button", { name: "Хэмжилт нэмэх" }));
    const dialog = await screen.findByRole("dialog", { name: "Хэмжилт нэмэх" });
    await user.type(within(dialog).getByLabelText("Өндөр (см)"), "109.2");
    await user.type(within(dialog).getByLabelText("Жин (кг)"), "18.6");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
        heightCm: 109.2,
        weightKg: 18.6,
        note: null,
      }),
    );
    expect(await screen.findByText("Хэмжилт нэмэгдлээ.")).toBeInTheDocument();
  });

  it("opens an earlier measurement's note read-only", async () => {
    const user = userEvent.setup();
    stubApi([{ path: `/children/${CHILD_ID}/growth`, body: chart }]);
    renderGrowth();

    const autumn = await screen.findByRole("row", { name: "2025–2026 намрын хэмжилт" });
    await user.click(within(autumn).getByRole("button", { name: "Тэмдэглэл" }));

    const dialog = await screen.findByRole("dialog", { name: "Хэмжилтийн дэлгэрэнгүй" });
    expect(within(dialog).getByText("2025.09.08")).toBeInTheDocument();
    expect(within(dialog).getByText("104.1 см")).toBeInTheDocument();
    expect(within(dialog).getByText("Жилийн эхний хэмжилт")).toBeInTheDocument();
  });

  it("accepts older API points that omit ageMonths", async () => {
    stubApi([
      {
        path: `/children/${CHILD_ID}/growth`,
        body: {
          ...chart,
          points: chart.points.map(({ ageMonths: _ageMonths, ...point }) => point),
        },
      },
    ]);
    renderGrowth();

    expect(await screen.findByRole("table", { name: "Өсөлтийн бүх хэмжилт" })).toBeInTheDocument();
    // The age is derived from `ageYears` alone: 64/12 years → "5 нас 4 сар".
    const table = screen.getByRole("table", { name: "Өсөлтийн бүх хэмжилт" });
    expect(within(table).getByText("5 нас 4 сар")).toBeInTheDocument();
  });
});
