import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import ApplicationsPage from "@/app/(app)/platform/applications/page";

/*
 * ★ Since #195 (2026-10-11) a kindergarten is priced per group. The operator
 * approves with the groups, the period, the rate and the total — pre-filled
 * from the application and the price sheet — and an application from before
 * still shows its child count.
 */
afterEach(() => vi.unstubAllGlobals());

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const APPLICATION = {
  id: "33333333-3333-4333-8333-333333333333",
  kindergartenName: "Аз жаргал цэцэрлэг",
  registrationNumber: "9012345",
  address: null,
  directorName: "Дорж Сараа",
  phone: "99112233",
  email: "azjargal@example.mn",
  childCount: null,
  groupCount: 6,
  billingPeriod: "year",
  note: null,
  status: "PENDING",
  reviewedAt: null,
  reviewNote: null,
  kindergartenId: null,
  createdAt: "2026-10-11T09:00:00.000Z",
  contract: null,
};

const LEGACY = {
  ...APPLICATION,
  id: "44444444-4444-4444-8444-444444444444",
  kindergartenName: "Хуучин цэцэрлэг",
  registrationNumber: "9099999",
  address: "Дархан",
  childCount: 80,
  groupCount: null,
  billingPeriod: null,
};

const list = (items: unknown[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
  totalPages: 1,
});

describe("the operator's applications", () => {
  it("shows the groups of a new application and the children of an old one", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([APPLICATION, LEGACY]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    expect(await screen.findByText(/6 бүлэг · жилээр/)).toBeInTheDocument();
    expect(screen.getByText(/80 хүүхэд/)).toBeInTheDocument();
    expect(screen.getByText("Дархан")).toBeInTheDocument();
  });

  it("approves with the per-group terms, the total following the price sheet", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: `/platform/applications/${APPLICATION.id}/approve`,
        method: "POST",
        body: { ...APPLICATION, status: "APPROVED", invitationToken: "t", adminUsername: "az" },
      },
      { path: "/platform/applications", body: list([APPLICATION]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Бүлгийн тоо/)).toHaveValue("6");
    // 6 groups × 36,000₮ for the school year.
    expect(within(dialog).getByLabelText(/Нийт төлбөр/)).toHaveValue("216000");

    await user.type(within(dialog).getByLabelText(/Админы нэвтрэх нэр/), "azjargal");
    await user.click(within(dialog).getByRole("button", { name: "Батлах" }));

    await waitFor(() => {
      const body = api.calls.find((call) => call.url.endsWith("/approve"))?.body;
      expect(body).toMatchObject({
        adminUsername: "azjargal",
        groupCount: 6,
        billingPeriod: "year",
        perGroupMonthlyFee: "4000",
        periodFee: "216000",
      });
    });
  });

  it("asks for the groups of an application made before the per-group price", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/applications", body: list([LEGACY]) },
    ]);
    renderWithProviders(<ApplicationsPage />);

    await user.click(await screen.findByRole("button", { name: "Шалгах" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Бүлгийн тоо/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/Нийт төлбөр/)).toHaveValue("");

    await user.type(within(dialog).getByLabelText(/Бүлгийн тоо/), "3");
    expect(within(dialog).getByLabelText(/Нийт төлбөр/)).toHaveValue("108000");
  });
});
