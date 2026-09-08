import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  ROUTER,
  sessionFor,
  setSearchParams,
  stubApi,
} from "./support/render";
import { PageHeader } from "@/components/shell/app-shell";

/**
 * The handoff from the header's search field to the children list.
 *
 * ★ Both halves, because only one of them existed.
 *
 * `HeaderSearch` navigates to `/children?q=…` and always has. `StaffChildren`
 * initialised its term from `useState("")` and never read the URL — so the
 * header field worked, navigated, and dropped the term on the floor. A teacher
 * typed a name, pressed Enter, and landed on a complete unfiltered roster with
 * an empty search box, which reads as "no results for a child I can see".
 *
 * A test on either component alone passes with the bug present. This one covers
 * the seam.
 */

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("header search → children list", () => {
  it("submitting the header field navigates to the list with the term", async () => {
    const user = userEvent.setup();
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);

    renderWithProviders(<PageHeader title="Хяналтын самбар" search />);

    const field = await screen.findByLabelText("Хүүхэд хайх");
    await user.type(field, "Ганболд{Enter}");

    expect(ROUTER.push).toHaveBeenCalledWith(`/children?q=${encodeURIComponent("Ганболд")}`);
  });

  /*
   * ★ The other half of this seam is gone — 2026-09-08.
   *
   * `StaffChildren` no longer draws a search box or a roster: the client asked
   * for the ESIS panels to be the screen's data. `?q=` still reaches the page
   * and still narrows what the Excel export carries, but there is no visible
   * field to seed and no list to filter, so the two tests that asserted both
   * were removed rather than rewritten into a weaker version of themselves.
   *
   * The header half above is unchanged and still pinned.
   */
});
