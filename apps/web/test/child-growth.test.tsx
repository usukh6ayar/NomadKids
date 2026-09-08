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

  it("groups real measurements into the current and previous academic years", async () => {
    stubApi([{ path: `/children/${CHILD_ID}/growth`, body: chart }]);
    renderGrowth();

    expect(await screen.findByRole("heading", { name: "Улирлын хэмжилт" })).toBeInTheDocument();
    expect(screen.getByText("Намар, хавар хоёр удаа бүртгэнэ")).toBeInTheDocument();

    const current = screen
      .getByText("2026–2027 хичээлийн жил")
      .closest<HTMLElement>("div.rounded-card")!;
    expect(within(current).getByText("1/2 бүртгэсэн")).toBeInTheDocument();
    expect(within(current).getByText("2026.09.06")).toBeInTheDocument();
    expect(within(current).getByText("108.4 см")).toBeInTheDocument();
    expect(within(current).getByText("18.2 кг")).toBeInTheDocument();
    expect(within(current).getByText("Хүлээгдэж байна")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Өмнөх хичээлийн жилүүд (1)" })).toBeInTheDocument();
    const previous = screen
      .getByText("2025–2026 хичээлийн жил")
      .closest<HTMLDetailsElement>("details")!;
    expect(previous).toHaveAttribute("open");
    expect(within(previous).getByText("2025.09.08")).toBeInTheDocument();
    expect(within(previous).getByText("2026.03.10")).toBeInTheDocument();
    expect(within(previous).getByText("Жилийн өөрчлөлт: +2.5 см · +0.7 кг")).toBeInTheDocument();
  });

  it("opens an existing current-season measurement for editing", async () => {
    const user = userEvent.setup();
    stubApi([{ path: `/children/${CHILD_ID}/growth`, body: chart }]);
    renderGrowth();

    const current = (await screen.findByText("2026–2027 хичээлийн жил")).closest<HTMLElement>(
      "div.rounded-card",
    )!;
    const autumn = within(current).getByLabelText("Намрын хэмжилт");
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

  it("opens a previous measurement as read-only detail", async () => {
    const user = userEvent.setup();
    stubApi([{ path: `/children/${CHILD_ID}/growth`, body: chart }]);
    renderGrowth();

    const previous = (
      await screen.findByText("2025–2026 хичээлийн жил")
    ).closest<HTMLDetailsElement>("details")!;
    await user.click(within(previous).getAllByRole("button", { name: "Харах" })[0]!);

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

    expect(await screen.findByText("2026–2027 хичээлийн жил")).toBeInTheDocument();
    expect(screen.getByText("5 нас")).toBeInTheDocument();
  });
});
