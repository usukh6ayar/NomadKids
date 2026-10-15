import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, stubApi, type RouteStub } from "./support/render";
import { KindergartenPayments } from "@/components/platform/kindergarten-payments";

/*
 * ★ A kindergarten's payments to the platform — 2026-10-14, the user: due the
 * day each term (or year) begins, suspended unpaid on it, recorded by the
 * operator alone, reversed rather than deleted. Built against routes asked of
 * the admin.
 */
afterEach(() => vi.unstubAllGlobals());

const KG = "11111111-1111-4111-8111-111111111111";
const CONTRACT = "22222222-2222-4222-8222-222222222222";

const SCHEDULE = {
  contract: { id: CONTRACT, number: "NK-2026-000001", billingPeriod: "term" },
  suspended: false,
  periods: [
    {
      index: 0,
      label: "I улирал (9–11 сар)",
      dueOn: "2026-09-01",
      amount: "18000.00",
      paidAmount: "18000.00",
      status: "paid",
      payments: [
        {
          id: "p1",
          amount: "18000.00",
          paidOn: "2026-08-28",
          method: "transfer",
          reference: "Гэрээ NK-2026-000001",
        },
      ],
    },
    {
      index: 1,
      label: "II улирал (12–2 сар)",
      dueOn: "2026-12-01",
      amount: "36000.00",
      paidAmount: "0.00",
      status: "due",
      payments: [],
    },
  ],
};

function renderPayments(body: unknown = SCHEDULE, extra: RouteStub[] = []) {
  const api = stubApi([...extra, { path: `/platform/kindergartens/${KG}/payments`, body }]);
  renderWithProviders(<KindergartenPayments kindergartenId={KG} />);
  return api;
}

