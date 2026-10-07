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

  /** Client, 2026-10-06: no glyphs; a ✓ before a word once that step is done. */
  it("marks a done step with a ✓ before its word", async () => {
    stubApi([
      { path: `/children/${CHILD}/attendance/summary`, body: {} },
      {
        path: `/children/${CHILD}/attendance-requests`,
        method: "GET",
        body: [{ ...requestWithAttachment(), dateFrom: "2026-09-07", dateTo: "2026-09-07" }],
      },
      { path: `/children/${CHILD}/attendance`, body: [record()] },
    ]);
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Батбаяр" />);

    const check = (name: RegExp) =>
      screen.getByRole("button", { name }).querySelector("svg.lucide-check");
    await screen.findByRole("button", { name: /Ирлээ/ });
    // Arrived (the record has a drop-off), not yet collected, leave asked for today.
    expect(check(/Ирлээ/)).not.toBeNull();
    expect(check(/Явлаа/)).toBeNull();
    expect(check(/Чөлөө хүсэх/)).not.toBeNull();
  });

  it("shows today's actions, the real summary, chart and colour calendar", async () => {
    stubAttendance();
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Батбаяр" />);

    expect(await screen.findByRole("heading", { name: "Өнөөдрийн ирц" })).toBeInTheDocument();
    expect(screen.getByText(/2026 оны 9-р сарын 7 · Даваа/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ирлээ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Явлаа" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Чөлөө хүсэх" })).toBeInTheDocument();
    /*
      The companion used to be read off the "Сүүлийн бүртгэл" footer, which was
      removed on 2026-09-12 at the client's request. The sentence is where a
      family reads it now, and it says more than the cell did.
    */
    expect(screen.getByText(/Батбаяр ээжтэйгээ .* цэцэрлэгтээ ирлээ\./)).toBeInTheDocument();
    expect(screen.queryByText("Сүүлийн бүртгэл")).not.toBeInTheDocument();

    // Three tabs, «Гараас гарт» first and open.
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Гараас гарт", "Ирцийн нэгтгэл", "Календар"]);
    expect(screen.getByRole("tab", { name: "Гараас гарт" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Ирцийн нэгтгэл" }));
    const summary = screen.getByRole("tabpanel", { name: "Ирцийн нэгтгэл" });
    for (const label of ["Ирсэн", "Тасалсан", "Чөлөөтэй", "Өвчтэй"]) {
      expect((await within(summary).findAllByText(label)).length).toBeGreaterThan(0);
    }
    expect(within(summary).getByRole("img", { name: /Ирсэн 3 өдөр/ })).toBeInTheDocument();
    // Only the chosen one is on screen.
    expect(within(summary).queryByRole("img", { name: /7 — Ирсэн/ })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Календар" }));
    const calendar = screen.getByRole("tabpanel", { name: "Календар" });
    // Open, not folded behind a toggle.
    expect(await within(calendar).findByRole("img", { name: /7 — Ирсэн/ })).toBeVisible();
    expect(within(calendar).queryByRole("button", { name: /Календарь/ })).toBeNull();
    // The tab names the panel; no section header (and its accent bar) inside.
    expect(document.querySelector('[data-ui="section-header"]')).toBeNull();
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

  /*
    ★ Three across on a phone — 2026-09-12, at the client's request.

    They were one column below `sm`: three full-width buttons stacked down the
    screen, pushing the month's calendar under the fold.

    Asserted on the class, the way `responsive.test.tsx` does — jsdom has no
    layout engine, so nothing here can measure a row. What it defends is the
    `sm:` prefix creeping back onto `grid-cols-3`.
  */
  it("puts the three actions in one row on a phone", async () => {
    stubAttendance();
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Батбаяр" />);

    const arrive = await screen.findByRole("button", { name: /Ирлээ/ });
    const row = arrive.closest("div")!;
    expect(row.className).toContain("grid-cols-3");
    expect(row.className).not.toContain("sm:grid-cols-3");

    // ★ Words only since 2026-10-06 — no glyph on any of the three; a ✓
    // appears before a word only once that step is done.
    for (const label of [/Ирлээ/, /Явлаа/, /Чөлөө хүсэх/]) {
      const glyphs = [...screen.getByRole("button", { name: label }).querySelectorAll("svg")];
      expect(glyphs.every((svg) => svg.classList.contains("lucide-check"))).toBe(true);
    }
  });
});

/*
  ★ 2026-09-12, three client notes about this one card.

  "Ирлээ гэдэг дээр дарахаар … 2026. 9. 11-нд 10:23 минутад цэцэрлэгтээ ирлээ гэж
  өгүүлбэрээр харагд", "бямба ням гарагт ирлээ явлаа чөлөөний хүснэгтийг ажиллуул
  болохгүй", and "хүсэлтийн түүхийг сар болон өдрөөр харахад хялбар минимал
  болгоод өг".
*/
describe("эцэг эхийн өнөөдрийн ирц", () => {
  const ARRIVAL = "55555555-5555-4555-8555-555555555555";
  const PICKUP = "66666666-6666-4666-8666-666666666666";

  function presentRequest(id: string, half: "arrival" | "pickup") {
    return {
      ...requestWithAttachment(),
      id,
      dateFrom: "2026-09-07",
      dateTo: "2026-09-07",
      requestedStatus: "PRESENT",
      reason: null,
      reviewStatus: "APPROVED",
      attachment: null,
      ...(half === "arrival"
        ? { arrivedWith: "MOTHER", arrivedAt: "2026-09-07T00:23:00.000Z" }
        : { pickedUpWith: "FATHER", pickedUpAt: "2026-09-07T08:23:00.000Z" }),
    };
  }

  /** No register row for today, so the three buttons are live. */
  function stubEmptyDay(requests: unknown[] = []) {
    return stubApi([
      {
        path: `/children/${CHILD}/attendance/summary`,
        body: { PRESENT: 0, HALF_DAY: 0, ABSENT: 0, EXCUSED: 0, SICK: 0, OTHER: 0 },
      },
      { path: `/children/${CHILD}/attendance-requests`, method: "GET", body: requests },
      {
        path: `/children/${CHILD}/attendance-requests`,
        method: "POST",
        body: presentRequest(ARRIVAL, "arrival"),
      },
      { path: `/children/${CHILD}/attendance`, body: [] },
    ]);
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-07T08:30:00+08:00"));
  });

  afterEach(() => vi.useRealTimers());

  it("★ writes the whole sentence — child, companion, date and minute", async () => {
    stubEmptyDay();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Б.Бат" />);

    await user.click(await screen.findByRole("button", { name: /Ирлээ/ }));
    const dialog = screen.getByRole("dialog", { name: "Ирц мэдэгдэх" });

    expect(
      within(dialog).getByText(
        /Б\.Бат ээжтэйгээ 2026 оны 9-р сарын 7-нд \d\d:\d\d минутад цэцэрлэгтээ ирлээ\./,
      ),
    ).toBeInTheDocument();

    // The companion is part of the sentence, so changing it rewrites the line.
    await user.click(within(dialog).getByRole("radio", { name: "Аав" }));
    expect(within(dialog).getByText(/Б\.Бат аавтайгаа .* цэцэрлэгтээ ирлээ\./)).toBeInTheDocument();
  });

  it("says the child left, not arrived, in the pickup dialog", async () => {
    stubEmptyDay([presentRequest(ARRIVAL, "arrival")]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Б.Бат" />);

    await user.click(await screen.findByRole("button", { name: /Явлаа/ }));
    const dialog = screen.getByRole("dialog", { name: "Гарсныг мэдэгдэх" });
    expect(within(dialog).getByText(/Б\.Бат ээжтэйгээ .* цэцэрлэгээс явлаа\./)).toBeInTheDocument();
  });

  it("★ closes all three on a Saturday — the kindergarten is shut", async () => {
    vi.setSystemTime(new Date("2026-09-12T09:00:00+08:00"));
    stubEmptyDay();
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Б.Бат" />);

    for (const label of [/Ирлээ/, /Явлаа/, /Чөлөө хүсэх/]) {
      expect(await screen.findByRole("button", { name: label })).toBeDisabled();
    }
  });

  it("leaves them open on a weekday", async () => {
    stubEmptyDay();
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Б.Бат" />);

    expect(await screen.findByRole("button", { name: /Ирлээ/ })).toBeEnabled();
  });

  /*
    ★ 2026-09-12: "Ирлээ Явлаа Чөлөө хүсэх товчны доор [өгүүлбэр]."

    Asserted on document order rather than on a class, since that is the whole
    of what was asked — the line used to sit between the date and the row.
  */
  it("puts the sentence under the three buttons", async () => {
    stubEmptyDay([presentRequest(ARRIVAL, "arrival")]);
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Б.Бат" />);

    const row = (await screen.findByRole("button", { name: /Ирлээ/ })).closest("div")!;
    const sentence = screen.getByText(/цэцэрлэгтээ ирлээ\./);

    expect(row.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /*
    ★ "Г.Батбаяр эмээ-тай … цэцэрлэгээс явлаа" — the hyphen the client sent back
    on 2026-09-12. A free-text companion is inflected by vowel harmony now.
  */
  it("inflects a free-text companion instead of hyphenating it", async () => {
    stubEmptyDay();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Б.Бат" />);

    await user.click(await screen.findByRole("button", { name: /Ирлээ/ }));
    const dialog = screen.getByRole("dialog", { name: "Ирц мэдэгдэх" });
    await user.click(within(dialog).getByRole("radio", { name: "Бусад" }));
    await user.type(within(dialog).getByLabelText("Хэн бэ?"), "эмээ");

    expect(within(dialog).getByText(/Б\.Бат эмээтэй .* цэцэрлэгтээ ирлээ\./)).toBeInTheDocument();
    expect(within(dialog).queryByText(/эмээ-тай/)).not.toBeInTheDocument();
  });

  /**
   * ★ «Гараас гарт», not «Хүсэлтийн түүх» — client, 2026-10-06: the week a
   * line a day, arrival and pickup with their companions, and a day off by its
   * name. Monday 7 September is "today" here.
   */
  it("★ «Гараас гарт»: a line a day, the arrival and the pickup side by side", async () => {
    stubEmptyDay([
      presentRequest(ARRIVAL, "arrival"),
      presentRequest(PICKUP, "pickup"),
      requestWithAttachment(),
    ]);
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Б.Бат" />);

    const section = await screen.findByRole("tabpanel", { name: "Гараас гарт" });
    expect(screen.queryByRole("region", { name: "Хүсэлтийн түүх" })).toBeNull();
    const rows = within(within(section).getByRole("table")).getAllByRole("row").slice(1);
    // Monday to Friday.
    expect(rows).toHaveLength(5);

    // The 7th: the family's own drop-off and pickup, two requests on one line.
    expect(rows[0]).toHaveTextContent(/Да 9\.7.*Ээж.*Аав/);
    // The 8th and 9th: the sick leave they asked for, still awaiting the teacher.
    expect(rows[1]).toHaveTextContent("Өвчтэй · хүлээгдэж буй");
    expect(rows[2]).toHaveTextContent("Өвчтэй · хүлээгдэж буй");
    // Still to come.
    expect(rows[4]).toHaveTextContent("—");
  });

  it("names a recorded day off «Чөлөө»", async () => {
    stubApi([
      { path: `/children/${CHILD}/attendance/summary`, body: {} },
      { path: `/children/${CHILD}/attendance-requests`, method: "GET", body: [] },
      { path: `/children/${CHILD}/attendance`, body: [{ ...record(), status: "EXCUSED" }] },
    ]);
    renderWithProviders(<ChildAttendance childId={CHILD} isStaff={false} childName="Б.Бат" />);

    const section = await screen.findByRole("tabpanel", { name: "Гараас гарт" });
    const first = (await within(section).findAllByRole("row"))[1]!;
    expect(first).toHaveTextContent(/Да 9\.7\s*Чөлөө$/);
  });
});
