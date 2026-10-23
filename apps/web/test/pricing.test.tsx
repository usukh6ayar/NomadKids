import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "./support/render";
import { PricingContent } from "@/components/public/pricing";
import {
  contractSchedule,
  CHILD_CURRENT_TERM_PRICE,
  CHILD_CURRENT_YEAR_PRICE,
  CHILD_STANDARD_TERM_PRICE,
  CHILD_STANDARD_YEAR_PRICE,
  KINDERGARTEN_CURRENT_TERM_PER_GROUP,
  kindergartenYearPerGroup,
  KINDERGARTEN_STANDARD_TERM_PER_GROUP,
  kindergartenStandardYearPrice,
  kindergartenTermPrice,
  kindergartenYearlyPrice,
  savingPercent,
  yearlySavingAmount,
} from "@/lib/pricing";

describe("the current school-year prices", () => {
  /*
   * ★ The user, 2026-10-21: a child's «I-р улирал» free and the year 18,000₮;
   * a group's I term 4,000₮ and its year
   * the months left × 4,000₮ (the user, 2026-10-22) — on 18 October, November–May.
   */
  it("charges the discounted price below the standard", () => {
    expect(CHILD_CURRENT_TERM_PRICE).toBe(0);
    expect(CHILD_CURRENT_YEAR_PRICE).toBe(18_000);
    expect(KINDERGARTEN_CURRENT_TERM_PER_GROUP).toBe(4_000);
    // Seven months — November to May — 28,000₮; the whole year 9 × 4,000₮.
    expect(kindergartenYearPerGroup("2026-10-18")).toBe(28_000);
    expect(kindergartenYearPerGroup("2026-08-18")).toBe(36_000);
    expect(kindergartenYearPerGroup("2026-12-15")).toBe(20_000);

    // 4,000₮ a group for «I-р улирал», three groups.
    expect(kindergartenTermPrice(3, "2026-10-18")).toBe(12_000);
    expect(kindergartenYearlyPrice(3, "2026-10-18")).toBe(84_000);
    expect(
      yearlySavingAmount(
        kindergartenStandardYearPrice(3),
        kindergartenYearlyPrice(3, "2026-10-18"),
      ),
    ).toBe(24_000);
    expect(savingPercent(CHILD_STANDARD_TERM_PRICE, CHILD_CURRENT_TERM_PRICE)).toBe(100);
    expect(savingPercent(CHILD_STANDARD_YEAR_PRICE, CHILD_CURRENT_YEAR_PRICE)).toBe(33.3);
    expect(
      savingPercent(KINDERGARTEN_STANDARD_TERM_PER_GROUP, KINDERGARTEN_CURRENT_TERM_PER_GROUP),
    ).toBe(66.7);
  });
});

/** The page reads «today» for the promotion — pin it (Date only, so timers still run). */
function onDay(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
}

