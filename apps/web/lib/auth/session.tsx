"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { sessionSchema, type Role, type Session } from "@kinder/contracts";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
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
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: qk.session(),
    queryFn: () => get("/auth/me", sessionSchema),
    // A 401 here is the normal signed-out state, not an error worth retrying.
    retry: false,
    // The session rarely changes and every screen reads it; refetching on each
    // focus would add a request to every tab switch for no benefit.
    staleTime: 5 * 60_000,
    // Null rather than a thrown error, so a signed-out visitor renders the
    // login redirect instead of an error boundary.
    select: (s) => s,
  });

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
      router.replace("/login");
    }
  };
}
