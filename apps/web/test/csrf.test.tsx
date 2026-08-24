import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, ROUTER, sessionFor, stubApi } from "./support/render";
import { currentCsrfToken, rememberCsrfToken } from "@/lib/api/csrf";
import { useLogout, useSession } from "@/lib/auth/session";
import LoginPage from "@/app/login/page";
import NotificationsPage from "@/app/(app)/notifications/page";

/**
 * The CSRF token under a split origin.
 *
 * ★ These tests model the deployed topology, which is the whole point.
 *
 * The web app is `https://nomadkids.mn` and the API is `https://api.nomadkids.mn`.
 * The API issues `kinder_csrf` as a host-only cookie on **its own** host, so the
 * browser attaches it to every request going there — and `document.cookie` on
 * the web origin cannot see it at all. Cookies scope by domain, not by site.
 *
 * jsdom's empty cookie jar is therefore not an accident of the test
 * environment; it is an accurate model of production. The previous
 * implementation read `document.cookie`, found nothing, sent no header, and
 * `CsrfGuard` answered 403 to every save.
 *
 * It never showed up in development because `localhost:3000` and
 * `localhost:3001` are the *same* cookie domain — ports are invisible to
 * cookies — so the web origin really could read the API's cookie there.
 *
 * The server half of this — that the token from the session body is the one the
 * guard accepts, and that a missing header is a 403 — is proved against the
 * real app and a real database in `apps/api/test/csrf-session-token.test.ts`.
 */

const NOTIFICATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function stubNotifications(csrfToken: string | null = "test-csrf") {
  return stubApi([
    { path: "/auth/me", body: { ...sessionFor(["PARENT"]), csrfToken } },
    {
      path: "/notifications",
      body: {
        items: [
          {
            id: NOTIFICATION_ID,
            title: "Аялал",
            body: "Маргааш аялалд явна",
            reads: [],
            targets: [],
          },
        ],
        page: 1,
        pageSize: 25,
        total: 1,
        totalPages: 1,
      },
    },
    { path: `/notifications/${NOTIFICATION_ID}/read`, method: "POST", body: {} },
  ]);
}

/** Opens the announcement, which marks it read — a real, protected mutation. */
async function markRead(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByText("Аялал")).toBeInTheDocument());
  await user.click(screen.getByText("Аялал"));
}

beforeEach(() => {
  // The store outlives a render, exactly as it does in a real page session.
  // Left over from a previous test it would let a broken implementation pass.
  rememberCsrfToken(null);

  // Nothing has ever set a cookie on the web origin, and nothing should.
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
});

describe("the CSRF token comes from the session, not from document.cookie", () => {
  it("sends the session's token on a mutation, with an empty cookie jar", async () => {
    const user = userEvent.setup();
    const { calls } = stubNotifications("session-issued-token");

    renderWithProviders(<NotificationsPage />);
    await markRead(user);

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.includes("/read"));
      expect(post, "the mutation was never sent").toBeDefined();
      expect(post!.headers["x-csrf-token"]).toBe("session-issued-token");
    });

    // The header cannot have come from a cookie, because there are none. This
    // is the assertion the old implementation could not pass.
    expect(document.cookie).toBe("");
  });

  it("never reads document.cookie", async () => {
    const user = userEvent.setup();
    const cookieGetter = vi.spyOn(document, "cookie", "get");
    stubNotifications();

    renderWithProviders(<NotificationsPage />);
    await markRead(user);

    await waitFor(() => expect(cookieGetter).not.toHaveBeenCalled());
  });

  /**
   * The regression guard with teeth. A stale or attacker-planted `kinder_csrf`
   * on the web origin must not be what goes out — only the session's own token
   * pairs with the cookie the browser sends to the API host.
   */
  it("ignores a same-named cookie on the web origin", async () => {
    const user = userEvent.setup();
    document.cookie = "kinder_csrf=cookie-on-the-wrong-origin; path=/";

    const { calls } = stubNotifications("session-issued-token");

    renderWithProviders(<NotificationsPage />);
    await markRead(user);

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.includes("/read"));
      expect(post?.headers["x-csrf-token"]).toBe("session-issued-token");
    });
  });
});

