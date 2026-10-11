import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "./support/render";
import { PricingContent } from "@/components/public/pricing";
import {
  CHILD_CURRENT_TERM_PRICE,
  CHILD_CURRENT_YEAR_PRICE,
  CHILD_STANDARD_TERM_PRICE,
  CHILD_STANDARD_YEAR_PRICE,
  KINDERGARTEN_CURRENT_TERM_PER_GROUP,
  KINDERGARTEN_CURRENT_YEAR_PER_GROUP,
  KINDERGARTEN_STANDARD_TERM_PER_GROUP,
  kindergartenStandardYearPrice,
  kindergartenTermPrice,
  kindergartenYearlyPrice,
  savingPercent,
  yearlySavingAmount,
} from "@/lib/pricing";

describe("the current school-year prices", () => {
  it("carries the mid-term discount into the yearly price", () => {
    expect(CHILD_CURRENT_TERM_PRICE).toBe(5_000);
    expect(CHILD_CURRENT_YEAR_PRICE).toBe(22_000);
    expect(KINDERGARTEN_CURRENT_TERM_PER_GROUP).toBe(2_000);
    expect(KINDERGARTEN_CURRENT_YEAR_PER_GROUP).toBe(34_000);

    expect(kindergartenTermPrice(3)).toBe(6_000);
    expect(kindergartenYearlyPrice(3)).toBe(102_000);
    expect(
      yearlySavingAmount(kindergartenStandardYearPrice(3), kindergartenYearlyPrice(3)),
    ).toBe(6_000);
    expect(savingPercent(CHILD_STANDARD_TERM_PRICE, CHILD_CURRENT_TERM_PRICE)).toBe(44.4);
    expect(savingPercent(CHILD_STANDARD_YEAR_PRICE, CHILD_CURRENT_YEAR_PRICE)).toBe(18.5);
    expect(
      savingPercent(KINDERGARTEN_STANDARD_TERM_PER_GROUP, KINDERGARTEN_CURRENT_TERM_PER_GROUP),
    ).toBe(83.3);
    expect(
      savingPercent(kindergartenStandardYearPrice(1), KINDERGARTEN_CURRENT_YEAR_PER_GROUP),
    ).toBe(5.6);
  });
});

describe("the pricing page", () => {
  it("shows the current term and discounted yearly prices", () => {
    render(<PricingContent />);

    const child = within(screen.getByRole("article", { name: "Хүүхэд" }));
    expect(child.getByText("Суурь үнэ: сар бүр 3,000₮")).toBeInTheDocument();
    expect(child.getByText("9,000₮")).toHaveClass("line-through");
    expect(child.getByText("5,000₮")).toBeInTheDocument();
    expect(child.getByText("22,000₮")).toBeInTheDocument();
    expect(child.queryByText("44.4% хэмнэлт")).toBeNull();
    expect(child.queryByText("18.5% хэмнэлт")).toBeNull();
    expect(child.queryByText("Улирлаар 44.4%, жилээр 18.5% хэмнэнэ.")).toBeNull();

    const teacher = within(screen.getByRole("article", { name: "Багш" }));
    expect(teacher.getByText("Үнэгүй")).toHaveClass("text-title");
    expect(teacher.getByText("Үнэгүй").parentElement).toHaveClass("w-fit", "min-w-28");
    expect(teacher.queryByText("Дангаар ашиглахад хугацаагүй")).toBeNull();

    const kindergarten = within(screen.getByRole("article", { name: "Цэцэрлэг" }));
    expect(kindergarten.getByText("1 бүлэг сарын 4,000₮")).toBeInTheDocument();
    expect(kindergarten.getByText("11 сар хүртэл 2,000₮")).toBeInTheDocument();
    expect(kindergarten.getByText("4,000₮")).toHaveClass("line-through");
    expect(kindergarten.getByText("2,000₮")).toBeInTheDocument();
    expect(kindergarten.getByText("34,000₮")).toBeInTheDocument();
    expect(kindergarten.queryByText("83.3% хэмнэлт")).toBeNull();
    expect(kindergarten.queryByText("5.6% хэмнэлт")).toBeNull();
    expect(
      kindergarten.getByText("Тогооч, санхүү, удирдлагад зориулсан нэгдсэн тайлан"),
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
    expect(screen.getByRole("dialog", { name: "Багшийн гэрээ" })).toBeInTheDocument();
  });

  it("switches the billing period between term and discounted year", async () => {
    const user = userEvent.setup();
    render(<PricingContent />);

    const term = screen.getByRole("radio", { name: "Улирлаар" });
    const year = screen.getByRole("radio", { name: "Жилээр — хямд" });
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
    expect(kindergarten.getAllByText("4,000₮").length).toBeGreaterThan(0);
    expect(kindergarten.getByText("8,000₮")).toHaveClass("line-through");
    expect(kindergarten.getByText("68,000₮")).toBeInTheDocument();
    expect(kindergarten.queryByText("83.3% хэмнэлт")).toBeNull();
    expect(kindergarten.queryByText("5.6% хэмнэлт")).toBeNull();

    await user.click(subtract);
    expect(kindergarten.getByLabelText("Сонгосон бүлгийн тоо")).toHaveTextContent("1");
  });

  it("passes the selected groups and yearly period into the contract request", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PricingContent />);

    const kindergarten = within(screen.getByRole("article", { name: "Цэцэрлэг" }));
    await user.click(kindergarten.getByRole("button", { name: "Бүлгийн тоо нэмэх" }));
    await user.click(screen.getByRole("radio", { name: "Жилээр — хямд" }));
    await user.click(kindergarten.getByRole("button", { name: /Гэрээ байгуулах/ }));

    const dialog = within(screen.getByRole("dialog", { name: "Байгууллагын бүртгэл" }));
    expect(dialog.getByRole("spinbutton", { name: /Бүлгийн тоо/ })).toHaveValue(2);
    expect(dialog.getByRole("combobox", { name: /Төлбөрийн хугацаа/ })).toHaveTextContent(
      "Жилээр — энэ улирлын хөнгөлөлт шингэсэн",
    );
    expect(dialog.getByText("68,000₮")).toBeInTheDocument();
  });

  it("seats the children on the kindergarten card", () => {
    render(<PricingContent />);

    const kids = screen
      .getByRole("article", { name: "Цэцэрлэг" })
      .querySelector('img[src*="pricing-kids"]');
    expect(kids).toHaveClass("bottom-full", "hidden", "lg:block");
  });
});
