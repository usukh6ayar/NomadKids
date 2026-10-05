"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Where ‹ goes — a trail of the section the reader is in, not the browser's
 * history.
 *
 * ★ Client, 2026-10-06: "товчлуур ба хөвдөг цэснээс нэг удаа дарахад буцах
 * нүүр хуудсан дээр авчирна. Харин дараагийн үйлдлүүд рүү ороод яваад байх
 * тусмаа эргүүлээд буцаж ирэхдээ өөрийн тухайн хэсэг рүүгээ буцаж ирнэ."
 *
 * So a trail starts afresh — `[home, page]` — whenever the reader enters a
 * section: a page the menu names (the sidebar, the floating bar, the drawer),
 * or anywhere at all reached from the home screen (its tiles and buttons).
 * Going deeper appends. ‹ steps to the entry before the current one, so the
 * first ‹ inside a section walks back up it and the last one lands on home.
 *
 * `router.back()` alone could not do this: Мэдээ → (bar) Явцын үнэлгээ → ‹
 * would have returned to Мэдээ, which is where the reader *was*, not where
 * the section they are in begins.
 *
 * ★★ Module state on purpose, as the depth counter it replaces was. It
 * survives client-side navigation and resets on a full page load, which is
 * exactly when there is no trail to follow — a pasted URL, a new tab, a
 * refresh — and `BackButton` falls back to its `href`.
 */
let trail: string[] = [];

/** The last path seen, so one navigation is handled once (dev double effects). */
let lastPath: string | null = null;

/** The path the most recent forward navigation came from — a real history entry. */
let cameFrom: string | null = null;

/** Set by a ‹ just before it navigates, so the effect walks back rather than forward. */
let steppingBackTo: string | null = null;

/** This workspace's home and the destinations its menu names — `AppShell` sets them. */
let home: string | null = null;
let menu: ReadonlySet<string> = new Set();

/** Whether ‹ has somewhere in this section to go. */
export const canGoBack = () => trail.length > 1;

/** Where ‹ goes from here, or `null` when the trail does not know. */
export const backTarget = (): string | null => trail[trail.length - 2] ?? null;

/** Kept for callers of the earlier API; the trail walks itself back now. */
export const noteBackNavigation = () => {};

/** Test-only: forget where the reader has been. */
export function resetNavigationHistory() {
  trail = [];
  lastPath = null;
  cameFrom = null;
  steppingBackTo = null;
  home = null;
  menu = new Set();
}

/**
 * The workspace's home screen and its menu destinations — called by the shell,
 * which is what knows them.
 */
export function setNavigationMenu(hrefs: readonly string[]) {
  home = hrefs[0] ?? null;
  menu = new Set(hrefs);
}

/** Moves the trail to a new path. Exported for the tests; the hook calls it. */
export function recordNavigation(path: string) {
  // The first path of a page load is where the reader landed, not somewhere
  // they came from: ‹ there follows its own `href`.
  if (lastPath === null) {
    lastPath = path;
    trail = [path];
    return;
  }
  if (path === lastPath) return;
  const previous = lastPath;
  lastPath = path;

  if (steppingBackTo === path) {
    steppingBackTo = null;
    cameFrom = null;
    const index = trail.lastIndexOf(path);
    trail = index >= 0 ? trail.slice(0, index + 1) : [path];
    return;
  }
  steppingBackTo = null;
  cameFrom = previous;

  // Home itself ends every trail.
  if (path === home) {
    trail = [path];
    return;
  }
  // Back up to somewhere already on the trail — the browser's own Back, or a
  // link to an ancestor: the trail shortens to it.
  const index = trail.lastIndexOf(path);
  if (index >= 0) {
    trail = trail.slice(0, index + 1);
    return;
  }
  // Entering a section: a menu destination, or anything reached from home.
  if (menu.has(path) || previous === home) {
    trail = home ? [home, path] : [path];
    return;
  }
  trail = [...trail, path];
}

/**
 * Follows every route change for `BackButton`. Mounted once, in the app shell.
 */
export function useNavigationHistory() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) recordNavigation(pathname);
  }, [pathname]);
}

/**
 * "Go one step up this section, or to `fallback` if the trail does not know."
 *
 * ★ When the step is the page the reader just came from, it is the browser's
 * own Back — the history entry exists, and a filter kept in its query string
 * survives. Otherwise (the step is home, after a section was entered from
 * elsewhere) it is a navigation to that page.
 */
export function useGoBack(fallback: string) {
  const router = useRouter();

  return () => {
    const target = backTarget();
    if (!target) {
      router.push(fallback);
      return;
    }
    steppingBackTo = target;
    if (target === cameFrom) router.back();
    else router.push(target);
  };
}
