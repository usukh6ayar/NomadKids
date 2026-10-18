import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import ChildAccessPage from "@/app/(app)/children/[childId]/access/page";
import AdminServiceAccessPage from "@/app/(app)/admin/service-access/page";
import { receiptHtml } from "@/components/child/access-invoice";

/*
 * ★ «Үйлчилгээний эрх» — 2026-10-12, the user: the fee for using NomadKids,
 * kept apart from «Санхүү» (the kindergarten's invoices), for the family and
 * for the director, by term or by year at the price page's amounts, with a
 * warning 14 days before the end.
 */
const CHILD_ID = "11111111-1111-4111-8111-111111111111";

/**
 * A local calendar date `days` from today, as the API sends a date. Not
 * `toISOString()`: just after midnight in Ulaanbaatar the UTC date is still
 * yesterday, and every count came out a day short.
 */
function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function accessStatus(expiresAt: string, termAmount: string | null = "9000.00") {
  return {
    required: true,
    active: true,
    amount: "27000.00",
    termAmount,
    subscription: {
      id: "sub-1",
      status: "ACTIVE",
      amount: "27000.00",
      expiresAt,
      paidAt: "2026-09-02T00:00:00Z",
      schoolYear: { id: "sy-1", name: "2026-2027", endsOn: expiresAt },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the family's «Үйлчилгээний эрх»", () => {
  beforeEach(() => setParams({ childId: CHILD_ID }));

  it("shows until when, and offers no renewal while it is far off", async () => {
    stubApi([{ path: `/children/${CHILD_ID}/access`, body: accessStatus(inDays(120)) }]);
    renderWithProviders(<ChildAccessPage />);

    // The current card and the receipt both name the year.
    expect(await screen.findAllByText(/2026-2027 хичээлийн жил/)).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Сунгах" })).toBeNull();
    expect(screen.queryByText(/хоногийн дараа дуусна/)).toBeNull();
  });

  it("warns 14 days before the end and renews by the server's term or year price", async () => {
    const user = userEvent.setup();
    stubApi([{ path: `/children/${CHILD_ID}/access`, body: accessStatus(inDays(10)) }]);
    renderWithProviders(<ChildAccessPage />);

    expect(await screen.findByText("10 хоногийн дараа дуусна. Сунгана уу.")).toBeInTheDocument();
    const invoice = screen.getByRole("article", { name: "Нэхэмжлэх" });
    expect(within(invoice).getByText(/^27\s000₮$/)).toBeInTheDocument();
    expect(within(invoice).getByText("Хичээлийн жил")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QPay-ээр төлөх" })).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Улирлаар" }));
    expect(within(invoice).getByText(/^9\s000₮$/)).toBeInTheDocument();
    expect(within(invoice).getByText("Нэг улирал")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QPay-ээр төлөх" })).toBeEnabled();
  });

  /*
   * ★ 2026-10-15, the user: what was paid, as a receipt with a PDF — the
   * child, the number, the period and until when.
   */
  it("shows the paid period as a receipt, with a PDF", async () => {
    stubApi([
      { path: `/children/${CHILD_ID}/access`, body: accessStatus("2027-05-31") },
      {
        path: "/children/mine",
        body: [{ id: CHILD_ID, lastName: "Дорж", firstName: "Болд", dateOfBirth: "2021-04-12" }],
      },
    ]);
    renderWithProviders(<ChildAccessPage />);

    const receipt = await screen.findByRole("article", { name: "Төлбөрийн баримт" });
    expect(within(receipt).getByText("Төлөгдсөн")).toBeInTheDocument();
    expect(await within(receipt).findByText("Дорж Болд")).toBeInTheDocument();
    expect(within(receipt).getByText("SUB-1")).toBeInTheDocument();
    expect(within(receipt).getByText("2026-2027 хичээлийн жил")).toBeInTheDocument();
    expect(within(receipt).getByText("2027.05.31 хүртэл")).toBeInTheDocument();
    expect(within(receipt).getByText(/^27\s000₮$/)).toBeInTheDocument();
    expect(
      within(receipt).getByRole("button", { name: "Төлбөрийн баримт хэвлэх, PDF болгох" }),
    ).toBeInTheDocument();
  });

  it("offers the year only when the server sells no term", async () => {
    stubApi([{ path: `/children/${CHILD_ID}/access`, body: accessStatus(inDays(10), null) }]);
    renderWithProviders(<ChildAccessPage />);

    expect(await screen.findByRole("radio", { name: "Улирлаар" })).toBeDisabled();
    const invoice = screen.getByRole("article", { name: "Нэхэмжлэх" });
    expect(within(invoice).getByText(/^27\s000₮$/)).toBeInTheDocument();
    expect(screen.getByText("Одоогоор зөвхөн жилээр төлөх боломжтой.")).toBeInTheDocument();
  });
});

