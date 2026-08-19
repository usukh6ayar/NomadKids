"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { SessionProvider } from "@/lib/auth/session";
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
    const onAuthError = (error: unknown) => {
      if (!isSessionExpired(error)) return;
      if (typeof window === "undefined") return;
      // Already on a public page — redirecting again would loop.
      if (window.location.pathname.startsWith("/login")) return;

      client.clear();
      const from = encodeURIComponent(window.location.pathname + window.location.search);
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
            const status = (error as { status?: number }).status;
            if (status === 401 || status === 403 || status === 404) return false;
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

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
