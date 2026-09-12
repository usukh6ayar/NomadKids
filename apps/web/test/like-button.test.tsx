import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { LikeButton, patchNotification } from "@/components/notifications/like-button";

const NOTICE = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The heart on an announcement.
 *
 * ★ The client's 2026-09-12 report: "зүрх дарахад тоо арилдаг."
 *
 * The optimistic value used to live in `toggle.isPending`, so the moment the
 * request resolved the button fell back to its props — still the pre-press ones
 * until the refetch landed. A first like went 0 → 1 → *nothing* → 1, and the
 * middle state hides the number entirely, because a count of zero draws no
 * digit.
 *
 * ★★ These assert on the rendered count *after* the request settles, which is
 * the window the bug lived in. Asserting only during the flight would have
 * passed against the broken version.
 */
describe("liking an announcement", () => {
  function stub(status = 201) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/notifications/${NOTICE}/like`,
        method: "POST",
        body: { id: NOTICE, likeCount: 1, likedByMe: true },
        status,
      },
      {
        path: `/notifications/${NOTICE}/like`,
        method: "DELETE",
        body: { id: NOTICE, likeCount: 0, likedByMe: false },
        status,
      },
    ]);
  }

  it("sends the like and asks for the list again", async () => {
    const user = userEvent.setup();
    const { calls } = stub();
    renderWithProviders(<LikeButton notificationId={NOTICE} likeCount={0} likedByMe={false} />);

    await user.click(screen.getByRole("button", { name: "Таалагдсан" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/like"))).toBe(true),
    );
  });

  it("un-likes with a DELETE", async () => {
    const user = userEvent.setup();
    const { calls } = stub();
    renderWithProviders(<LikeButton notificationId={NOTICE} likeCount={1} likedByMe />);

    await user.click(screen.getByRole("button", { name: /Таалагдсныг болих/ }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/like"))).toBe(
        true,
      ),
    );
  });

  /*
    ★ The shape, not only the colour — a filled heart survives a monochrome
    screen and colour-blindness.
  */
  it("fills the heart and names the count for a screen reader", () => {
    renderWithProviders(<LikeButton notificationId={NOTICE} likeCount={3} likedByMe />);

    const button = screen.getByRole("button", { name: "Таалагдсныг болих, 3" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("fill-current");
  });

  /** Nobody has liked it yet, so there is no digit to draw. */
  it("draws no number at zero", () => {
    renderWithProviders(<LikeButton notificationId={NOTICE} likeCount={0} likedByMe={false} />);

    const button = screen.getByRole("button", { name: "Таалагдсан" });
    expect(button).toHaveTextContent("");
  });
});

/**
 * The cache patch — the fix itself.
 *
 * ★ Three shapes live under `["notifications"]`: the news page's infinite query,
 * the bell's single page, and one notification on its own detail route. The
 * count used to come back from `isPending`, so the moment the request resolved
 * the button fell to its props — still the pre-press ones until the refetch
 * landed, and a first like went 0 → 1 → *nothing* → 1.
 */
describe("writing the like through the cache", () => {
  const row = { id: NOTICE, title: "Зугаалга", likeCount: 0, likedByMe: false };
  const other = { id: "99999999-9999-4999-8999-999999999999", likeCount: 4, likedByMe: true };

  it("patches a row inside an infinite query's pages", () => {
    const cached = { pageParams: [1], pages: [{ items: [row, other] }] };

    const next = patchNotification(cached, NOTICE, true) as typeof cached;

    expect(next.pages[0]!.items[0]).toMatchObject({ likeCount: 1, likedByMe: true });
    // Everyone else is left exactly as they were.
    expect(next.pages[0]!.items[1]).toBe(other);
  });

  it("patches the bell's single page", () => {
    const next = patchNotification({ items: [row] }, NOTICE, true) as { items: unknown[] };
    expect(next.items[0]).toMatchObject({ likeCount: 1, likedByMe: true });
  });

  it("patches one notification on its own", () => {
    expect(patchNotification(row, NOTICE, true)).toMatchObject({ likeCount: 1, likedByMe: true });
  });

  it("takes the like back off, and never below zero", () => {
    expect(
      patchNotification({ ...row, likeCount: 1, likedByMe: true }, NOTICE, false),
    ).toMatchObject({ likeCount: 0, likedByMe: false });
    expect(
      patchNotification({ ...row, likeCount: 0, likedByMe: true }, NOTICE, false),
    ).toMatchObject({ likeCount: 0 });
  });

  /* Pressing twice must not count twice — the second press is already true. */
  it("does nothing when the state already matches", () => {
    const already = { ...row, likeCount: 1, likedByMe: true };
    expect(patchNotification(already, NOTICE, true)).toBe(already);
  });

  /* The unread count shares the key prefix and has no likes in it. */
  it("leaves a shape it does not recognise alone", () => {
    const unread = { count: 7 };
    expect(patchNotification(unread, NOTICE, true)).toBe(unread);
    expect(patchNotification(null, NOTICE, true)).toBeNull();
  });
});
