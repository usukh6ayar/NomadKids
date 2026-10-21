"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type LibraryView = "grid" | "list";

const VIEW_KEY = "nk.documents.view";

/**
 * Хавтсаар or Жагсаалтаар — one choice for every tab of «Баримт бичгийн сан»
 * (2026-10-20, the user: "бүгдийг листээр нэмж хардаг"). Remembered per
 * browser, a convenience only: blocked storage simply starts on the grid.
 */
export function useLibraryView(): [LibraryView, (next: LibraryView) => void] {
  const [view, setView] = useState<LibraryView>("grid");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {
      // Storage blocked (private window) — the grid it is.
    }
  }, []);
  const choose = (next: LibraryView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Storage blocked — the choice lasts until the page is left.
    }
  };
  return [view, choose];
}

export function ViewToggle({
  value,
  onChange,
}: {
  value: LibraryView;
  onChange: (next: LibraryView) => void;
}) {
  const options = [
    { value: "grid", title: "Хавтсаар", icon: LayoutGrid },
    { value: "list", title: "Жагсаалтаар", icon: List },
  ] as const;
  return (
    <div
      role="group"
      aria-label="Харагдац"
      className="flex shrink-0 gap-1 rounded-control bg-canvas p-1"
    >
      {options.map(({ value: key, title, icon: Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          aria-label={title}
          title={title}
          onClick={() => onChange(key)}
          className={cn(
            "inline-flex min-h-9 min-w-9 items-center justify-center rounded-control px-2.5 transition-colors",
            value === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          <Icon size={18} aria-hidden />
        </button>
      ))}
    </div>
  );
}
