"use client";

import { useEffect, useState } from "react";

/**
 * Delays a value until typing stops.
 *
 * Used for search. Without it every keystroke is a request, so typing a
 * six-letter surname fires six queries, the last four of which race — and on a
 * slow connection the results for "Ган" can land after "Ганболд" and overwrite
 * them. 300ms is below the point where a search box starts to feel laggy.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
