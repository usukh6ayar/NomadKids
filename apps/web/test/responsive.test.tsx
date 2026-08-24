import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";

/**
 * The sizing and overflow contract.
 *
 * ★ These assert on **class strings and CSS source**, not on rendered geometry.
 *
 * jsdom has no layout engine: every element is 0×0, so `getBoundingClientRect`
 * would return zeros and any test of real pixel heights would pass while
 * asserting nothing. A test that cannot fail is worse than no test, so these
 * check the thing that actually determines the size — the utility class and
 * the token — and the browser is trusted to apply it.
 *
 * What they protect: someone adding a "compact" 32px button variant, or a
 * 14px input that makes iOS zoom the page and leave the user scrolled sideways
 * with no way back.
 */

const GLOBALS_CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * ★ Computed here rather than trusted from a palette tool, because the whole
 * point is that these ratios are invisible to the person choosing the colour.
 * The formula is the specification's: linearise each channel, weight by
 * 0.2126/0.7152/0.0722, then `(lighter + 0.05) / (darker + 0.05)`.
 */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe("touch targets", () => {
  it("every button size is at least 44px", () => {
    const sizes = ["md", "sm", "lg", "icon"] as const;

    for (const size of sizes) {
      const { container, unmount } = render(<Button size={size}>Товч</Button>);
      const className = container.firstElementChild!.className;

      const match = /h-\[(\d+)px\]/.exec(className);
      expect(match, `size="${size}" has no explicit height`).not.toBeNull();
      expect(Number(match![1]), `size="${size}" is below the 44px floor`).toBeGreaterThanOrEqual(
        44,
      );

      unmount();
    }
  });

  it("a text input is 48px, matching the primary button", () => {
    const { container } = render(<Input aria-label="Тест" />);
    expect(container.querySelector("input")!.className).toContain("h-[48px]");
  });

  it("a select is 48px", () => {
    const { container } = render(
      <Select aria-label="Тест">
        <option>А</option>
      </Select>,
    );
    expect(container.querySelector("select")!.className).toContain("h-[48px]");
  });

  it("a checkbox row is at least 44px tall, so the label is part of the target", () => {
    const { container } = render(<Checkbox label="Сонголт" />);
    expect(container.firstElementChild!.className).toContain("min-h-[44px]");
  });
});

/**
 * ★ iOS zooms a focused input whose text is under 16px, and does not zoom back
 * out. The user is left on a horizontally scrolled page — which is exactly the
 * "zero horizontal overflow" requirement, broken by a font size.
 */
describe("text entry is never below 16px", () => {
  it("globals.css forces 16px on every text control", () => {
    const rule = /input,\s*textarea,\s*select\s*\{[^}]*font-size:\s*16px/;
    expect(GLOBALS_CSS).toMatch(rule);
  });
});

describe("horizontal overflow", () => {
  it("the page itself never scrolls sideways", () => {
    expect(GLOBALS_CSS).toMatch(/html\s*\{[^}]*overflow-x:\s*hidden/);
  });

  /**
   * Mongolian Cyrillic words are long. Without this a kindergarten's full name
   * or a parent's email pushes the layout wider than a 375px screen.
   */
  it("long words wrap rather than widening the layout", () => {
    expect(GLOBALS_CSS).toMatch(/overflow-wrap:\s*break-word/);
  });
});

describe("focus is always visible", () => {
  it("the focus ring is defined globally and never removed", () => {
    expect(GLOBALS_CSS).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    // `outline: none` anywhere in the global sheet would silently disable
    // keyboard navigation for the whole product.
    expect(GLOBALS_CSS).not.toMatch(/outline:\s*none/);
  });
});

