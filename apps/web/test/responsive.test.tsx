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
    expect(GLOBALS_CSS).toContain("#f8f7f4"); // canvas
    expect(GLOBALS_CSS).toContain("#6c63ff"); // primary
    expect(GLOBALS_CSS).toContain("#26242b"); // ink
    expect(GLOBALS_CSS).toContain("#77737d"); // muted
    expect(GLOBALS_CSS).toContain("#e9e6e0"); // border
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
