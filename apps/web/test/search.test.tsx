import { screen, waitFor } from "@testing-library/react";
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
import ChildrenPage from "@/app/(app)/children/page";

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

const childrenPage = {
  items: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      lastName: "Ганболд",
      firstName: "Батбаяр",
      dateOfBirth: "2021-04-12",
      photoMediaFileId: null,
      enrollments: [],
    },
  ],
  page: 1,
  pageSize: 25,
  total: 1,
  totalPages: 1,
};

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

  it("the list seeds its search box from ?q= and filters by it", async () => {
    setSearchParams("q=Ганболд");
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children", body: childrenPage },
    ]);

    renderWithProviders(<ChildrenPage />);

    // The visible box carries the term, so the result set is explained rather
    // than looking like an unfiltered list that happens to be short.
    const field = await screen.findByLabelText("Хүүхдийн нэрээр хайх");
    await waitFor(() => expect(field).toHaveValue("Ганболд"));

    // …and the request actually asked for it.
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.startsWith("/children?") && c.url.includes("q=")),
      ).toBe(true),
    );
    const request = calls.find((c) => c.url.startsWith("/children?"))!;
    expect(decodeURIComponent(request.url)).toContain("q=Ганболд");
  });

  it("an empty ?q= leaves the box empty and asks for the whole roster", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children", body: childrenPage },
    ]);

    renderWithProviders(<ChildrenPage />);

    const field = await screen.findByLabelText("Хүүхдийн нэрээр хайх");
    expect(field).toHaveValue("");

    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/children?"))).toBe(true));
    expect(calls.find((c) => c.url.startsWith("/children?"))!.url).not.toContain("q=");
  });
});
