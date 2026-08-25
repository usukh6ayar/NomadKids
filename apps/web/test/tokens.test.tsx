import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

/**
 * The design tokens are the only vocabulary.
 *
 * ★ This asserts on source, and on the *shape* of a mistake rather than on any
 * one value.
 *
 * `globals.css` removed `--shadow-card` with a note explaining why: "a token
 * nobody reads is worse than no token — it looks like the single source of
 * truth while two other values are what actually ship". The radius tokens were
 * in that state when this was written. Four were defined; the product spelled
 * `rounded-[12px]` forty times, `rounded-[14px]` fifteen, `rounded-[18px]` nine,
 * and expressed one visual result three ways — `rounded-full` (17),
 * `rounded-pill` (6) and `rounded-[999px]` (4) — so a search for any one of them
 * found a third of the usages.
 *
 * Type was worse: twenty distinct sizes, with `.78rem`, `.8rem`, `.82rem` and
 * `text-xs` all in use. Four sizes inside a 1.1px band that nobody can see and
 * everybody editing had to choose between.
 *
 * Neither was a wrong value. Both were the same mistake — reaching for an
 * arbitrary value at the call site instead of a name — which is why the guard
 * is a ban on arbitrary values rather than a list of blessed numbers. A new
 * step in the scale is a deliberate edit to `globals.css`; it should not be
 * possible to add one by accident in a component.
 */

const WEB_ROOT = join(__dirname, "..");
const GLOBALS_CSS = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/**
 * The lines of a file that are actually markup.
 *
 * ★ Block-aware, because the prose in this codebase names the classes it is
 * arguing about.
 *
 * Half the value of these files is docblocks explaining why a token exists,
 * and those quote `text-sm` and `rounded-[12px]` constantly. A first version
 * skipped only lines *starting* with `*`, `//` or `/*`, and immediately flagged
 * the comment in `app-shell.tsx` explaining why the search field carries no
 * size class — a JSX block comment whose continuation lines start with plain
 * prose rather than with an asterisk.
 *
 * `//` is only honoured at the start of a line: `!from.startsWith("//")` in
 * `login/page.tsx` is a string, and treating it as a comment would blank the
 * rest of a real line and hide an offence.
 */
