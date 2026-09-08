import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { PageHeader } from "@/components/shell/app-shell";
import { BarRow } from "@/components/ui/chart/bar-row";
import { Donut } from "@/components/ui/chart/donut";
import { Ring } from "@/components/ui/chart/ring";
import { Sparkline } from "@/components/ui/chart/sparkline";
import { TONES, TONE_CARD, TONE_SURFACE, TONE_VAR } from "@/components/ui/tone";
import { StatCard } from "@/components/ui/stat-card";
import { Art } from "@/components/ui/art";
import { renderWithProviders } from "./support/render";

/**
 * The global visual foundation: tone, identity, and the chart primitives.
 *
 * ★ These are the pieces every screen will build on, so the properties worth
 * pinning are the ones a screen cannot fix for itself — contrast, the untinted
 * default, and whether a chart has a name.
 */

const WEB_ROOT = join(__dirname, "..");

// ═══════════════════════════════════════════════════════════════════════════
// Contrast — the measured constraint behind the whole tone system
// ═══════════════════════════════════════════════════════════════════════════

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Reads a custom property out of `globals.css`, so the test cannot drift. */
function token(name: string): string {
  const css = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`${name} not found in globals.css`);
  return match[1]!;
}

describe("tone contrast", () => {
  it("pairs every tint with an ink that clears 4.5:1", () => {
    for (const tone of TONES) {
      const ratio = contrast(token(`--color-${tone}`), token(`--color-${tone}-ink`));
      expect(ratio, `${tone} on its own ink`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps --color-ink readable on every tint, which is what a toned Card relies on", () => {
    const ink = token("--color-ink");
    for (const tone of TONES) {
      expect(contrast(token(`--color-${tone}`), ink), `ink on ${tone}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /*
   * ★ The measurement that shaped the design.
   *
   * `--color-muted` is between 3.46:1 and 4.08:1 on these six tints — under the
   * floor on every one. That is why `TONE_SURFACE` names an explicit ink rather
   * than letting a chip inherit, and why a toned `Card` keeps text at
   * `--color-ink`. If a future repaint makes muted safe here, this test fails
   * and the rule can be revisited deliberately rather than by accident.
   */
  it("confirms --color-muted is NOT safe on the tints", () => {
    const muted = token("--color-muted");
    for (const tone of TONES) {
      expect(contrast(token(`--color-${tone}`), muted), `muted on ${tone}`).toBeLessThan(4.5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Card tone
// ═══════════════════════════════════════════════════════════════════════════

describe("Card tone", () => {
  it("is untinted by default, exactly as before", () => {
    const { container } = render(<Card data-testid="c">x</Card>);
    const card = container.firstElementChild!;

    expect(card.className).toContain("bg-surface");
    expect(card.className).toContain("border-border");
    for (const tone of TONES) expect(card.className).not.toContain(`bg-${tone}`);
  });

  it.each(TONES)("applies the %s wash and its matching border", (tone) => {
    const { container } = render(<Card tone={tone}>x</Card>);
    const card = container.firstElementChild!;

    expect(card.className).toContain(TONE_CARD[tone]);
    // The wash replaces the default surface rather than layering over it.
    expect(card.className).not.toContain("bg-surface");
  });

  it("keeps radius, shadow and padding whether or not a tone is set", () => {
    const plain = render(<Card pad="roomy">x</Card>).container.firstElementChild!;
    const toned = render(
      <Card pad="roomy" tone="mint">
        x
      </Card>,
    ).container.firstElementChild!;

    for (const card of [plain, toned]) {
      expect(card.className).toContain("rounded-card");
      expect(card.className).toContain("shadow-sm");
      expect(card.className).toContain("p-4");
    }
  });

  it("does not force a text colour, so content keeps --color-ink", () => {
    const { container } = render(<Card tone="peach">x</Card>);
    // A tinted card labels a region; it must not repaint everything inside it.
    expect(container.firstElementChild!.className).not.toMatch(/\btext-(peach|ink)-ink\b/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IconChip
// ═══════════════════════════════════════════════════════════════════════════

describe("IconChip", () => {
  it("is decorative by default, so a chip beside a label is not announced twice", () => {
    const { container } = render(<IconChip icon={<span>i</span>} />);
    const chip = container.firstElementChild!;

    expect(chip.getAttribute("aria-hidden")).toBe("true");
    expect(chip.getAttribute("role")).toBeNull();
  });

  it("becomes a named image when it is the only carrier of meaning", () => {
    render(<IconChip icon={<span>i</span>} label="Ирц" />);

    expect(screen.getByRole("img", { name: "Ирц" })).toBeInTheDocument();
  });

  it.each(TONES)("carries the %s surface and its paired ink", (tone) => {
    const { container } = render(<IconChip icon={<span>i</span>} tone={tone} />);
    expect(container.firstElementChild!.className).toContain(TONE_SURFACE[tone]);
  });

  it("scales without the call site choosing pixels", () => {
    const sm = render(<IconChip icon={<span>i</span>} size="sm" />).container.firstElementChild!;
    const xl = render(<IconChip icon={<span>i</span>} size="xl" />).container.firstElementChild!;

    expect(sm.className).toContain("size-8");
    expect(xl.className).toContain("size-16");
  });

  it("can keep transparent supplied artwork free of a tinted background", () => {
    const chip = render(<IconChip icon={<span>i</span>} tone="mint" surface={false} />).container
      .firstElementChild!;

    expect(chip).toHaveAttribute("data-icon-surface", "none");
    expect(chip.className).toContain("bg-transparent");
    expect(chip.className).not.toContain("bg-mint");
  });
});

describe("StatCard artwork", () => {
  it("can render supplied transparent artwork without a tinted icon surface", () => {
    const { container } = render(
      <StatCard label="Хүүхэд" value={12} art={<span>i</span>} artSurface={false} />,
    );
    const art = container.querySelector('[data-icon-surface="none"]');

    expect(art).not.toBeNull();
    expect(art!.className).toContain("bg-transparent");
    expect(art!.className).not.toContain("bg-sky");
  });
});

describe("supplied module artwork", () => {
  it.each([
    ["child", "icon-children-3d"],
    ["group", "icon-group-3d"],
    ["attendance", "icon-attendance-3d"],
    ["teacher", "icon-teacher-3d"],
    ["food", "icon-food-3d"],
    ["kindergarten", "icon-kindergarten-3d"],
    ["finance", "icon-finance-payment-3d"],
    ["portfolioDevelopment", "icon-portfolio-development-3d"],
    ["portfolioGallery", "icon-portfolio-gallery-3d"],
    ["portfolioAboutMe", "icon-portfolio-about-me-3d"],
    ["portfolioAgeComparison", "icon-portfolio-age-comparison-3d"],
  ] as const)("maps %s to its transparent owner-supplied asset", (name, asset) => {
    const { container } = render(<Art name={name} />);
    const icon = container.querySelector("img");

    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("src")).toContain(asset);
    expect(icon).toHaveAttribute("alt", "");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PageHeader — the new slots must not disturb the old behaviour
// ═══════════════════════════════════════════════════════════════════════════

describe("PageHeader", () => {
  it("renders title with no icon or meta, as every existing screen expects", () => {
    renderWithProviders(<PageHeader title="Хүүхдүүд" />);

    expect(screen.getByRole("heading", { name: "Хүүхдүүд" })).toBeInTheDocument();
    expect(screen.queryByTestId("header-icon")).not.toBeInTheDocument();
  });

  /**
   * ★ 2026-09-09 — the header draws neither the title nor the icon.
   *
   * Both came off on the client's instruction: the title duplicated the
   * sidebar row that had just been pressed, and once it was `sr-only` the
   * chip beside it had nothing to identify. `icon` stays in the signature
   * because nine screens pass one, so what this now pins is that passing one
   * is harmless — it is accepted and not painted — and that the heading
   * survives for assistive technology.
   */
  it("accepts an icon without drawing it, and keeps the heading", () => {
    renderWithProviders(
      <PageHeader title="Нүүр" icon={<IconChip icon={<span>i</span>} label="Нүүр" />} />,
    );

    expect(screen.queryByRole("img", { name: "Нүүр" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Нүүр" })).toBeInTheDocument();
  });

  it("renders the meta slot", () => {
    renderWithProviders(<PageHeader title="Ирц" meta={<span>32 хүүхэд</span>} />);

    expect(screen.getByText("32 хүүхэд")).toBeInTheDocument();
  });

  it("renders both together without losing the actions slot", () => {
    renderWithProviders(
      <PageHeader
        title="Судалгаа"
        icon={<IconChip icon={<span>i</span>} label="Судалгаа" />}
        meta={<span>3 идэвхтэй</span>}
        actions={<button type="button">Нэмэх</button>}
      />,
    );

    // The icon is not drawn (see above); `meta` and `actions` are what the
    // row still carries, and this is the case that keeps them from being lost
    // to each other's layout.
    expect(screen.queryByRole("img", { name: "Судалгаа" })).not.toBeInTheDocument();
    expect(screen.getByText("3 идэвхтэй")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Нэмэх" })).toBeInTheDocument();
  });

  it("wraps the meta row rather than forcing it onto one line", () => {
    renderWithProviders(<PageHeader title="X" meta={<span data-testid="chip">a</span>} />);

    // A row of chips at 375px is the width's decision, not a fixed count.
    expect(screen.getByTestId("chip").parentElement!.className).toContain("flex-wrap");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chart primitives
// ═══════════════════════════════════════════════════════════════════════════

describe("Ring", () => {
  it("clamps out-of-range percentages instead of drawing past the circle", () => {
    render(<Ring percent={140} label="Ирц" />);
    expect(screen.getByRole("img", { name: "Ирц" })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();

    render(<Ring percent={-20} label="Ирц2" />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("shows a dash rather than 0% when there is nothing to report", () => {
    render(<Ring percent={0} muted label="Бүртгээгүй" />);

    // "0%" would assert that nobody came; muted means nobody has marked yet.
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("is decorative unless named, because the figure is usually already on the card", () => {
    const { container } = render(<Ring percent={50} />);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Donut", () => {
  it("requires a name and reports one segment per non-zero value", () => {
    const { container } = render(
      <Donut
        label="Ирцийн хуваарилалт"
        segments={[
          { label: "Ирсэн", value: 20 },
          { label: "Өвчтэй", value: 5 },
          { label: "Хоосон", value: 0 },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "Ирцийн хуваарилалт" })).toBeInTheDocument();
    // Track + two drawn segments; the zero-value one draws nothing.
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });

  it("draws only the track when every value is zero, rather than dividing by it", () => {
    const { container } = render(<Donut label="Хоосон" segments={[{ label: "a", value: 0 }]} />);

    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("renders centre content", () => {
    render(<Donut label="X" segments={[{ label: "a", value: 1 }]} centre={<span>32</span>} />);
    expect(screen.getByText("32")).toBeInTheDocument();
  });
});

describe("BarRow", () => {
  it("names the bar with the caller's sentence, not a bare percentage", () => {
    render(<BarRow label="Хэл яриа" percent={40} accessibleLabel="Хэл яриа: 12 ажиглалт" />);

    // `progressbar` would announce "40 out of 100", which is not the fact.
    expect(screen.getByRole("img", { name: "Хэл яриа: 12 ажиглалт" })).toBeInTheDocument();
  });

  it("falls back to the visible label when no sentence is given", () => {
    render(<BarRow label="Танин мэдэхүй" percent={10} />);
    expect(screen.getByRole("img", { name: "Танин мэдэхүй" })).toBeInTheDocument();
  });

  it("clamps the fill width", () => {
    const { container } = render(<BarRow label="x" percent={999} />);
    const fill = container.querySelector('[role="img"] > div') as HTMLElement;

    expect(fill.style.width).toBe("100%");
  });
});

describe("Sparkline", () => {
  it("draws nothing for a single point, because one measurement is not a trend", () => {
    const { container } = render(<Sparkline values={[5]} label="Өсөлт" />);

    expect(screen.getByRole("img", { name: "Өсөлт" })).toBeInTheDocument();
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("plots a series with the newest at the right", () => {
    const { container } = render(<Sparkline values={[0, 10]} label="Өсөлт" />);
    const points = container.querySelector("polyline")!.getAttribute("points")!;

    // Lower value first => higher y (SVG grows downward); x runs 0 → 100.
    expect(points).toBe("0,100 100,0");
  });

  it("centres a flat series instead of dividing by a zero range", () => {
    const { container } = render(<Sparkline values={[7, 7, 7]} label="Тогтвортой" />);
    const points = container.querySelector("polyline")!.getAttribute("points")!;

    expect(points).toBe("0,50 50,50 100,50");
  });

  it("keeps the stroke even under a distorted viewBox", () => {
    const { container } = render(<Sparkline values={[1, 9]} label="x" />);

    expect(container.querySelector("polyline")!.getAttribute("vector-effect")).toBe(
      "non-scaling-stroke",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The tone vocabulary itself
// ═══════════════════════════════════════════════════════════════════════════

describe("the tone vocabulary", () => {
  it("covers every tone in all three maps, so a seventh cannot be half-added", () => {
    for (const tone of TONES) {
      expect(TONE_SURFACE[tone], `${tone} surface`).toBeTruthy();
      expect(TONE_CARD[tone], `${tone} card`).toBeTruthy();
      expect(TONE_VAR[tone], `${tone} var`).toBeTruthy();
    }
  });

  it("names only tokens that globals.css defines", () => {
    const css = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");
    for (const value of Object.values(TONE_VAR)) {
      const name = value.replace("var(", "").replace(")", "");
      expect(css, `${name} is undefined`).toContain(`${name}:`);
    }
  });
});