describe("form fields", () => {
  it("every field has a visible label bound to its control", () => {
    render(
      <Field label="Овог">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>,
    );

    // Found *by its label* — the association is real, not visual adjacency.
    expect(screen.getByLabelText("Овог")).toBeInTheDocument();
  });

  /**
   * An error must be announced, not merely coloured. A red border is invisible
   * to a screen reader and to anyone who cannot distinguish it.
   */
  it("an error is announced and referenced by the control", () => {
    render(
      <Field label="И-мэйл" error="И-мэйл буруу байна">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("И-мэйл буруу байна");

    const input = screen.getByLabelText("И-мэйл");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("a required field is marked for assistive technology, not only with a red star", () => {
    render(
      <Field label="Нэр" required>
        {({ id }) => <Input id={id} required />}
      </Field>,
    );

    expect(screen.getByLabelText(/Нэр/)).toBeRequired();
  });

  it("a textarea is tall enough to write a paragraph in", () => {
    const { container } = render(<Textarea aria-label="Тайлбар" />);
    expect(container.querySelector("textarea")!.className).toContain("min-h-[112px]");
  });
});

describe("design tokens", () => {
  it("defines the approved palette", () => {
    // The brief names these exactly; a drifted hex is a visual regression no
    // screenshot test would catch either.
    // ★ Repainted twice. 2026-08-22: white ground, sky blue accent.
    // 2026-08-23: the E-Mongolia deep blue with slate typography. The approved
    // Phase 1 palette (PHASE_1_ACCEPTANCE item 15) is two directions behind and
    // needs re-confirming before sign-off.
    expect(GLOBALS_CSS).toContain("#f8fafc"); // canvas — slate-50
    expect(GLOBALS_CSS).toContain("#1d4ed8"); // primary — blue-700
    expect(GLOBALS_CSS).toContain("#1e40af"); // primary-strong/hover — blue-800
    expect(GLOBALS_CSS).toContain("#eff6ff"); // primary-soft — blue-50
    expect(GLOBALS_CSS).toContain("#1e293b"); // ink — slate-800
    expect(GLOBALS_CSS).toContain("#64748b"); // muted — slate-500
    expect(GLOBALS_CSS).toContain("#e2e8f0"); // border — slate-200
    expect(GLOBALS_CSS).toContain("#f1f5f9"); // track — slate-100
  });

  /**
   * ★ The sky palette left exactly one trap behind, and this is it.
   *
   * `--color-primary-bright` (sky-500) existed because sky could not carry a
   * white label — 2.77:1 — so the brand colour and the text-bearing fill had to
   * be two different values. blue-700 does both, so the token was deleted. If it
   * comes back, some surface is about to be painted a colour that was chosen
   * under the old constraint, and the button is the first thing to break.
   */
  it("has no leftover 'bright' primary from the sky palette", () => {
    expect(GLOBALS_CSS).not.toContain("--color-primary-bright");
    expect(GLOBALS_CSS).not.toContain("#0ea5e9");
  });

  /**
   * ★ Measured, not eyeballed.
   *
   * RFP §13 requires sufficient contrast, and the button is where a repaint
   * breaks it first: this is the third palette this project has shipped, and the
   * second one failed here before the ratio was computed.
   *
   * Both halves are asserted — the ratio *and* the class the Button actually
   * ships — because either one alone passes while the pair is broken.
   */
  it("the filled button pairs blue-700 with a white label, clearing 4.5:1", () => {
    expect(contrast("#1d4ed8", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#1e40af", "#ffffff")).toBeGreaterThanOrEqual(4.5); // hover
    expect(GLOBALS_CSS).toContain("--color-primary: #1d4ed8");

    const { container } = render(<Button>Товч</Button>);
    const className = container.firstElementChild!.className;
    expect(className).toContain("bg-primary");
    expect(className).toContain("text-primary-ink");
    expect(className).toContain("font-medium");
  });

  /**
   * The tinted back used for avatars, active menu rows and informational chips.
   * `--color-primary` is the text that sits on it, so the pair has to clear the
   * bar in its own right — a soft tint is exactly where this gets forgotten.
   */
  it("coloured text on the soft tint clears 4.5:1", () => {
    expect(contrast("#1d4ed8", "#eff6ff")).toBeGreaterThanOrEqual(4.5);
    expect(GLOBALS_CSS).toContain("--color-primary-soft: #eff6ff");
  });

  /**
   * ★ The one pairing in this palette that does NOT clear the bar.
   *
   * `--color-muted` on `--color-track` is 4.34:1. Neither is a mistake on its
   * own — slate-500 is 4.76:1 on white and the track only ever holds a progress
   * fill — but the two are one careless `text-muted` away from shipping unread
   * secondary text. Asserted as a known-bad pair so the number is written down
   * rather than rediscovered.
   */
  it("records that muted text must not be placed on the progress track", () => {
    expect(contrast("#64748b", "#f1f5f9")).toBeLessThan(4.5);
    expect(contrast("#64748b", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  /** The unread badge is red now, and carries a white number. */
  it("the unread badge clears 4.5:1 against white text", () => {
    expect(contrast("#c0392b", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(GLOBALS_CSS).toContain("--color-danger: #c0392b");
  });

  it("every accent ink clears 4.5:1 on its own tint", () => {
    const pairs: [string, string, string][] = [
      ["mint", "#bfe8d4", "#1f6b4d"],
      ["sky", "#cde7f7", "#1d4e89"],
      ["sun", "#f8e6a0", "#7a5810"],
      ["peach", "#f8d5c2", "#9a4a25"],
    ];
    for (const [name, tint, ink] of pairs) {
      expect(GLOBALS_CSS).toContain(ink);
      expect(contrast(tint, ink), `${name} badge text`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("defines the sizing floors as tokens", () => {
    expect(GLOBALS_CSS).toMatch(/--size-control:\s*48px/);
    expect(GLOBALS_CSS).toMatch(/--size-tap:\s*44px/);
    expect(GLOBALS_CSS).toMatch(/--radius-control:\s*12px/);
  });

  it("respects a reduced-motion preference", () => {
    expect(GLOBALS_CSS).toContain("prefers-reduced-motion");
  });
});
