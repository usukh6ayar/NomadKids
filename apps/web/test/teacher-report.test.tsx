import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import ReportsPage from "@/app/(app)/reports/page";

const KG_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const TERM_ID = "66666666-6666-4666-8666-666666666666";
const TYPE_DAILY = "77777777-7777-4777-8777-000000000001";
const TYPE_TALK = "77777777-7777-4777-8777-000000000002";
const DOMAIN_ID = "88888888-8888-4888-8888-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

const GROUPS = {
  items: [{ id: GROUP_ID, name: "Дэлбээ бүлэг", kindergartenId: KG_ID, childCount: 28 }],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
};

const REPORT = {
  range: { from: "2026-09-01", to: "2026-09-30" },
  group: { id: GROUP_ID, name: "Дэлбээ бүлэг" },
  children: 28,
  terms: [{ id: TERM_ID, name: "I улирал", number: 1 }],
  attendance: {
    recorded: 412,
    attended: 374,
    percent: 91,
    byStatus: [
      { status: "PRESENT", count: 360 },
      { status: "HALF_DAY", count: 14 },
      { status: "SICK", count: 24 },
      { status: "EXCUSED", count: 8 },
      { status: "ABSENT", count: 6 },
      { status: "OTHER", count: 0 },
    ],
    byDay: [
      { date: "2026-09-01", percent: 88 },
      { date: "2026-09-02", percent: 94 },
    ],
  },
  assessment: {
    assessed: 24,
    byDomain: [
      { id: DOMAIN_ID, name: "Хэл яриа", count: 18 },
      { id: "88888888-8888-4888-8888-000000000002", name: "Танин мэдэхүй", count: 15 },
    ],
  },
  observations: {
    total: 37,
    children: 21,
    byType: [
      { id: TYPE_DAILY, name: "Өдөр тутмын ажиглалт", code: "daily", count: 30 },
      { id: TYPE_TALK, name: "Ярилцлага", code: "conversation", count: 7 },
    ],
  },
  surveys: {
    total: 3,
    responded: 22,
    percent: 79,
    byKind: [
      { kind: "FORM", count: 2 },
      { kind: "POLL", count: 1 },
    ],
  },
};

function stub(report: Record<string, unknown> = REPORT) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/groups/${GROUP_ID}/report`, body: report },
    { path: "/groups", body: GROUPS },
    {
      path: `/kindergartens/${KG_ID}/terms`,
      body: [
        {
          id: TERM_ID,
          number: 1,
          name: "I улирал",
          startsOn: "2026-09-01",
          endsOn: "2026-12-31",
        },
      ],
    },
  ]);
}

/**
 * "Тайлан" — the teacher's report, rebuilt 2026-09-12 to the client's design.
 *
 * ★ What it replaced was one month of attendance and nothing else, which is
 * what the client asked to be rid of: "багшид байгаа тайлангийн мэдээллүүдийг
 * арилган шинийг оруул".
 */
describe("the teacher's report", () => {
  it("leads with the illustrated group dashboard and its six report figures", async () => {
    stub();
    renderWithProviders(<ReportsPage />);

    expect(await screen.findByRole("heading", { name: "Судалгааны мэдээлэл" })).toBeInTheDocument();
    expect(await screen.findByText("Нийт хүүхэд")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    // Each names its denominator — "24 / 28" says what is left to do.
    expect(screen.getByText("24 / 28")).toBeInTheDocument();
    expect(screen.getByText("22 / 28")).toBeInTheDocument();
    expect(screen.getByText("37")).toBeInTheDocument();
    const dashboard = screen.getByRole("region", { name: "Бүлгийн тайлангийн нэгтгэл" });
    expect(within(dashboard).getByText("Ярилцлага")).toBeInTheDocument();
    expect(within(dashboard).getByText("Бүтээлд дүн шинжилгээ")).toBeInTheDocument();
  });

  it("says how many assessments are still missing", async () => {
    stub();
    renderWithProviders(<ReportsPage />);

    expect(await screen.findByText("4 хүүхдийн үнэлгээ дутуу")).toBeInTheDocument();
  });

  /*
    ★ Сар · Улирал · Бүтэн жил — the client's three, and one range drives every
    figure below. A report whose attendance covers September and whose surveys
    cover the year is four reports in a trench coat.
  */
  it("asks the API for the term's dates when Улирал is chosen", async () => {
    const user = userEvent.setup();
    const { calls } = stub();
    renderWithProviders(<ReportsPage />);

    await screen.findByText("Нийт хүүхэд");
    await user.click(screen.getByRole("radio", { name: "Улирал" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("from=2026-09-01&to=2026-12-31"))).toBe(true),
    );
  });

  it("asks for a whole school year when Бүтэн жил is chosen", async () => {
    const user = userEvent.setup();
    const { calls } = stub();
    renderWithProviders(<ReportsPage />);

    await screen.findByText("Нийт хүүхэд");
    await user.click(screen.getByRole("radio", { name: "Бүтэн жил" }));

    await waitFor(() =>
      expect(calls.some((call) => /from=\d{4}-09-01&to=\d{4}-08-31/.test(call.url))).toBe(true),
    );
  });

  it("breaks the notes down by kind", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<ReportsPage />);

    await user.click(await screen.findByRole("tab", { name: "Ажиглалтын тайлан" }));
    const panel = screen.getByRole("tabpanel", { name: "Ажиглалтын тайлан" });

    expect(within(panel).getByText("Өдөр тутмын ажиглалт")).toBeInTheDocument();
    expect(within(panel).getByText("Ярилцлага")).toBeInTheDocument();
    expect(within(panel).getByText(/Нийт 37 тэмдэглэл/)).toBeInTheDocument();
  });

  it("counts the surveys and the polls apart", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<ReportsPage />);

    await user.click(await screen.findByRole("tab", { name: "Судалгааны тайлан" }));
    const panel = screen.getByRole("tabpanel", { name: "Судалгааны тайлан" });

    expect(within(panel).getByText("Судалгаа")).toBeInTheDocument();
    expect(within(panel).getByText("Асуулга")).toBeInTheDocument();
    expect(within(panel).getByText(/3 удаа авсан · 22 \/ 28 гэр бүл оролцсон/)).toBeInTheDocument();
  });

  /*
    ★ "No data" is not "0%".

    A month nobody marked attendance in has no percentage, and printing 0%
    would report a group that never turned up.
  */
  it("shows a dash rather than 0% when nothing was recorded", async () => {
    stub({
      ...REPORT,
      attendance: {
        recorded: 0,
        attended: 0,
        percent: null,
        byStatus: REPORT.attendance.byStatus.map((row) => ({ ...row, count: 0 })),
        byDay: [],
      },
    });
    renderWithProviders(<ReportsPage />);

    expect(await screen.findByText("Бүртгэл алга")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Энэ хугацаанд ирц бүртгээгүй байна")).toBeInTheDocument();
  });

  /** The screen this replaced was a month of attendance and a child list. */
  it("carries none of the old attendance-only report", async () => {
    stub();
    renderWithProviders(<ReportsPage />);

    await screen.findByText("Нийт хүүхэд");
    expect(screen.queryByText("Хүүхэд тус бүрээр")).not.toBeInTheDocument();
  });
});
