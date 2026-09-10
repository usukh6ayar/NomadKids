import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegisterProgress } from "@/components/register/register-progress";

/**
 * The strip above the three group registers.
 *
 * ★ The headline is the *count*, and the line under it is what remains —
 * 2026-09-10, at the client's request.
 *
 * It used to lead with "4 үлдсэн" and say "Бүгд бүртгэгдсэн" at the end. The
 * client could not read the finished state: "all registered" is a state, and a
 * teacher checking a register wants a number they can compare with the
 * children in front of them. Both facts are still on the strip; which one is
 * the headline is what changed, so both are asserted directly — a regression
 * that swapped them back would still render a plausible summary.
 *
 * The other two remain what they were: never invent a count for an empty
 * group, never report a negative remainder.
 */

const BREAKDOWN = [
  { key: "PRESENT", label: "Ирсэн", count: 12, tone: "mint" as const },
  { key: "SICK", label: "Өвчтэй", count: 2, tone: "sun" as const },
  { key: "ABSENT", label: "Тасалсан", count: 0, tone: "peach" as const },
];

describe("бүртгэлийн явц", () => {
  it("leads with the number registered, and still says what is left", () => {
    render(<RegisterProgress recorded={14} total={18} breakdown={BREAKDOWN} />);

    expect(screen.getByText("14 хүүхэд бүртгэсэн")).toBeInTheDocument();
    expect(screen.getByText("18 хүүхдээс · 4 үлдсэн")).toBeInTheDocument();
  });

  it("counts rather than announcing a state when the register is finished", () => {
    render(<RegisterProgress recorded={18} total={18} breakdown={BREAKDOWN} />);

    // "Бүгд бүртгэгдсэн" was the headline here and could not be compared with
    // anything; the count can.
    expect(screen.getByText("18 хүүхэд бүртгэсэн")).toBeInTheDocument();
    expect(screen.getByText("18 хүүхдээс бүгд")).toBeInTheDocument();
    expect(screen.queryByText("0 үлдсэн")).not.toBeInTheDocument();
  });

  /**
   * ★ A zero count is dropped, not rendered as "Тасалсан 0".
   *
   * A row of zeros is what makes the two real numbers beside them hard to find,
   * which is the whole reason this strip is a line of counts rather than a
   * table.
   */
  it("shows only the statuses that happened", () => {
    render(<RegisterProgress recorded={14} total={18} breakdown={BREAKDOWN} />);

    expect(screen.getByText("Ирсэн")).toBeInTheDocument();
    expect(screen.getByText("Өвчтэй")).toBeInTheDocument();
    expect(screen.queryByText("Тасалсан")).not.toBeInTheDocument();
  });

  /**
   * ★ The sixth status counts.
   *
   * `/groups/:id/attendance` built this breakdown from
   * `ATTENDANCE_STATUS_ORDER`, which is five — it predates `OTHER` — while the
   * buttons on the same screen render all six from `ATTENDANCE_STATUS_LABEL`
   * and the API has accepted `OTHER` since 2026-09-02. So "Бусад" saved
   * correctly and then went missing from the totals: `recorded` counted the
   * child, the chips beneath did not, and the two disagreed by one on screen.
   *
   * Asserted here rather than in the page's own test because this strip is the
   * shared surface all three registers report through.
   */
  it("reports Бусад when it has been used", () => {
    render(
      <RegisterProgress
        recorded={15}
        total={18}
        breakdown={[...BREAKDOWN, { key: "OTHER", label: "Бусад", count: 1, tone: "sky" as const }]}
      />,
    );

    expect(screen.getByText("Бусад")).toBeInTheDocument();
  });

  it("keeps the caller's order rather than sorting by size", () => {
    render(<RegisterProgress recorded={14} total={18} breakdown={BREAKDOWN} />);

    const labels = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(labels[0]).toContain("Ирсэн");
    expect(labels[1]).toContain("Өвчтэй");
  });

  /** An empty group has nothing to be a percentage of. */
  it("does not claim progress for a group with no children", () => {
    render(<RegisterProgress recorded={0} total={0} breakdown={[]} />);

    // The ring draws its own "—" for a percentage of nothing, so the strip
    // carries two: this asserts the sub-line, not whichever came first.
    expect(screen.getByText("Хүүхэд алга")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  /**
   * ★ The ring is the only thing carrying the figure, so it is named.
   *
   * `Ring` is `aria-hidden` by default because on every other screen the
   * percentage is also on the card as text. Here it is not — the card says "4
   * үлдсэн", never "78%" — so a screen reader gets the sentence instead.
   */
  it("names the ring for a screen reader", () => {
    render(<RegisterProgress recorded={14} total={18} breakdown={BREAKDOWN} />);

    expect(screen.getByRole("img", { name: "18 хүүхдээс 14 нь бүртгэсэн" })).toBeInTheDocument();
  });

  /** Assessment counts "үнэлсэн", not "бүртгэсэн". */
  it("takes the verb from the caller", () => {
    render(<RegisterProgress recorded={3} total={9} verb="үнэлсэн" breakdown={[]} />);

    expect(screen.getByText("3 хүүхэд үнэлсэн")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "9 хүүхдээс 3 нь үнэлсэн" })).toBeInTheDocument();
  });

  /**
   * ★ Never a negative remainder.
   *
   * `recorded` above `total` means the caller's two counts disagree — a draft
   * counted against a stale roster, say. "−2 үлдсэн" would be a number nobody
   * can act on; zero is the honest floor.
   */
  it("clamps the remainder at zero rather than going negative", () => {
    render(<RegisterProgress recorded={20} total={18} breakdown={[]} />);

    expect(screen.getByText("18 хүүхдээс бүгд")).toBeInTheDocument();
    expect(screen.queryByText(/-2 үлдсэн/)).not.toBeInTheDocument();
  });
});
