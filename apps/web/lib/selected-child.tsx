"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "nomadkids.selectedChildId";

interface SelectedChildContextValue {
  selectedChildId: string | undefined;
  setSelectedChildId: (id: string) => void;
}

const SelectedChildContext = createContext<SelectedChildContextValue | null>(null);

/**
 * Which of a parent's children the sidebar's switcher and Home's tiles are
 * currently showing.
 *
 * ★ Only the id travels through context, never a fetched child record —
 * `AppLayout`'s `myChildren` (`/children/mine`) and Home's own `children`
 * (`/dashboard/parent`) are two different queries, and nothing here assumes
 * they agree on shape. Each consumer resolves the id against whichever list
 * it already fetched, falling back to that list's first entry.
 *
 * Persisted in `localStorage`, not component state alone — a parent who
 * always checks their older child first should not have to re-pick on every
 * visit. Read lazily in an effect (not during render) because it depends on
 * `myChildren`, which is not known until its own query resolves; until then
 * every consumer's "fall back to the first child" default is what renders.
 */
export function SelectedChildProvider({
  myChildIds,
  children,
}: {
  /** Ids only, in fetch order — see the note above on why not full records. */
  myChildIds: string[] | undefined;
  children: ReactNode;
}) {
  const [selectedChildId, setSelectedChildIdState] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!myChildIds || myChildIds.length === 0) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private browsing / storage disabled — falls through to the first child.
    }
    setSelectedChildIdState(stored && myChildIds.includes(stored) ? stored : myChildIds[0]);
  }, [myChildIds]);

  const setSelectedChildId = (id: string) => {
    setSelectedChildIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // The pick still works for this tab; it just will not survive a reload.
    }
  };

  return (
    <SelectedChildContext.Provider value={{ selectedChildId, setSelectedChildId }}>
      {children}
    </SelectedChildContext.Provider>
  );
}

export function useSelectedChild(): SelectedChildContextValue {
  const ctx = useContext(SelectedChildContext);
  if (!ctx) throw new Error("useSelectedChild must be used within SelectedChildProvider");
  return ctx;
}
