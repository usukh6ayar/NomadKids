import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, ROUTER, sessionFor, setParams, stubApi } from "./support/render";
import AppLayout from "@/app/(app)/layout";
import { Providers } from "@/app/providers";
import { useSession } from "@/lib/auth/session";
import ChildrenPage from "@/app/(app)/children/page";
import AdminPage from "@/app/(app)/admin/page";
import ReviewQueuePage from "@/app/(app)/observations/review/page";

/**
 * Role isolation in the UI.
 *
 * ★★ These assert **navigation and affordances**, not data protection.
 *
 * The API is the security authority: it re-derives memberships, guardianships
 * and group assignments on every request, and a user who bypasses everything
 * tested here gets a different menu and exactly the same 404s. What these tests
 * protect is a different failure — a parent shown "Хянах" in their navigation,
 * tapping it, and landing on a screen that only ever errors.
 */

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
});

describe("navigation is built from the session's roles", () => {
  it("a teacher sees the staff navigation", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/notifications/unread-count", body: { count: 0 } },
    ]);

    renderWithProviders(
      <AppLayout>
        <div>агуулга</div>
      </AppLayout>,
    );

    // ★ The labels moved on 2026-08-28 when the client redrew the bottom bar
    // as Самбар · Мэдээ · Явцын үнэлгээ · Судалгаа · Цэс. The children list and
    // the review queue are still staff-only destinations — they are in the
    // sidebar sections now (and behind the phone's Цэс tab) rather than being
    // tabs of their own, which is what this is checking.
    //
    // ★★ "Хүүхдүүд" became "Хүүхдийн удирдлага" on 2026-08-30, when the sidebar
    // was rewritten to the client's reference grouping and took its row names
    // with it.
    await waitFor(() => expect(screen.getAllByText("Самбар").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Хүүхдийн удирдлага").length).toBeGreaterThan(0);
    // "Ажиглалт хянах" was asserted here until 2026-08-30, when the review
    // queues left the menu for the screens they belong to. Ирц is the
    // staff-only destination that replaced it as the check.
    expect(screen.getAllByText("Ирц").length).toBeGreaterThan(0);
    // Administration belongs to admins only.
    expect(screen.queryByText("Удирдлага")).toBeNull();
  });

  it("a parent sees the parent navigation and no staff-only destinations", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: "/notifications/unread-count", body: { count: 0 } },
    ]);

    renderWithProviders(
      <AppLayout>
        <div>агуулга</div>
      </AppLayout>,
    );

    // "Хавтас", then briefly `MY_CHILDREN` ("Миний хүүхдүүд"), renamed again
    // to "Зураг" to match the parent's own mock-up (`(app)/layout.tsx`'s
    // `parentNav`). The label renders regardless of where the tab's href
    // points — no `/children/mine` stub here, so `myChildren` never resolves
    // and `zuragHref` falls back to `/children`, but that only changes the
    // destination, not the text this assertion reads.
    await waitFor(() => expect(screen.getAllByText("Зураг").length).toBeGreaterThan(0));

    // ★ The review queue is a teacher's job. Offering it to a family would be a
    // menu item that only ever 404s.
    expect(screen.queryByText("Хянах")).toBeNull();
    expect(screen.queryByText("Удирдлага")).toBeNull();
  });

  it("an admin additionally sees Удирдлага", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: "/notifications/unread-count", body: { count: 0 } },
    ]);

    renderWithProviders(
      <AppLayout>
        <div>агуулга</div>
      </AppLayout>,
    );

    /*
      The admin entry is a sidebar section row rather than a bottom-bar tab
      since the 2026-08-29 nav change, and PR #16 renamed it from "Бүлэг,
      цэцэрлэгийн мэдээлэл" to "Удирдлага" in the same window — twenty-seven
      characters truncated to "Бүлэг, цэцэрлэгийн м…" in a 280px rail. This
      follows that name; the guarantee is unchanged.
    */
    await waitFor(() => expect(screen.getAllByText("Удирдлага").length).toBeGreaterThan(0));
  });

  /**
   * ★ A dual-role user is why the route tree is shared rather than split into
   * three route groups — the client has administrators whose own children
   * attend. They get one product, not two they must sign out of to switch.
   */
  it("a teacher who is also a parent gets the staff shell, not a broken hybrid", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER", "PARENT"]) },
      { path: "/notifications/unread-count", body: { count: 0 } },
    ]);

    renderWithProviders(
      <AppLayout>
        <div>агуулга</div>
      </AppLayout>,
    );

    /*
      A staff-only destination is what proves the staff shell rendered. This
      asserted "Ажиглалт хянах" until 2026-08-30, when the review queues moved
      onto the screens they belong to; "Бүлгийн бүртгэл"'s Ирц row is the
      staff-only entry that replaced it, and a parent's menu never has it.
    */
    await waitFor(() => expect(screen.getAllByText("Ирц").length).toBeGreaterThan(0));
  });
});

