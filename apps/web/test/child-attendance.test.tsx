import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChildAttendance } from "@/components/child/child-attendance";
import { renderWithProviders, stubApi } from "./support/render";

const CHILD = "11111111-1111-4111-8111-111111111111";
const RECORD = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const MEDIA = "44444444-4444-4444-8444-444444444444";

function record() {
  return {
    id: RECORD,
    childId: CHILD,
    date: "2026-09-07",
    status: "PRESENT",
    note: null,
    recordedBy: null,
    arrivedWith: "MOTHER",
    arrivedWithName: null,
    arrivedAt: "2026-09-07T00:17:00.000Z",
    pickedUpWith: null,
    pickedUpWithName: null,
    pickedUpAt: null,
  };
}

function requestWithAttachment() {
  return {
    id: REQUEST,
    childId: CHILD,
    dateFrom: "2026-09-08",
    dateTo: "2026-09-09",
    requestedStatus: "SICK",
    reason: "Халуурсан.",
    reviewStatus: "PENDING",
    reviewedBy: null,
    reviewedAt: null,
    requestedBy: null,
    createdAt: "2026-09-07T01:00:00.000Z",
    arrivedWith: null,
    arrivedWithName: null,
    arrivedAt: null,
    pickedUpWith: null,
    pickedUpWithName: null,
    pickedUpAt: null,
    attachment: {
      id: MEDIA,
      originalName: "эмчийн-бичиг.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    },
  };
}

function stubAttendance() {
  return stubApi([
    {
      path: `/children/${CHILD}/attendance/summary`,
      body: { PRESENT: 3, HALF_DAY: 0, ABSENT: 1, EXCUSED: 2, SICK: 1, OTHER: 0 },
    },
    { path: `/children/${CHILD}/attendance-requests`, method: "GET", body: [] },
    {
      path: `/children/${CHILD}/attendance-requests`,
      method: "POST",
      body: requestWithAttachment(),
    },
    { path: `/children/${CHILD}/attendance`, body: [record()] },
  ]);
}

describe("хүүхдийн ирцийн шинэ бүтэц", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-07T08:30:00+08:00"));
  });

  afterEach(() => vi.useRealTimers());

  it("shows today's actions, the real summary, chart and colour calendar", async () => {
    stubAttendance();
    renderWithProviders(
      <ChildAttendance childId={CHILD} isStaff={false} childFirstName="Батбаяр" />,
    );

    expect(await screen.findByRole("heading", { name: "Өнөөдрийн ирц" })).toBeInTheDocument();
    expect(screen.getByText(/2026 оны 9-р сарын 7 · Даваа/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ирлээ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Явлаа" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Чөлөө хүсэх" })).toBeInTheDocument();
    expect(screen.getByText("Ээж")).toBeInTheDocument();

    const summary = await screen.findByRole("region", { name: "Ирцийн нэгтгэл" });
    for (const label of ["Ирсэн", "Тасалсан", "Чөлөөтэй", "Өвчтэй"]) {
      expect(within(summary).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(summary).getByRole("img", { name: /Ирсэн 3 өдөр/ })).toBeInTheDocument();
    expect(within(summary).getByRole("img", { name: /7 — Ирсэн/ })).toBeInTheDocument();
  });

  it("submits leave dates, type, explanation and the selected medical document", async () => {
    const api = stubAttendance();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} />);

    await user.click(await screen.findByRole("button", { name: "Чөлөө хүсэх" }));
    const dialog = screen.getByRole("dialog", { name: "Чөлөөний хүсэлт" });
    expect(within(dialog).getByRole("combobox", { name: /Чөлөөний төрөл/ })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Эхлэх огноо/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Дуусах огноо/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Тайлбар")).toBeInTheDocument();

    const file = new File(["%PDF-test"], "эмчийн-бичиг.pdf", { type: "application/pdf" });
    await user.upload(within(dialog).getByLabelText("Эмчийн бичиг хавсаргах"), file);
    await user.type(within(dialog).getByLabelText("Тайлбар"), "Халуурсан.");
    await user.click(within(dialog).getByRole("button", { name: "Хүсэлт илгээх" }));

    expect(
      api.calls.some((call) => {
        if (call.method !== "POST" || !(call.body instanceof FormData)) return false;
        return call.body.get("reason") === "Халуурсан." && call.body.get("attachment") === file;
      }),
    ).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Чөлөөний хүсэлт" })).not.toBeInTheDocument(),
    );
  });
});
