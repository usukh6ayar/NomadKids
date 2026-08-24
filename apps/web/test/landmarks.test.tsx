import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import ParentHomePage from "@/app/(app)/home/page";

/**
 * Every labelled landmark actually has a name.
 *
 * ★ Why this is a source scan and not only a render test.
 *
 * `<section aria-labelledby="recent-heading">` with no `#recent-heading` in the
 * document does not fall back to the section's content — it **erases** the
 * accessible name, leaving an unnamed region. Nothing warns: the markup reads
 * correctly, the screen looks correct, and the only symptom is a screen reader
 * announcing "region" where it should announce "Сүүлийн мөчүүд".
 *
 * That is how fourteen of them accumulated across seven files. `SectionHeader`
 * had no way to emit an id, so every caller that wanted `aria-labelledby`
 * pointed at one that was never rendered. Two dashboard components worked
 * around it with `aria-label` and left comments explaining why; the rest of the
 * app did not.
 *
 * A render test proves today's screens. The scan below proves the *next* one
 * too, which is the failure mode that matters — the mistake is invisible at
 * review, so the guard has to be mechanical.
 */

const WEB_ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** `aria-labelledby="x"` and ``aria-labelledby={`x-${n}`}`` alike. */
const REFERENCE = /aria-labelledby=(?:"([^"]+)"|\{`([^`]+)`\})/g;
const DEFINITION = /\bid=(?:"([^"]+)"|\{`([^`]+)`\})/g;

describe("landmark naming", () => {
  it("every aria-labelledby in the app resolves to an id that is rendered", () => {
    const files = [
      ...sourceFiles(join(WEB_ROOT, "app")),
      ...sourceFiles(join(WEB_ROOT, "components")),
    ];

    const defined = new Set<string>();
    const referenced: { id: string; file: string }[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const relative = file.slice(WEB_ROOT.length + 1);

      for (const match of source.matchAll(DEFINITION)) {
        defined.add((match[1] ?? match[2])!);
      }

      for (const match of source.matchAll(REFERENCE)) {
        const id = (match[1] ?? match[2])!;
        // The docblock in `card.tsx` spells the pattern out in prose; it is
        // documentation, not markup.
        if (id.includes("…")) continue;
        referenced.push({ id, file: relative });
      }
    }

    // Guards the guard: if the regex stops matching, an empty set would pass.
    expect(referenced.length).toBeGreaterThan(10);

    const dangling = referenced.filter((r) => !defined.has(r.id));
    expect(
      dangling.map((r) => `${r.file} → aria-labelledby="${r.id}" has no matching id`),
    ).toEqual([]);
  });
});

function childFixture(id: string, firstName: string) {
  return {
    id,
    lastName: "Ганболд",
    firstName,
    dateOfBirth: "2021-04-12",
    photoMediaFileId: null,
    group: null,
    assessments: [],
  };
}

function stubParentHome(children: ReturnType<typeof childFixture>[]) {
  stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    { path: "/dashboard/parent", body: { children, recent: [], currentTerm: null } },
  ]);
}

describe("a parent's home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearchParams("");
  });

  it("names its sections so a screen reader can announce them", async () => {
    stubParentHome([childFixture("44444444-4444-4444-8444-444444444444", "Батбаяр")]);

    renderWithProviders(<ParentHomePage />);

    // The name comes from the heading the section already renders — which is
    // the whole point of passing an id rather than repeating the string in an
    // `aria-label` that can drift away from it.
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Сүүлийн мөчүүд" })).toBeInTheDocument(),
    );
  });

  /**
   * ★ The child switcher claims only what it implements.
   *
   * It declared `role="tablist"`/`role="tab"` with no tabpanels, no
   * `aria-controls` and no arrow-key handling — a promise of structure that was
   * not there. These assertions are written as the *absence* of the tab roles
   * plus the presence of the pressed state, because the visual result is
   * identical either way: nothing on screen changes when this regresses.
   */
  it("offers the child switcher as pressable buttons, not as tabs", async () => {
    stubParentHome([
      childFixture("44444444-4444-4444-8444-444444444444", "Батбаяр"),
      childFixture("55555555-5555-4555-8555-555555555555", "Сарнай"),
    ]);

    renderWithProviders(<ParentHomePage />);

    const group = await screen.findByRole("group", { name: "Хүүхэд сонгох" });
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(screen.queryByRole("tablist")).toBeNull();

    const [first, second] = within(group).getAllByRole("button");
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(second!);
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
  });
});