/**
 * ★ Regression: the signed-out session must not loop.
 *
 * The real failure, seen in a browser on `/login`: `/auth/me` answered 401, the
 * session query **threw**, the global `onError` handler read that as an expired
 * session and called `client.clear()`, which invalidated the session query,
 * which refetched and 401'd again — an endless `GET /v1/auth/me 401`.
 *
 * ★★ This exercises the **real** QueryClient from `providers.tsx`, not the
 * test harness's simplified one. An earlier version of this test used
 * `renderWithProviders`, which builds its own client with no `QueryCache`
 * onError — so the loop could not occur there and the test passed with the fix
 * reverted. A regression test that cannot fail is worse than none.
 */
describe("a signed-out visitor does not loop on /auth/me", () => {
  it("requests /auth/me exactly once for a 401", async () => {
    const { calls } = stubApi([{ path: "/auth/me", status: 401 }]);

    render(
      <Providers>
        <SessionReader />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent(/signed-out/));
    // Settle: a loop keeps issuing requests well after the first answer.
    await new Promise((r) => setTimeout(r, 250));

    const meCalls = calls.filter((c) => c.url.startsWith("/auth/me"));
    expect(meCalls.length, `/auth/me was requested ${meCalls.length} times`).toBe(1);
  });

  it("reports a 401 as signed out rather than as an error", async () => {
    stubApi([{ path: "/auth/me", status: 401 }]);

    render(
      <Providers>
        <SessionReader />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));
  });
});

/** Renders what `useSession` reports, so the test can assert on it. */
function SessionReader() {
  const { session, isLoading } = useSession();
  return (
    <span data-testid="state">
      {isLoading ? "loading" : session ? `signed-in:${session.user.username}` : "signed-out"}
    </span>
  );
}

describe("role-guarded screens", () => {
  it("redirects a parent away from the admin screen", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["PARENT"]) }]);

    renderWithProviders(<AdminPage />);

    // Sent to their own start page, not to /login — they are authenticated, and
    // a login form would be baffling.
    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/"));
  });

  it("redirects a parent away from the review queue", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["PARENT"]) }]);

    renderWithProviders(<ReviewQueuePage />);

    await waitFor(() => expect(ROUTER.replace).toHaveBeenCalledWith("/"));
  });

  it("sends a signed-out visitor to login with a return path", async () => {
    stubApi([{ path: "/auth/me", status: 401 }]);

    renderWithProviders(<AdminPage />);

    await waitFor(() =>
      expect(ROUTER.replace).toHaveBeenCalledWith(expect.stringContaining("/login")),
    );
  });
});

describe("the children screen adapts to who is asking", () => {
  it("a teacher gets the searchable roster", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/children",
        body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 },
      },
    ]);

    renderWithProviders(<ChildrenPage />);

    await waitFor(() => expect(screen.getByLabelText("Хүүхдийн нэрээр хайх")).toBeInTheDocument());
    expect(calls.some((c) => c.url.startsWith("/children?"))).toBe(true);
  });

  /**
   * A parent hits `/children/mine`, which is a different endpoint — not the
   * roster with a filter. The distinction matters: `/children` would return
   * their children too, but the slimmer route exists precisely so a family
   * screen never issues a query that could page through a kindergarten.
   */
  it("a parent gets their own children, with no search box", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: "/children/mine", body: [] },
    ]);

    renderWithProviders(<ChildrenPage />);

    await waitFor(() => expect(screen.getByText("Хүүхэд холбогдоогүй байна")).toBeInTheDocument());

    expect(screen.queryByLabelText("Хүүхдийн нэрээр хайх")).toBeNull();
    expect(calls.some((c) => c.url.startsWith("/children/mine"))).toBe(true);
  });
});
