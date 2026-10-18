"use client";

import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const OWN_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? null;
/** How often an open page asks, besides each time it comes back to the front. */
const EVERY_MS = 10 * 60_000;

/**
 * «Шинэ хувилбар гарлаа» — 2026-10-18, the client: "өөрчлөлтүүд апп дээр
 * харагдахгүй байна". An app on a phone's home screen stays open for days on
 * the JavaScript it first loaded, so a deploy reached nobody until they shut
 * it down by hand.
 *
 * ★ It asks `/api/version` when the page returns to the front and every ten
 * minutes. On a new build it says so with a button, and the next move to
 * another screen loads the new code by itself — never in the middle of a
 * form somebody is filling in.
 */
export function UpdateBanner() {
  const [outdated, setOutdated] = useState(false);
  const pathname = usePathname();
  const firstPath = useRef(pathname);

  useEffect(() => {
    if (!OWN_BUILD) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build: string | null };
        if (!stopped && build && build !== OWN_BUILD) setOutdated(true);
      } catch {
        // Offline or mid-deploy: ask again later.
      }
    };
    void check();
    const timer = window.setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // The next screen comes from the new build.
  useEffect(() => {
    if (outdated && pathname !== firstPath.current) window.location.reload();
    firstPath.current = pathname;
  }, [outdated, pathname]);

  if (!outdated) return null;
  return (
    <div
      role="status"
      data-print-hide
      className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-50 mx-auto flex max-w-md items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-lg"
    >
      <p className="min-w-0 flex-1 text-body text-ink">Шинэ хувилбар гарлаа.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-pill bg-primary px-4 text-body font-semibold text-primary-ink"
      >
        <RefreshCw size={16} aria-hidden />
        Шинэчлэх
      </button>
    </div>
  );
}
