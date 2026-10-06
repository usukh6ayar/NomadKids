"use client";

import { useEffect, useState } from "react";

/** Below Tailwind's `sm` — the phone layout. */
const PHONE_QUERY = "(max-width: 639px)";

/**
 * Whether the screen is a phone's width.
 *
 * ★ `false` on the first render, then the truth after mount. A server render
 * has no screen, so reading `matchMedia` during the first render would give a
 * hydration mismatch; callers use this for *behaviour* (a default range) and
 * keep *layout* in CSS (`sm:` classes), which needs no JavaScript at all.
 */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return phone;
}