describe("the pricing page", () => {
  beforeEach(() => onDay("2026-10-18T03:00:00.000Z"));
  afterEach(() => vi.useRealTimers());

  it("shows the discounted prices with the standard struck through", () => {
    render(<PricingContent />);

    const child = within(screen.getByRole("article", { name: "Хүүхэд" }));
    expect(child.getByText("Суурь үнэ: сар бүр 3,000₮")).toBeInTheDocument();
    expect(screen.getByText("I-р улирал · 2026.11.30 хүртэл хүчинтэй")).toBeInTheDocument();
    // On the term's own price, before anyone pays (2026-10-18).
    expect(child.getByText("2026.11.30 хүртэл хүчинтэй")).toBeInTheDocument();
    expect(child.getByText("/ I-р улирал")).toBeInTheDocument();
    expect(child.getByText("9,000₮")).toHaveClass("line-through");
    // A free term says so — never «0₮» (the user, 2026-10-21).
    expect(child.getByText("Үнэгүй")).toBeInTheDocument();
    expect(child.queryByText("0₮")).toBeNull();
    expect(child.getByText("27,000₮")).toHaveClass("line-through");
    expect(child.getByText("18,000₮")).toBeInTheDocument();

    const teacher = within(screen.getByRole("article", { name: "Багш" }));
    expect(teacher.getByText("Үнэгүй")).toHaveClass("text-title");
    expect(teacher.getByText("Үнэгүй").parentElement).toHaveClass("w-fit", "min-w-28");
    expect(teacher.queryByText("Дангаар ашиглахад хугацаагүй")).toBeNull();

    const kindergarten = within(screen.getByRole("article", { name: "Цэцэрлэг" }));
    expect(kindergarten.getByText("1 бүлэг сарын 4,000₮")).toBeInTheDocument();
    expect(kindergarten.queryByText(/11 сар хүртэл/)).toBeNull();
    expect(kindergarten.getByText("12,000₮")).toHaveClass("line-through");
    expect(kindergarten.getByText("4,000₮")).toBeInTheDocument();
    expect(kindergarten.getByText("36,000₮")).toHaveClass("line-through");
    expect(kindergarten.getByText("28,000₮")).toBeInTheDocument();
    expect(
      kindergarten.getByText("ESIS-тэй холболт: Суралцагч, ажилтны бүртгэл, мэргэшлийн зэрэг"),
    ).toBeInTheDocument();
  });

  it("opens the organisation and teacher windows, and offers the child none", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PricingContent />);

    const plan = (name: string) => within(screen.getByRole("article", { name }));
    expect(plan("Хүүхэд").queryByRole("button")).toBeNull();

    await user.click(plan("Цэцэрлэг").getByRole("button", { name: /Гэрээ байгуулах/ }));
    const organisation = screen.getByRole("dialog", { name: "Байгууллагын бүртгэл" });
    await user.click(within(organisation).getByRole("button", { name: "Хаах" }));

    await user.click(plan("Багш").getByRole("button", { name: /Бүртгүүлэх/ }));
    expect(screen.getByRole("dialog", { name: "Багш, ажилтан" })).toBeInTheDocument();
  });

  it("switches the billing period between term and year", async () => {
    const user = userEvent.setup();
    render(<PricingContent />);

    const term = screen.getByRole("radio", { name: "I-р улирал" });
    const year = screen.getByRole("radio", { name: "Жилээр" });
    expect(term).toHaveAttribute("aria-checked", "true");
    await user.click(year);
    expect(year).toHaveAttribute("aria-checked", "true");
    expect(term).toHaveAttribute("aria-checked", "false");
  });

  it("recalculates the kindergarten term and year as groups change", async () => {
    const user = userEvent.setup();
    render(<PricingContent />);

    const kindergarten = within(screen.getByRole("article", { name: "Цэцэрлэг" }));
    const subtract = kindergarten.getByRole("button", { name: "Бүлгийн тоо хасах" });
    expect(subtract).toBeDisabled();

    await user.click(kindergarten.getByRole("button", { name: "Бүлгийн тоо нэмэх" }));
    expect(kindergarten.getByLabelText("Сонгосон бүлгийн тоо")).toHaveTextContent("2");
    // 2 groups: 2 × 4,000₮ a term, 2 × 28,000₮ a year.
    expect(kindergarten.getAllByText("8,000₮").length).toBeGreaterThan(0);
    expect(kindergarten.getByText("56,000₮")).toBeInTheDocument();

    await user.click(subtract);
    expect(kindergarten.getByLabelText("Сонгосон бүлгийн тоо")).toHaveTextContent("1");
  });

  it("passes the selected groups and yearly period into the contract request", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PricingContent />);

    const kindergarten = within(screen.getByRole("article", { name: "Цэцэрлэг" }));
    await user.click(kindergarten.getByRole("button", { name: "Бүлгийн тоо нэмэх" }));
    await user.click(screen.getByRole("radio", { name: "Жилээр" }));
    await user.click(kindergarten.getByRole("button", { name: /Гэрээ байгуулах/ }));

    const dialog = within(screen.getByRole("dialog", { name: "Байгууллагын бүртгэл" }));
    expect(dialog.getByRole("spinbutton", { name: /Бүлгийн тоо/ })).toHaveValue(2);
    expect(dialog.getByRole("combobox", { name: /Төлбөрийн хугацаа/ })).toHaveTextContent("Жилээр");
    expect(dialog.getByText("56,000₮")).toBeInTheDocument();
  });

  it("seats the children on the kindergarten card", () => {
    render(<PricingContent />);

    const kids = screen
      .getByRole("article", { name: "Цэцэрлэг" })
      .querySelector('img[src*="pricing-kids"]');
    expect(kids).toHaveClass("bottom-full", "hidden", "lg:block");
  });
});

/*
 * ★ After «I-р улирал» — the terms at the standard price: 9,000₮ a child (the
 * user, 2026-10-18) and 12,000₮ a group; the promotion's label is gone.
 */
describe("the pricing page from 1 December 2026", () => {
  beforeEach(() => onDay("2026-12-01T03:00:00.000Z"));
  afterEach(() => vi.useRealTimers());

  it("prices the term at the standard 9,000₮ a child and 12,000₮ a group", () => {
    render(<PricingContent />);

    expect(screen.queryByText(/2026\.11\.30 хүртэл хүчинтэй/)).toBeNull();
    expect(screen.getByRole("radio", { name: "Улирлаар" })).toBeInTheDocument();

    const child = within(screen.getByRole("article", { name: "Хүүхэд" }));
    expect(child.queryByText("Үнэгүй")).toBeNull();
    expect(child.getByText("9,000₮")).not.toHaveClass("line-through");
    expect(child.getByText("18,000₮")).toBeInTheDocument();

    const kindergarten = within(screen.getByRole("article", { name: "Цэцэрлэг" }));
    expect(kindergarten.getByText("12,000₮")).not.toHaveClass("line-through");
    expect(kindergarten.queryByText("4,000₮")).toBeNull();
    expect(kindergartenTermPrice(3, "2026-12-01")).toBe(36_000);
  });
});

describe("a kindergarten contract's terms", () => {
  /*
   * ★ «I-р улирал» is 4,000₮ a group (2026-10-22) — the contract used to print 2,000₮
   * (a month) for it, read as the term's price (the client, 2026-10-18).
   */
  it("prices «I-р улирал» as a 4,000₮ term, never as a month", () => {
    const schedule = contractSchedule(3, "term", "2026-09-01", "2027-05-31")!;
    const [first, second] = schedule.lines;
    expect(first).toMatchObject({
      perGroup: 4_000,
      perMonth: null,
      amount: 12_000,
      discounted: true,
    });
    expect(second).toMatchObject({ perGroup: 12_000, perMonth: 4_000, discounted: false });
    expect(schedule.lines.some((line) => line.perMonth === 2_000 || line.perGroup === 2_000)).toBe(
      false,
    );
  });

  /*
   * ★ A contract approved mid-term pays that whole term — the user,
   * 2026-10-14 («бүтнээр»).
   */
  it("charges the whole term a contract starts in", () => {
    const fromSeptember = contractSchedule(3, "term", "2026-09-01", "2027-05-31")!;
    const fromMidOctober = contractSchedule(3, "term", "2026-10-14", "2027-05-31")!;
    expect(fromMidOctober.lines.map((line) => line.amount)).toEqual([12_000, 36_000, 36_000]);
    expect(fromMidOctober.total).toBe(fromSeptember.total);
  });
});