describe("a kindergarten's payments", () => {
  it("lists the schedule with what was paid and when", async () => {
    renderPayments();
    const table = await screen.findByRole("table");

    const first = within(table).getByText("I улирал (9–11 сар)").closest("tr")!;
    expect(first).toHaveTextContent("2026.09.01");
    expect(first).toHaveTextContent("Төлсөн");
    expect(first).toHaveTextContent("2026.08.28 · 18,000₮ · Шилжүүлэг · Гэрээ NK-2026-000001");
    expect(within(first).queryByRole("button", { name: "Төлбөр бүртгэх" })).toBeNull();

    const second = within(table).getByText("II улирал (12–2 сар)").closest("tr")!;
    expect(second).toHaveTextContent("36,000₮");
    expect(second).toHaveTextContent("Төлөх хугацаа ойртсон");
    expect(within(second).getByRole("button", { name: "Төлбөр бүртгэх" })).toBeInTheDocument();
  });

  it("records a payment against its period, owed amount first", async () => {
    const user = userEvent.setup();
    const api = renderPayments(SCHEDULE, [
      { path: `/platform/contracts/${CONTRACT}/payments`, method: "POST", body: {} },
    ]);
    const table = await screen.findByRole("table");

    const second = within(table).getByText("II улирал (12–2 сар)").closest("tr")!;
    await user.click(within(second).getByRole("button", { name: "Төлбөр бүртгэх" }));
    const dialog = await screen.findByRole("dialog", { name: "Төлбөр бүртгэх" });
    expect(dialog).toHaveTextContent("Гэрээ №NK-2026-000001 · Улирлаар");
    expect(within(dialog).getByLabelText(/Орсон дүн/)).toHaveValue("36000");
    await user.type(within(dialog).getByLabelText(/Гүйлгээний утга/), "Хаан банк 123");
    await user.click(within(dialog).getByRole("button", { name: "Бүртгэх" }));

    await waitFor(() =>
      expect(
        api.calls.find((call) => call.url === `/platform/contracts/${CONTRACT}/payments`)?.body,
      ).toMatchObject({
        periodIndexes: [1],
        amount: "36000",
        method: "transfer",
        reference: "Хаан банк 123",
      }),
    );
  });

  it("reverses a payment behind a confirmation, never deletes it", async () => {
    const user = userEvent.setup();
    const api = renderPayments(SCHEDULE, [
      { path: "/platform/payments/p1/reverse", method: "POST", body: {} },
    ]);
    const table = await screen.findByRole("table");

    await user.click(within(table).getByRole("button", { name: "Буцаах" }));
    const confirm = await screen.findByRole("dialog", { name: "Төлбөрийг буцаах уу?" });
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
    await user.type(within(confirm).getByLabelText("Буцаах шалтгаан"), "Буруу цэцэрлэг");
    await user.click(within(confirm).getByRole("button", { name: "Буцаах" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.url === "/platform/payments/p1/reverse")?.body).toEqual({
        reason: "Буруу цэцэрлэг",
      }),
    );
    expect(api.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("strikes a reversed payment through and marks a suspended kindergarten", async () => {
    renderPayments({
      ...SCHEDULE,
      suspended: true,
      periods: [
        {
          ...SCHEDULE.periods[0],
          paidAmount: "0.00",
          status: "overdue",
          payments: [{ ...SCHEDULE.periods[0]!.payments[0], reversedAt: "2026-09-02" }],
        },
      ],
    });
    const table = await screen.findByRole("table");

    expect(screen.getByText("Эрх түр хаагдсан")).toBeInTheDocument();
    expect(within(table).getByText("Хоцорсон")).toBeInTheDocument();
    expect(within(table).getByText("Буцаасан")).toBeInTheDocument();
    expect(within(table).getByText(/2026\.08\.28 · 18,000₮/)).toHaveClass("line-through");
  });

  it("says in plain words that payments cannot be kept yet", async () => {
    stubApi([]);
    renderWithProviders(<KindergartenPayments kindergartenId={KG} />);

    expect(
      await screen.findByText(/Төлбөр хадгалах хэсэг хараахан бэлэн болоогүй/),
    ).toBeInTheDocument();
  });

  it("says where a contract comes from when there is none", async () => {
    renderPayments({ contract: null, periods: [], suspended: false });

    expect(await screen.findByText(/Энэ цэцэрлэг гэрээгүй/)).toBeInTheDocument();
  });

  it("pays several periods at once, the paid one shown but not to be chosen", async () => {
    const user = userEvent.setup();
    const THIRD = {
      ...SCHEDULE.periods[1]!,
      index: 2,
      label: "III улирал (3–5 сар)",
      dueOn: "2027-03-01",
      status: "upcoming",
    };
    const api = renderPayments({ ...SCHEDULE, periods: [...SCHEDULE.periods, THIRD] }, [
      { path: `/platform/contracts/${CONTRACT}/payments`, method: "POST", body: {} },
    ]);
    const table = await screen.findByRole("table");

    const second = within(table).getByText("II улирал (12–2 сар)").closest("tr")!;
    await user.click(within(second).getByRole("button", { name: "Төлбөр бүртгэх" }));
    const dialog = await screen.findByRole("dialog", { name: "Төлбөр бүртгэх" });

    const paid = within(dialog).getByRole("checkbox", { name: /I улирал \(9–11 сар\)/ });
    expect(paid).toBeChecked();
    expect(paid).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: /^II улирал/ })).toBeChecked();

    await user.click(within(dialog).getByRole("checkbox", { name: /^III улирал/ }));
    expect(dialog).toHaveTextContent("Сонгосон дүн: 72,000₮");
    expect(within(dialog).getByLabelText(/Орсон дүн/)).toHaveValue("72000");
    await user.click(within(dialog).getByRole("button", { name: "Бүртгэх" }));

    await waitFor(() =>
      expect(
        api.calls.find((call) => call.url === `/platform/contracts/${CONTRACT}/payments`)?.body,
      ).toMatchObject({ periodIndexes: [1, 2], amount: "72000" }),
    );
  });

  it("says how much is short, and shows a part-paid period as such", async () => {
    const user = userEvent.setup();
    renderPayments({
      ...SCHEDULE,
      periods: [SCHEDULE.periods[0], { ...SCHEDULE.periods[1]!, paidAmount: "6000.00" }],
    });
    const table = await screen.findByRole("table");

    const second = within(table).getByText("II улирал (12–2 сар)").closest("tr")!;
    expect(second).toHaveTextContent("Хэсэгчлэн төлсөн · 30,000₮ үлдсэн");

    await user.click(within(second).getByRole("button", { name: "Төлбөр бүртгэх" }));
    const dialog = await screen.findByRole("dialog", { name: "Төлбөр бүртгэх" });
    const amount = within(dialog).getByLabelText(/Орсон дүн/);
    expect(amount).toHaveValue("30000");
    await user.clear(amount);
    await user.type(amount, "20000");
    expect(dialog).toHaveTextContent("10,000₮ дутуу — хэсэгчлэн төлсөн гэж бүртгэгдэнэ");
    expect(within(dialog).getByRole("button", { name: "Бүртгэх" })).toBeEnabled();
  });
});
