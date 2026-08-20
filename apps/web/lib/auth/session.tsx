"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { sessionSchema, type Role, type Session } from "@kinder/contracts";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { rememberCsrfToken } from "@/lib/api/csrf";
import { qk } from "@/lib/api/keys";
import { ApiError } from "@/lib/api/client";

/**
 * Who is signed in.
 *
 * ★ There is exactly one source of truth: `GET /v1/auth/me`, cached under one
 * query key. The session is **not** mirrored into React state, context state or
 * localStorage — the brief forbids duplicating auth state, and the reason is
 * concrete: a copy goes stale when a membership is revoked, and the UI then
 * shows a teacher navigation whose every request 404s.
 *
 * The access token itself is never visible here. It lives in an HttpOnly cookie
 * the browser attaches automatically; this hook only knows *who* the server
 * says you are.
 *
 * ★★ Roles here are **UX only**. They decide which navigation renders. They do
 * not decide what data anyone may read — the API re-derives that on every
 * request from memberships, guardianships and group assignments, and it is the
 * only authority. A user who edits `role` in devtools gets a different menu and
 * the same 404s.
 */

interface SessionValue {
  session: Session | null;
  isLoading: boolean;
  roles: Set<Role>;
  hasRole: (role: Role) => boolean;
  /** Kindergartens where this user holds any membership. */
  kindergartenIds: string[];
  /** The first kindergarten — most staff belong to exactly one. */
  primaryKindergartenId: string | null;
  /**
   * The double-submit CSRF token for this session, as the API reported it.
   *
   * Exposed for visibility and for tests; components do not need it, because
   * `mutate()` attaches it itself from `lib/api/csrf`.
   */
  csrfToken: string | null;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: qk.session(),
    /**
     * ★ A 401 here resolves to `null`; it is never thrown.
     *
     * "Signed out" is the ordinary state of this endpoint, not a failure. When
     * it threw, the global `onError` handler treated it as an expired session
     * and cleared the cache — which invalidated this very query, which refetched,
     * which 401'd again. On `/login`, where nobody is signed in by definition,
     * that was an endless loop of `GET /v1/auth/me 401` in the console.
     *
     * Any other error still throws, so a genuine outage is not silently rendered
     * as "signed out".
     */
    queryFn: async () => {
      try {
        return await get("/auth/me", sessionSchema);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    // A 401 is answered above, and nothing else here is worth retrying.
    retry: false,
    // The session rarely changes and every screen reads it; refetching on each
    // focus would add a request to every tab switch for no benefit.
    staleTime: 5 * 60_000,
  });

  /**
   * ★ The CSRF token is mirrored out of the session, not read from a cookie.
   *
   * `mutate()` is a plain function called from mutation callbacks, so it cannot
   * read this context. It reads `lib/api/csrf` instead, and this is the one
   * place that writes it.
   *
   * Mirroring from `data` rather than from inside the queryFn means it follows
   * the session however it changes — including a 401, which lands here as
   * `null`.
   *
   * ★ It does **not** cover `queryClient.clear()`, and that was measured, not
   * assumed. `clear()` removes the query but does not reset an active
   * observer's `data` or trigger a refetch, so this effect never re-runs and a
   * token would survive a logout. The two places that clear the cache therefore
   * forget the token explicitly — `useLogout` below, and `providers.tsx` on
   * session expiry. `apps/web/test/csrf.test.tsx` holds both paths down.
   */
  useEffect(() => {
    rememberCsrfToken(data?.csrfToken ?? null);
  }, [data]);

  const value = useMemo<SessionValue>(() => {
    const session = data ?? null;
    const roles = new Set((session?.memberships ?? []).map((m) => m.role));
    const kindergartenIds = [...new Set((session?.memberships ?? []).map((m) => m.kindergartenId))];

    return {
      session,
      isLoading,
      roles,
      hasRole: (role) => roles.has(role),
      kindergartenIds,
      primaryKindergartenId: kindergartenIds[0] ?? null,
      csrfToken: session?.csrfToken ?? null,
    };
  }, [data, isLoading]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}

/**
 * Signs out.
 *
 * Clears the whole query cache, not just the session key. Anything cached
 * belongs to the person who just left — leaving a child's observations in
 * memory for the next person to sign in on a shared kindergarten computer is
 * the exact scenario this product cannot afford.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return async () => {
    try {
      await mutate("/auth/logout", z.unknown(), { method: "POST" });
    } catch (error) {
      // A failed logout must still clear the client. The cookie may already be
      // gone, and stranding the user in a half-signed-in state is worse than a
      // silent server error.
      if (!(error instanceof ApiError)) throw error;
    } finally {
      queryClient.clear();
      // `clear()` does not reset the session observer, so the mirror above will
      // not fire — the token has to be dropped by hand or it outlives the
      // session that owned it.
      rememberCsrfToken(null);
      router.replace("/login");
    }
  };
}
