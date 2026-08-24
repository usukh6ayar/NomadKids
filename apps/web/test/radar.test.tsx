import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AssessmentRadar } from "@kinder/contracts";
import { DevelopmentRadar } from "@/components/assessment/development-radar";
import { ObservationMix } from "@/components/dashboard/observation-mix";

/**
 * The radar, and the promise that justified hand-drawing it.
 *
 * ★ A chart was held out of this product for a year on the grounds that it
 * "needs a charting dependency to say what a labelled row says more precisely
 * and reads out loud correctly" (`term-progress.tsx`). Building one anyway is
 * only defensible if that objection is answered rather than ignored — so the
 * assertions here are mostly about the data being *readable*, not about the
 * polygon being drawn.
 */

const DOMAINS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Бие бялдрын хөгжил" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Нийгэмшихүй, сэтгэл хөдлөл" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Хэл яриа, харилцаа" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Танин мэдэхүй" },
  { id: "55555555-5555-4555-8555-555555555555", name: "Урлаг, гоо зүйн хүмүүжил" },
];

function radar(overrides: Partial<AssessmentRadar> = {}): AssessmentRadar {
  return {
    term: { id: "66666666-6666-4666-8666-666666666666", number: 1, name: "I улирал" },
    axes: DOMAINS.map((domain, index) => ({
      domain: { ...domain, code: `d${index}`, color: "#000", order: index },
      score: index === 4 ? null : 3,
      level: index === 4 ? null : { id: `l${index}`, value: 3, label: "Хүрсэн", color: "#10b981" },
    })),
    cohort: null,
    ...overrides,
  } as AssessmentRadar;
}

describe("the radar reads out loud", () => {
  it("puts every domain and its level in a real table", () => {
    render(<DevelopmentRadar radar={radar()} />);

    const table = screen.getByRole("table");
    for (const domain of DOMAINS) {
      expect(within(table).getByRole("rowheader", { name: domain.name })).toBeInTheDocument();
    }

    // The level's own word, not the numeral — `AssessmentLevel` is an ordinal
    // scale a kindergarten may rename, so "3" is not what anyone calls it.
    expect(within(table).getAllByText("Хүрсэн")).toHaveLength(4);
    expect(within(table).getByText("Үнэлээгүй")).toBeInTheDocument();
  });

  /**
   * ★★ The figure carries no information of its own.
   *
   * If the SVG were exposed, a screen reader would walk a polygon's coordinates
   * and learn nothing, while the same values sit in the table beside it. One
   * source, read two ways.
   */
  it("hides the drawing from assistive technology", () => {
    const { container } = render(<DevelopmentRadar radar={radar()} />);

    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  /**
   * An unassessed domain is a point at the origin, not a side the polygon
   * skips. Shape is the signal: a four-sided figure and a five-sided one are
   * not comparable at a glance, so the axis count must not depend on the data.
   */
  it("draws an axis for a domain with no score", () => {
    const { container } = render(<DevelopmentRadar radar={radar()} />);

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    // Five domains plus the header.
    expect(rows).toHaveLength(6);

    const points = container.querySelectorAll("polygon");
    // Four rings plus the child's own outline; no cohort in this fixture.
    expect(points.length).toBe(5);
  });

  it("names what the second line averages, and only when there is one", () => {
    const { rerender } = render(<DevelopmentRadar radar={radar()} />);
    expect(screen.queryByText(/Бүлгийн дундаж/)).toBeNull();

    rerender(
      <DevelopmentRadar
        radar={radar({
          cohort: {
            group: { id: "77777777-7777-4777-8777-777777777777", name: "Дунд бүлэг" },
            sampleSize: 18,
            averageByDomain: { [DOMAINS[0]!.id]: 2.6 },
          },
        })}
      />,
    );

    // "18 хүүхэд" is a fact a reader can weigh. An unlabelled second outline
    // invites them to read a group of five as the whole kindergarten.
    expect(screen.getByText(/Бүлгийн дундаж · 18 хүүхэд/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("2.6")).toBeInTheDocument();
  });
});

describe("the observation mix", () => {
  const types = [
    { type: { id: "a", name: "Өдөр тутмын ажиглалт" }, count: 6 },
    { type: { id: "b", name: "Онцлох ахиц" }, count: 2 },
    { type: { id: "c", name: "Анхаарал шаардсан" }, count: 0 },
  ];

  /**
   * ★ Counts lead; the share is parenthetical.
   *
   * The wireframe asked for a "биелэлт" percentage, and no target exists in the
   * schema to divide by. Showing a share of the total is honest; showing it as
   * a completion score would imply somebody set 100%.
   */
  it("shows the count with its share of the total, not a completion rate", () => {
    render(<ObservationMix observationsByType={types} term="I улирал" />);

    expect(screen.getByText(/нийт 8 ажиглалт/i)).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("(75%)")).toBeInTheDocument();
    expect(screen.queryByText(/биелэлт/i)).toBeNull();
  });

  it("keeps a type that nobody used, at zero", () => {
    render(<ObservationMix observationsByType={types} term="I улирал" />);

    const bar = screen.getByRole("progressbar", { name: /Анхаарал шаардсан/ });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });

  it("renders nothing at all when the term has no observations", () => {
    const { container } = render(
      <ObservationMix
        observationsByType={types.map((t) => ({ ...t, count: 0 }))}
        term="I улирал"
      />,
    );

    // Not a chart of zeroes — the feed below already carries the empty case and
    // the way to write the first observation.
    expect(container).toBeEmptyDOMElement();
  });
});
