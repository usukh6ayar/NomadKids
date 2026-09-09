import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { SectionHeader } from "@/components/ui/card";
import DashboardPage from "@/app/(app)/dashboard/page";

/**
 * The page title's typography, and who is named on screen.
 *
 * ★ Class strings, not geometry — jsdom has no layout engine, so the same
 * reasoning as `responsive.test.tsx` applies: assert the utility that decides
 * the outcome and trust the browser to apply it.
 */

const emptyDashboard = {
  counts: { children: 0, groups: 0, pendingReviews: 0, observationsThisWeek: 0 },
  needsAttention: { childrenMissingAssessment: [], pendingReviews: 0 },
  recentObservations: [],
  currentTerm: null,
  birthdaysToday: [],
  termProgress: { assessed: 0, total: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("heading hierarchy", () => {
  /**
   * ★ The regression this exists for.
   *
   * Tailwind's preflight resets heading weight to `inherit`. `PageHeader`'s
   * `<h1>` set a size and no weight, so it rendered at 400 while
   * `SectionHeader`'s `<h2>` renders at 600 — every section heading on every
   * screen was heavier than the page title above it. Nothing about the markup
   * looks wrong; the `<h1>` is a real `<h1>` and the outline is correct. Only
   * the visual weight was inverted.
   */
  /** The compact header still gives every screen a visible top-level name. */
  it("renders one compact, visible page heading", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["PARENT"]) }]);

    const { container } = renderWithProviders(<PageHeader title="Гарчиг" />);
    const h1 = await waitFor(() => container.querySelector("h1")!);

    expect(h1).toHaveTextContent("Гарчиг");
    expect(h1.className).toContain("text-display");
    expect(h1.className).not.toContain("sr-only");

    // The section headings below it are still the visible hierarchy.
    const { container: section } = render(<SectionHeader title="Дэд гарчиг" />);
    expect(section.querySelector("h2")!.className).toContain("font-semibold");
  });

  /**
   * The dashboard's failed branch and its loaded branch, compared.
   *
   * ★ Not the loading branch, deliberately. Both stubs here resolve on a
   * microtask, so "assert before the query settles" would be a race — a test
   * that passes on a fast machine and fails on a loaded one is worse than no
   * test. The failure branch is reached deterministically (a 500), renders the
   * same helper, and catches the same regression: three hand-rolled titles that
   * disagreed with the one `PageHeader` renders.
   */
  it("the dashboard title is identical whether the request failed or succeeded", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/dashboard/teacher", status: 500, body: { title: "Алдаа", status: 500 } },
    ]);

    const failed = renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const whenFailed = failed.container.querySelector("h1")!.className;
    expect(whenFailed).toContain("text-display");
    failed.unmount();

    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/dashboard/teacher", body: emptyDashboard },
    ]);

    const loaded = renderWithProviders(<DashboardPage />);
    // Any string from the loaded branch's quick-action tiles signals the query
    // has settled.
    await waitFor(() => expect(screen.getByText("Ирц")).toBeInTheDocument());

    expect(loaded.container.querySelector("h1")!.className).toBe(whenFailed);
  });
});

/**
 * Renders "ready" once `/auth/me` has answered.
 *
 * ★ Without it these assertions pass for the wrong reason. `PageHeader` renders
 * its title synchronously, so a `waitFor` on the title resolves on the first
 * tick — before the session query settles, while `fullName(null)` is still "—".
 * A "the name is absent" assertion then holds no matter what the component
 * does. Confirmed the hard way: with the fix reverted, the test still passed.
 */
function SessionProbe() {
  const { session } = useSession();
  return <span data-testid="probe">{session ? "ready" : "pending"}</span>;
}

async function renderHeaderFor(role: "TEACHER" | "PARENT", title: string) {
  stubApi([{ path: "/auth/me", body: sessionFor([role]) }]);

  renderWithProviders(
    <>
      <SessionProbe />
      <PageHeader title={title} />
    </>,
  );

  await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("ready"));
}

describe("who is signed in appears once", () => {
  /**
   * ★ Every audience has a sidebar, and the sidebar already says who they are.
   *
   * The pill rendered for everyone from `lg` up — the exact width at which
   * `WhoAmI` is visible in the sidebar with the same name, describing the same
   * person as "Багш" in one place and "Багшийн хэсэг" in the other. `AppShell`
   * gives every role — teacher, parent, admin, platform operator — that same
   * desktop sidebar (`(app)/layout.tsx`: "Every role gets the sidebar from
   * `lg` up"), so this holds for a parent exactly as it does for a teacher.
   */
  it("a teacher's name is not repeated in the header", async () => {
    await renderHeaderFor("TEACHER", "Хяналтын самбар");

    expect(screen.queryByText("Тест Хэрэглэгч")).toBeNull();
  });

  it("a parent's name is not repeated in the header either", async () => {
    await renderHeaderFor("PARENT", "Нүүр");

    expect(screen.queryByText("Тест Хэрэглэгч")).toBeNull();
  });
});
