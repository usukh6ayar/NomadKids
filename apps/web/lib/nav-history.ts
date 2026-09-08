"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * How many in-app navigations this page load has made.
 *
 * ★ Module state on purpose. It survives client-side navigation — which is the
 * only kind that adds a history entry worth going back to — and resets on a
 * full page load, which is exactly when there is nothing to go back to. A
 * `sessionStorage` counter would survive the reload too and send a reader who
 * pasted a URL into whatever tab they were on before.
 */
let depth = 0;

/**
 * The last path counted, so one navigation is counted once.
 *
 * React's development double-invocation runs the effect twice for the same
 * path; a browser Back also fires it. Comparing paths keeps the count on
 * navigations rather than on renders.
 */
let lastPath: string | null = null;

/** Whether a Back can land somewhere this session actually came from. */
export const canGoBack = () => depth > 0;

/** Called by `BackButton` when it hands the navigation to the browser. */
export const noteBackNavigation = () => {
  depth = Math.max(0, depth - 1);
};

/** Test-only: forget this module's idea of where the reader has been. */
export function resetNavigationHistory() {
  depth = 0;
  lastPath = null;
}

/**
 * Counts navigations for `BackButton`. Mounted once, in the app shell.
 *
 * The first path of a page load is the landing page and is deliberately not
 * counted: arriving somewhere is not the same as having come from somewhere.
 */
export function useNavigationHistory() {
  const pathname = usePathname();

  useEffect(() => {
    if (lastPath === null) {
      lastPath = pathname;
      return;
    }
    if (lastPath === pathname) return;
    lastPath = pathname;
    depth += 1;
  }, [pathname]);
}

/**
 * "Go back one step, or to `fallback` if this page was opened cold."
 *
 * The behaviour `BackButton` gives a link, for the places that need a plain
 * handler instead — a form's Буцах, which cannot be an anchor because it sits
 * beside a submit inside the same form.
 */
export function useGoBack(fallback: string) {
  const router = useRouter();

  return () => {
    if (canGoBack()) {
      noteBackNavigation();
      router.back();
      return;
    }
    router.push(fallback);
  };
}
