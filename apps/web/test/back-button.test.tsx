import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTER, renderWithProviders, setPathname } from "./support/render";
import { BackButton } from "@/components/ui/back-button";
import { resetNavigationHistory, useNavigationHistory } from "@/lib/nav-history";

/**
 * "Буцах button дарахад хаанаас ч байсан нэг л ухрана" — the client,
 * 2026-09-08.
 *
 * ★ The bug was that Back was a link to the *parent route*, so it went where
 * the page's author expected the reader to have come from rather than where
 * they came from. A teacher opening a child from their group roster, or a
 * parent whose `/children` redirects, landed on a screen they had never seen.
 *
 * ★★ The fallback is the other half and is just as load-bearing: on a page
 * opened cold — a pasted URL, a new tab, a refresh — `router.back()` does
 * nothing at all, and a Back button that does nothing strands the reader.
 */

/** Stands in for the app shell, which is what counts navigations. */
function Shell({ children }: { children: React.ReactNode }) {
  useNavigationHistory();
  return <>{children}</>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetNavigationHistory();
  setPathname("/children/abc/general");
});

describe("Буцах", () => {
  it("goes to the fallback when the page was opened cold", async () => {
    renderWithProviders(
      <Shell>
        <BackButton href="/children" />
      </Shell>,
    );

    await userEvent.click(screen.getByRole("link", { name: /Буцах/ }));

    // The anchor was left alone, so the browser navigates to a real URL.
    expect(ROUTER.back).not.toHaveBeenCalled();
  });

  it("steps back once when the reader navigated here in-app", async () => {
    const { rerender } = renderWithProviders(
      <Shell>
        <BackButton href="/children" />
      </Shell>,
    );

    // One in-app navigation: the roster, then the child.
    setPathname("/children/abc/portfolio");
    rerender(
      <Shell>
        <BackButton href="/children" />
      </Shell>,
    );

    await userEvent.click(screen.getByRole("link", { name: /Буцах/ }));

    expect(ROUTER.back).toHaveBeenCalledTimes(1);
    expect(ROUTER.push).not.toHaveBeenCalled();
  });

  /*
   * ★ The label names no destination, because the button no longer knows one.
   * "Хүүхдийн жагсаалт" on a control that returns to the group roster is a
   * guess printed as a fact — the failure this component exists to fix.
   */
  it("says Буцах rather than naming a screen", () => {
    renderWithProviders(
      <Shell>
        <BackButton href="/children" />
      </Shell>,
    );

    const link = screen.getByRole("link", { name: /Буцах/ });
    expect(link).toHaveAttribute("href", "/children");
    expect(link).toHaveTextContent("Буцах");
  });

  it("lets a ⌘-click open the fallback in a new tab", async () => {
    const { rerender } = renderWithProviders(
      <Shell>
        <BackButton href="/children" />
      </Shell>,
    );
    setPathname("/children/abc/portfolio");
    rerender(
      <Shell>
        <BackButton href="/children" />
      </Shell>,
    );

    // `fireEvent` rather than `userEvent`: the modifier is the whole point of
    // the assertion, and it has to be on the click event the handler reads.
    fireEvent.click(screen.getByRole("link", { name: /Буцах/ }), { metaKey: true });

    expect(ROUTER.back).not.toHaveBeenCalled();
  });
});
