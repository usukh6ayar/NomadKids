import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import ChildAccessPage from "@/app/(app)/children/[childId]/access/page";
import AdminServiceAccessPage from "@/app/(app)/admin/service-access/page";

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

    expect(await screen.findByText(/2026-2027 хичээлийн жил/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Сунгах" })).toBeNull();
    expect(screen.queryByText(/хоногийн дараа дуусна/)).toBeNull();
  });

  it("warns 14 days before the end and renews by the server's term or year price", async () => {
    const user = userEvent.setup();
    stubApi([{ path: `/children/${CHILD_ID}/access`, body: accessStatus(inDays(10)) }]);
    renderWithProviders(<ChildAccessPage />);

    expect(await screen.findByText("10 хоногийн дараа дуусна. Сунгана уу.")).toBeInTheDocument();
    expect(screen.getByText("27,000₮")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QPay-ээр төлөх" })).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Улирлаар" }));
    expect(screen.getByText("9,000₮")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QPay-ээр төлөх" })).toBeEnabled();
  });

  it("offers the year only when the server sells no term", async () => {
    stubApi([{ path: `/children/${CHILD_ID}/access`, body: accessStatus(inDays(10), null) }]);
    renderWithProviders(<ChildAccessPage />);

    expect(await screen.findByRole("radio", { name: "Улирлаар" })).toBeDisabled();
    expect(screen.getByText("27,000₮")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /QPay/ })).toBeNull();

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

  it("says the contract details are coming while the API does not answer", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN"]) }]);
    renderWithProviders(<AdminServiceAccessPage />);

    expect(
      await screen.findByText("Үйлчилгээний эрхийн мэдээлэл удахгүй харагдана."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Нэхэмжлэх үүсгэх" })).toBeDisabled();
  });
});