function markupLines(source: string): { line: string; number: number }[] {
  const out: { line: string; number: number }[] = [];
  let inBlock = false;

  source.split("\n").forEach((line, index) => {
    const wasInBlock = inBlock;

    // Net depth over the line: `{/* … */}` on one line opens and closes.
    const opens = (line.match(/\/\*/g) ?? []).length;
    const closes = (line.match(/\*\//g) ?? []).length;
    if (opens > closes) inBlock = true;
    else if (closes > opens) inBlock = false;

    const trimmed = line.trimStart();
    const isProse = wasInBlock || trimmed.startsWith("*") || trimmed.startsWith("//") || opens > 0;

    if (!isProse) out.push({ line, number: index + 1 });
  });

  return out;
}

function offences(pattern: RegExp): string[] {
  const found: string[] = [];

  for (const file of [
    ...sourceFiles(join(WEB_ROOT, "app")),
    ...sourceFiles(join(WEB_ROOT, "components")),
  ]) {
    const relative = file.slice(WEB_ROOT.length + 1);

    for (const { line, number } of markupLines(readFileSync(file, "utf8"))) {
      for (const match of line.matchAll(pattern)) {
        found.push(`${relative}:${number} → ${match[0]}`);
      }
    }
  }

  return found;
}

describe("the type scale", () => {
  it("defines seven steps and nothing between them", () => {
    for (const step of [
      "--text-caption",
      "--text-compact",
      "--text-body",
      "--text-lead",
      "--text-title",
      "--text-heading",
      "--text-display",
    ]) {
      expect(GLOBALS_CSS, `${step} is missing`).toContain(`${step}:`);
    }
  });

  it("is the only source of font sizes — no arbitrary values, no raw Tailwind steps", () => {
    // `text-[13px]`, `text-[.82rem]` — a size invented at the call site.
    const arbitrary = offences(/\btext-\[[.\d]+(?:px|rem|em)\]/g);
    // `text-sm`, `text-2xl` — Tailwind's scale rather than this product's.
    const untokenised = offences(/(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g);

    expect([...arbitrary, ...untokenised]).toEqual([]);
  });
});

describe("the radius scale", () => {
  it("expresses a fully rounded corner exactly one way", () => {
    // `rounded-full` and `rounded-[999px]` render identically to
    // `rounded-pill`. Three spellings meant a search for one found a third.
    expect(offences(/(?<![\w-])rounded-full(?![\w-])/g)).toEqual([]);
    expect(offences(/\brounded-\[999px\]/g)).toEqual([]);
  });

  it("is the only source of corner radii", () => {
    const arbitrary = offences(/\brounded(?:-[trbl][lr]?)?-\[[.\d]+(?:px|rem)\]/g);
    const untokenised = offences(/(?<![\w-])rounded-(?:sm|md|lg|xl|[2-9]xl|none)(?![\w-])/g);

    expect([...arbitrary, ...untokenised]).toEqual([]);
  });
});

describe("the icon set", () => {
  /**
   * ★ One icon library, so stroke weight is not a per-file decision.
   *
   * `app-shell.tsx` imported `Bell` and `Search` from lucide-react at the
   * default weight and then hand-rolled two more icons beside them at
   * `strokeWidth` 2 and 2.5 — three weights in one file, in a header where all
   * of them are visible at once. Nothing about a hand-written `<svg>` is wrong
   * on its own; the cost is that it has no scale, no weight and no viewBox in
   * common with the ones around it, and nobody notices until two sit adjacent.
   *
   * The `bg-[url('data:image/svg+xml…')]` in `field.tsx` is exempt: a CSS
   * background cannot be a React component, and the select's chevron has to be
   * paintable from a class.
   */
  it("has no hand-written <svg> markup", () => {
    const inline = offences(/<svg[\s>]/g).filter((hit) => !hit.includes("data:image/svg+xml"));

    // The scan reports `file:line → match`, so filter on the source line.
    const handRolled = inline.filter((hit) => {
      const [location] = hit.split(" → ");
      const [file, line] = location!.split(":");
      const source = readFileSync(join(WEB_ROOT, file!), "utf8").split("\n")[Number(line) - 1]!;
      return !source.includes("data:image/svg+xml");
    });

    expect(handRolled).toEqual([]);
  });
});

describe("the scale coexists with the colour utilities", () => {
  /**
   * ★ The bug this exists for was silent, total, and invisible in the source.
   *
   * tailwind-merge does not read the Tailwind config, so `text-lead` and the
   * rest of the scale are unknown names to it — and its rule for an
   * unrecognised `text-<something>` is to treat it as a **colour**. It saw
   * `text-primary-ink` and `text-lead` as two values of one property, kept the
   * later one, and dropped the colour. Every filled button in the product would
   * have shipped with default ink on blue-700 while `button.tsx` still plainly
   * read `text-primary-ink`.
   *
   * Asserting on `cn()`'s output rather than on a variant definition is the
   * whole point: the definition was never wrong.
   */
  it("a size and a colour survive each other", () => {
    const merged = cn("bg-primary text-primary-ink hover:bg-primary-hover", "h-[48px] text-lead");

    expect(merged).toContain("text-primary-ink");
    expect(merged).toContain("text-lead");
  });

  it("two sizes still collapse to the later one", () => {
    // The registration must not cost the deduplication `cn()` exists for.
    const merged = cn("text-body", "text-lead");

    expect(merged).toContain("text-lead");
    expect(merged).not.toContain("text-body");
  });

  it("every step of the scale is registered", () => {
    for (const step of ["caption", "compact", "body", "lead", "title", "heading", "display"]) {
      expect(cn("text-ink", `text-${step}`), `text-${step} evicts a colour`).toContain("text-ink");
    }
  });
});

describe("text controls stay at 16px", () => {
  /**
   * ★ Not a style preference — a trap iOS sets.
   *
   * Safari zooms the page when a focused field's text is under 16px and does
   * not zoom back out, leaving the user on a horizontally scrolled page. The
   * `input, textarea, select { font-size: 16px }` rule in globals.css is the
   * guard, and a utility class on a control beats it, because a class outranks
   * an element selector. The header's search field carried `text-sm` and was
   * doing exactly this.
   */
  it("no input, textarea or select carries a font-size class", () => {
    const controls = offences(
      /<(?:input|textarea|select)\b[^>]*\btext-(?:caption|compact|body|lead|title|heading|display|\[)/gs,
    );

    expect(controls).toEqual([]);
    expect(GLOBALS_CSS).toMatch(
      /input,\s*\n?\s*textarea,\s*\n?\s*select\s*\{[^}]*font-size:\s*16px/,
    );
  });
});