describe("the director's «Үйлчилгээний эрх»", () => {
  it("prices the renewal from the server and queues the invoice", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: "/service-access",
        body: {
          expiresAt: inDays(7),
          period: "term",
          groupCount: 4,
          termAmount: "48000.00",
          yearAmount: "144000.00",
        },
      },
    ]);
    renderWithProviders(<AdminServiceAccessPage />);

    expect(await screen.findByText("7 хоногийн дараа дуусна. Сунгана уу.")).toBeInTheDocument();
    expect(screen.getByText("48,000₮")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Жилээр — хямд" }));
    expect(screen.getByText("144,000₮")).toBeInTheDocument();

    const api = stubApi([
      {
        path: "/service-access/invoices",
        method: "POST",
        status: 201,
        body: { id: "job-1", status: "QUEUED", downloadable: false },
      },
      {
        path: "/service-access/invoices/job-1",
        body: { id: "job-1", status: "DONE", downloadable: true },
      },
    ]);
    await user.click(screen.getByRole("button", { name: "Нэхэмжлэх үүсгэх" }));
    expect(await screen.findByRole("button", { name: "Нэхэмжлэх татах" })).toBeEnabled();
    expect(
      api.calls.find((c) => c.method === "POST" && c.url === "/service-access/invoices")?.body,
    ).toEqual({ period: "year" });
  });

  /*
   * ★ №6 — a kindergarten pays its contract by QPay (the user, 2026-10-18):
   * the day it will run to is said before the QR, and paid, the page reads
   * the contract's new end back.
   */
  // The dialog polls every three seconds, as QPay's own check would be.
  it("renews by QPay, saying first until when", { timeout: 15_000 }, async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: "/service-access",
        body: {
          expiresAt: inDays(7),
          period: "year",
          groupCount: 3,
          termAmount: "18000.00",
          yearAmount: "90000.00",
          termCoversTo: "2026-11-30",
          yearCoversTo: "2027-05-31",
        },
      },
    ]);
    renderWithProviders(<AdminServiceAccessPage />);

    await user.click(await screen.findByRole("radio", { name: "Жилээр — хямд" }));
    expect(screen.getByText(/хүртэл\s+сунгагдана/).textContent).toContain("2027.05.31");

    const payment = {
      id: "88888888-8888-4888-8888-888888888888",
      coversTo: "2027-05-31",
      amount: "90000.00",
    };
    const attempt = {
      id: "77777777-7777-4777-8777-777777777777",
      amount: "90000.00",
      qrText: "qr",
      qrImage: null,
      expiresAt: null,
      paidAt: null,
    };
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: "/service-access/qpay",
        method: "POST",
        status: 201,
        body: {
          payment: { ...payment, status: "PENDING" },
          attempt: { ...attempt, status: "PENDING" },
        },
      },
      {
        path: "/service-access/qpay/88888888-8888-4888-8888-888888888888",
        body: {
          payment: { ...payment, status: "PAID" },
          attempt: { ...attempt, status: "PAID", paidAt: "2026-10-18T05:00:00.000Z" },
        },
      },
      {
        path: "/service-access",
        body: { expiresAt: "2027-05-31", period: "year", groupCount: 3, yearAmount: "90000.00" },
      },
    ]);
    await user.click(screen.getByRole("button", { name: /QPay-ээр төлөх/ }));

    expect(
      await screen.findByText("Төлбөр амжилттай хийгдлээ", {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(
      api.calls.find((c) => c.method === "POST" && c.url === "/service-access/qpay")?.body,
    ).toEqual({ period: "year" });
  });

  /*
   * ★ The user, 2026-10-18: from December «Жилээр» is what is left of the
   * school year, priced as terms — never called cheap, and named by its terms.
   */
  it("names the year's remainder by its terms, and never calls it cheap", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: "/service-access",
        body: {
          expiresAt: inDays(7),
          period: "term",
          groupCount: 2,
          termAmount: "24000.00",
          yearAmount: "48000.00",
          termCoversTo: "2027-02-28",
          yearCoversTo: "2027-05-31",
          termLabel: "II улирал (2026.12.01 – 2027.02.28)",
          yearLabel: "2026–2027 хичээлийн жил, II улирал, III улирал",
          yearWhole: false,
        },
      },
    ]);
    renderWithProviders(<AdminServiceAccessPage />);

    expect(
      await screen.findByText(/II улирал \(2026\.12\.01 – 2027\.02\.28\)/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Жилээр — хямд" })).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Жилээр" }));
    expect(screen.getByText(/2026–2027 хичээлийн жил, II улирал, III улирал/)).toBeInTheDocument();
    expect(screen.getByText("48,000₮")).toBeInTheDocument();
  });

  it("says the contract details are coming while the API does not answer", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN"]) }]);
    renderWithProviders(<AdminServiceAccessPage />);

    expect(
      await screen.findByText("Үйлчилгээний эрхийн мэдээлэл удахгүй харагдана."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Нэхэмжлэх үүсгэх" })).toBeDisabled();
  });
});

/*
 * ★ The PDF is the receipt's own page printed — asserted on its text
 * (CLAUDE.md §4.3), not on a file having been produced.
 */
describe("the access receipt's PDF", () => {
  it("prints the screen's lines, and escapes what it prints", () => {
    const html = receiptHtml("Төлбөрийн баримт", {
      state: "paid",
      childName: "Дорж <Болд>",
      period: "TERM",
      termNumber: 2,
      schoolYearName: "2026-2027",
      amount: "5000.00",
      number: "a1b2c3d4-0000",
      paidAt: "2026-11-02T10:15:00",
      expiresAt: "2027-02-28",
    });
    const text = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ");

    expect(text).toContain("Төлбөрийн баримт");
    expect(text).toContain("Дорж &lt;Болд&gt;");
    expect(text).toContain("A1B2C3D4");
    expect(text).toContain("2026-2027 хичээлийн жилийн II улирал");
    expect(text).toContain("2027.02.28 хүртэл");
    expect(text).toMatch(/5\s000₮/);
    expect(text).toContain("Төлөгдсөн");
    expect(html).not.toContain("<Болд>");
  });
});
