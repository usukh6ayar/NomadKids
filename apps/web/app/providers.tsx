"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { SessionProvider } from "@/lib/auth/session";
import { ToastProvider } from "@/components/ui/toast";
import { rememberCsrfToken } from "@/lib/api/csrf";
import { isSessionExpired } from "@/lib/api/errors";

/**
 * TanStack Query configuration.
 *
 * `refetchOnWindowFocus` is how the MVP delivers "new notifications appear"
 * without a WebSocket — an explicit decision, docs/ARCHITECTURE.md §7.
 *
 * The client is created inside state rather than at module scope: a
 * module-level client is shared across requests on the server, which would mix
 * one user's cached data into another's response.
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [queryClient] = useState(() => {
    /**
     * ★ Session expiry, handled once.
     *
     * A refresh token lasts 30 days but the access cookie lasts 15 minutes, so
     * a tab left open overnight wakes up to 401s on every query. Without a
     * central handler each screen renders its own error and the user is left
     * reading "Алдаа гарлаа" with no hint that they simply need to sign in.
     *
     * Handled in the cache callbacks rather than per-hook because it must apply
     * to every request, including ones written later by someone who has not
     * read this comment.
     */
    /**
     * ★ Guarded against re-entry.
     *
     * `client.clear()` invalidates every query, so each one that was in flight
     * refetches, 401s and lands back here. Without the flag that is a loop —
     * observed in production as an endless `GET /v1/auth/me 401` in the console.
     *
     * The session query no longer throws on 401 (it resolves to `null`), which
     * removes the main source. This latch covers the rest: any other query
     * hitting 401 after the cookie expires.
     *
     * It is never reset. The redirect leaves this page, and a fresh page load
     * gets a fresh client.
     */
    let redirecting = false;

    const onAuthError = (error: unknown) => {
      if (redirecting) return;
      if (!isSessionExpired(error)) return;
      if (typeof window === "undefined") return;

      // Already on a public page — redirecting again would loop.
      const path = window.location.pathname;
      if (
        path.startsWith("/login") ||
        path.startsWith("/forgot-password") ||
        path.startsWith("/reset-password")
      ) {
        return;
      }

      redirecting = true;
      client.clear();
      // Same reason as in `useLogout`: `clear()` leaves the session observer's
      // data in place, so the token does not drop by itself.
      rememberCsrfToken(null);
      const from = encodeURIComponent(path + window.location.search);
      router.replace(`/login?from=${from}`);
    };

    const client = new QueryClient({
      queryCache: new QueryCache({ onError: onAuthError }),
      mutationCache: new MutationCache({ onError: onAuthError }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnWindowFocus: true,
          retry: (failureCount, error) => {
            // Never retry an authorization failure. Retrying a 404 that means
            // "you may not see this" just makes three identical audit entries.
            //
            // ★ 402 belongs on this list for a sharper reason than the others:
            // it is not a failure at all, it is an answer. The portal access
            // fee is unpaid and will still be unpaid on the third attempt.
            // It was missing until 2026-09-01, when a guardian's first visit
            // to a paywalled child produced four requests for the child and
            // three for their surveys, all 402, all identical.
            const status = (error as { status?: number }).status;
            if (status === 401 || status === 402 || status === 403 || status === 404) return false;
            return failureCount < 2;
          },
        },
        mutations: {
          // A failed save is the user's to retry, deliberately: an automatic
          // retry on a POST can create the same observation twice.
          retry: false,
        },
      },
    });

    return client;
  });

  /*
   * ★ `ToastProvider` inside the query client, outside the session.
   *
   * Inside the query client because a mutation's `onSuccess` is what raises a
   * toast. Outside the session so a toast survives the session query resolving
   * — the viewport it mounts is a live region, and a region remounted at the
   * moment its first message arrives is not reliably announced.
   */
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionProvider>{children}</SessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
