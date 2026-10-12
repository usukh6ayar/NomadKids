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

function accessStatus(expiresAt: string) {
  return {
    required: true,
    active: true,
    amount: "22000.00",
    subscription: {
      id: "sub-1",
      status: "ACTIVE",
      amount: "22000.00",
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

  it("warns 14 days before the end and renews by year; a term is not payable yet", async () => {
    const user = userEvent.setup();
    stubApi([{ path: `/children/${CHILD_ID}/access`, body: accessStatus(inDays(10)) }]);
    renderWithProviders(<ChildAccessPage />);

    expect(await screen.findByText("10 хоногийн дараа дуусна. Сунгана уу.")).toBeInTheDocument();
    expect(screen.getByText("27,000₮")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QPay-ээр төлөх" })).toBeEnabled();

    await user.click(screen.getByRole("radio", { name: "Улирлаар" }));
    expect(screen.getByText("9,000₮")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QPay-ээр төлөх" })).toBeDisabled();
    expect(screen.getByText("Улирлаар төлөх боломж удахгүй нээгдэнэ.")).toBeInTheDocument();
  });
});

describe("the director's «Үйлчилгээний эрх»", () => {
  it("prices the renewal by the group count, and links the invoice", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: "/service-access",
        body: { expiresAt: inDays(7), period: "term", groupCount: 4 },
      },
    ]);
    renderWithProviders(<AdminServiceAccessPage />);

    expect(await screen.findByText("7 хоногийн дараа дуусна. Сунгана уу.")).toBeInTheDocument();
    // 4 groups × 12,000₮ a term — the price page's own amount (#201).
    expect(screen.getByText("48,000₮")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Жилээр — хямд" }));
    expect(screen.getByText("144,000₮")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Нэхэмжлэх татах" })).toHaveAttribute(
      "href",
      expect.stringContaining("/service-access/invoice?period=year"),
    );
    expect(screen.queryByRole("button", { name: /QPay/ })).toBeNull();
  });

  it("says the contract details are coming while the API does not answer", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN"]) }]);
    renderWithProviders(<AdminServiceAccessPage />);

    expect(
      await screen.findByText("Үйлчилгээний эрхийн мэдээлэл удахгүй харагдана."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Нэхэмжлэх татах" })).toBeDisabled();
  });
});
