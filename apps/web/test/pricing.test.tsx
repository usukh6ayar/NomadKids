import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "./support/render";
import { PricingContent } from "@/components/public/pricing";
import { KINDERGARTEN_TIERS, PLANS, yearlySaving } from "@/lib/pricing";

/*
 * ★ Үнийн санал — the client's price sheet, 2026-10-08. The savings are
 * computed from the prices against three terms, never typed beside them.
 */
describe("the year's saving", () => {
  it("is measured against three terms bought one by one", () => {
    const saving = Object.fromEntries(
      PLANS.map((plan) => [plan.key, yearlySaving(plan.perTerm, plan.perYear)]),
    );
    // The sheet printed 4.4% on the child's plan; 3 × 9,000₮ against 26,000₮ is 3.7%.
    expect(saving).toEqual({ child: 3.7, teacher: 4.2, kindergarten: 4.4 });
    for (const tier of KINDERGARTEN_TIERS.filter((row) => row.perTerm && row.perYear)) {
      expect(yearlySaving(tier.perTerm!, tier.perYear!, 2)).toBe(4.44);
    }
  });
});

describe("the pricing page", () => {
  it("shows the three plans with both prices and the saving", () => {
    render(<PricingContent today="2026-12-01" />);

    const kindergarten = screen.getByRole("article", { name: "Цэцэрлэг" });
    expect(within(kindergarten).getByText("150,000₮")).toBeInTheDocument();
    expect(within(kindergarten).getByText("430,000₮")).toBeInTheDocument();
    // No savings badges — 2026-10-08, the client.
    expect(screen.queryByText(/хэмнэлт/)).toBeNull();
    expect(screen.queryByText(/хэмнэнэ/)).toBeNull();
  });

  /*
    ★ 2026-10-08, the client: no «Гэрээ байгуулах» on the child's plan; the
    kindergarten's opens «Байгууллагын бүртгэл», the teacher's a window like it.
  */
  it("opens the organisation and teacher windows, and offers the child none", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PricingContent />);

    const button = (plan: string) =>
      within(screen.getByRole("article", { name: plan })).queryByRole("button", {
        name: /Гэрээ байгуулах/,
      });
    expect(button("Хүүхэд")).toBeNull();
    expect(screen.queryByText("Гэрээсээ суралцахад")).toBeNull();

    await user.click(button("Цэцэрлэг")!);
    const organisation = screen.getByRole("dialog", { name: "Байгууллагын бүртгэл" });
    await user.click(within(organisation).getByRole("button", { name: "Хаах" }));

    await user.click(button("Багш")!);
    expect(screen.getByRole("dialog", { name: "Багшийн гэрээ" })).toBeInTheDocument();
  });

  it("switches the period between a term and a year", async () => {
    const user = userEvent.setup();
    render(<PricingContent />);

    const term = screen.getByRole("radio", { name: "Улирлаар (3 сар)" });
    const year = screen.getByRole("radio", { name: "Жилээр (12 сар)" });
    expect(term).toHaveAttribute("aria-checked", "true");
    await user.click(year);
    expect(year).toHaveAttribute("aria-checked", "true");
    expect(term).toHaveAttribute("aria-checked", "false");
  });

  /*
    ★ «Цэцэрлэгийн багцын дэлгэрэнгүй үнэ» is hidden for now — 2026-10-08, the
    client. The tiers stay in `lib/pricing.ts` (and their savings are checked
    above), so turning `SHOW_KINDERGARTEN_TIERS` back on is the whole change.
  */
  it("hides the kindergarten package table for now", () => {
    render(<PricingContent />);

    expect(screen.queryByText("Цэцэрлэгийн багцын дэлгэрэнгүй үнэ")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  /*
    ★ New customers, first term — 2026-10-08, the client: until the end of
    November a child 5,000₮, a teacher 25,000₮, a kindergarten 100,000₮.
  */
  it("offers the first-term price to new customers until the end of November", () => {
    render(<PricingContent today="2026-11-30" />);

    expect(
      screen.getByText("Шинэ хэрэглэгч: 1-р улирал (11 сар хүртэл) хямдралтай"),
    ).toBeInTheDocument();
    const prices = (plan: string) => within(screen.getByRole("article", { name: plan }));
    expect(prices("Хүүхэд").getByText("5,000₮")).toBeInTheDocument();
    expect(prices("Багш").getByText("25,000₮")).toBeInTheDocument();
    expect(prices("Цэцэрлэг").getByText("100,000₮")).toBeInTheDocument();
    // The old price, struck through above the new one.
    expect(prices("Цэцэрлэг").getByText("150,000₮")).toHaveClass("line-through");
  });

  it("shows the ordinary term price once the offer has run out", () => {
    render(<PricingContent today="2026-12-01" />);

    expect(screen.queryByText(/Шинэ хэрэглэгч/)).toBeNull();
    const kindergarten = within(screen.getByRole("article", { name: "Цэцэрлэг" }));
    expect(kindergarten.queryByText("100,000₮")).toBeNull();
    expect(kindergarten.getByText("150,000₮")).not.toHaveClass("line-through");
  });

  it("carries no term calendar and no «Хэмнэлттэй» badge", () => {
    render(<PricingContent />);

    expect(screen.queryByText("Улирлын хуваарь")).toBeNull();
    expect(screen.queryByText("Хэмнэлттэй")).toBeNull();
    expect(screen.queryByText("NOMADKIDS.MN")).toBeNull();
  });

  /*
    ★ 2026-10-08, the client: no subtitle, no children at the sides; two
    children cut at the belt stand on «Цэцэрлэг»'s top edge, on a desktop only.
  */
  it("seats the children on the kindergarten card and drops the subtitle", () => {
    const { container } = render(<PricingContent />);

    expect(screen.queryByText(/Хүүхэд бүрт чанартай контент/)).toBeNull();
    expect(container.querySelector('img[src*="icon-age-pointing"]')).toBeNull();
    const kids = screen
      .getByRole("article", { name: "Цэцэрлэг" })
      .querySelector('img[src*="pricing-kids"]');
    expect(kids).toHaveClass("bottom-full", "hidden", "lg:block");
  });
});