describe("session state", () => {
  function Probe() {
    const { csrfToken, isLoading } = useSession();
    return <div>{isLoading ? "loading" : `token:${csrfToken ?? "none"}`}</div>;
  }

  it("exposes the token the API reported", async () => {
    stubApi([{ path: "/auth/me", body: { ...sessionFor(["PARENT"]), csrfToken: "from-me" } }]);

    renderWithProviders(<Probe />);

    await waitFor(() => expect(screen.getByText("token:from-me")).toBeInTheDocument());
  });

  it("has no token when signed out", async () => {
    stubApi([{ path: "/auth/me", status: 401 }]);

    renderWithProviders(<Probe />);

    await waitFor(() => expect(screen.getByText("token:none")).toBeInTheDocument());
  });

  /**
   * Self-clearing is why the mirror is driven from the query's data rather than
   * written at each call site: `providers.tsx` clears the cache when a session
   * expires and `useLogout` clears it on the way out. Both drop the data, which
   * must drop the token — otherwise a signed-out page keeps sending a dead one.
   */
  it("forgets a stale token once the session is gone", async () => {
    rememberCsrfToken("stale-token-from-a-previous-session");
    stubApi([{ path: "/auth/me", status: 401 }]);

    renderWithProviders(<Probe />);

    await waitFor(() => expect(screen.getByText("token:none")).toBeInTheDocument());
    expect(currentCsrfToken()).toBeUndefined();
  });

  it("sends no header at all when there is no session", async () => {
    const user = userEvent.setup();
    const { calls } = stubNotifications(null);

    renderWithProviders(<NotificationsPage />);
    await markRead(user);

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.includes("/read"));
      expect(post).toBeDefined();
      expect(post!.headers["x-csrf-token"]).toBeUndefined();
    });
    // Which is what the API answers 403 to — see the server-side test.
  });
});

describe("signing out", () => {
  function LogoutButton() {
    const logout = useLogout();
    return (
      <button type="button" onClick={() => void logout()}>
        Гарах
      </button>
    );
  }

  /**
   * ★ Logout is itself a protected mutation.
   *
   * `POST /auth/logout` is not `@Public()` — it reads the actor — so it needs
   * the header like any other write. Under the old client it was one of the
   * requests that 403'd, and a logout that fails leaves the user signed in on
   * a shared kindergarten computer while the UI says they left.
   */
  it("sends the token on the logout request, then forgets it", async () => {
    const user = userEvent.setup();

    const { calls } = stubApi([
      { path: "/auth/me", body: { ...sessionFor(["TEACHER"]), csrfToken: "token-in-session" } },
      { path: "/auth/logout", method: "POST", status: 204 },
    ]);

    renderWithProviders(<LogoutButton />);

    // Wait for the session, or the token has not been mirrored yet.
    await waitFor(() => expect(currentCsrfToken()).toBe("token-in-session"));

    await user.click(screen.getByRole("button", { name: "Гарах" }));

    // The request itself must carry the header: `/auth/logout` is not
    // `@Public()`, so without it the API answers 403 and the session survives.
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.startsWith("/auth/logout"));
      expect(post, "logout was never sent").toBeDefined();
      expect(post!.headers["x-csrf-token"]).toBe("token-in-session");
    });

    /**
     * ★ And the token must be gone afterwards.
     *
     * This assertion caught a wrong assumption: `queryClient.clear()` does not
     * reset an active observer's data and does not refetch, so mirroring the
     * session alone left the token in memory after logout — the session query
     * still held the departed user's data. `useLogout` now forgets it
     * explicitly. Note the stub still answers `/auth/me` with a live session
     * here, which is what makes this a real test of the logout path rather than
     * of a 401 arriving.
     */
    await waitFor(() => expect(currentCsrfToken()).toBeUndefined());
    expect(ROUTER.replace).toHaveBeenCalledWith("/login");
  });
});

describe("signing in", () => {
  /**
   * Login is `@Public()` and needs no token, but its response carries one.
   * Taking it there closes the window between a successful login and the
   * `/auth/me` refetch — a save made in that gap would otherwise go out bare.
   */
  it("remembers the token from the login response", async () => {
    const user = userEvent.setup();

    stubApi([
      { path: "/auth/me", status: 401 },
      {
        path: "/auth/login",
        method: "POST",
        body: { ...sessionFor(["TEACHER"]), csrfToken: "issued-at-login" },
      },
      { path: "/dashboard/primary", body: { dashboard: "teacher" } },
    ]);

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/Нэвтрэх нэр, утас эсвэл и-мэйл/), "bagsh");
    await user.type(screen.getByLabelText("Нууц үг *"), "нууц-үг");
    await user.click(screen.getByRole("button", { name: "Нэвтрэх" }));

    await waitFor(() => expect(currentCsrfToken()).toBe("issued-at-login"));
  });
});
