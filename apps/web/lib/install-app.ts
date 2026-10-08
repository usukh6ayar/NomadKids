"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Putting the site on a phone's home screen — 2026-10-08, the client: "website-aa
 * add to homescreen gedgiig hyalbar hiilgeh".
 *
 * ★ Two very different mechanisms, which is why the card explains rather than
 * only offers a button. Chrome on Android fires `beforeinstallprompt`, and
 * calling `prompt()` on it opens the browser's own install sheet — one tap. iOS
 * Safari has no such event and no API at all: the only way is Share → «Add to
 * Home Screen», so on an iPhone all we can do is show the steps.
 *
 * The event can fire before React mounts, so it is caught at module load and
 * kept in a tiny store rather than in a component's effect.
 */

export type InstallPlatform = "ios" | "android" | "other";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep Chrome's mini-infobar from appearing on its own; the card offers it.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function detectPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  // iPadOS 13+ reports itself as a Mac; only the touch screen gives it away.
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/android/i.test(userAgent)) return "android";
  return "other";
}

/** Already opened from the home screen — nothing left to install. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true
  );
}

export function useInstallApp() {
  const canPrompt = useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
  // Read after mount: the server render has no user agent to read.
  const [env, setEnv] = useState<{ platform: InstallPlatform; installed: boolean } | null>(null);

  useEffect(() => {
    setEnv({
      platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
      installed: isStandalone(),
    });
  }, []);

  async function prompt(): Promise<boolean> {
    const event = deferred;
    if (!event) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // The event is single-use either way.
    deferred = null;
    emit();
    return outcome === "accepted";
  }

  return {
    ready: env !== null,
    platform: env?.platform ?? "other",
    installed: env?.installed ?? false,
    canPrompt,
    prompt,
  };
}
