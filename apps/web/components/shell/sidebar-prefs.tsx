"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * How wide the desktop rail may be, and whether it is there at all.
 *
 * ★ Why this is a preference rather than a constant.
 *
 * The rail was three hard-coded widths — 264px for staff, 244px for a parent,
 * 220px otherwise — chosen for the longest label each menu carries. That is the
 * right *default* and the wrong *rule*: a director on a 1366px laptop spends a
 * fifth of their screen on a menu they know by heart, and the register tables
 * this product is mostly made of are the thing that loses the room. So the
 * default stays per-variant and the person can override it, both ways.
 *
 * ★★ The width lives in a CSS custom property, not in React's render output.
 *
 * Two things must agree on it — the rail's own width and the content frame's
 * left padding — and they are in different parts of the tree. Passing a number
 * to both means a drag re-renders the whole shell on every pointer event, at
 * which point dragging a 60-row register is visibly slow. Two variables on the
 * shell's own element are read by both in CSS, so a drag touches one inline
 * style and nothing re-renders. `ShellSurface` sets them; `Sidebar` and the
 * content frame read them, and `writeLiveVars` below overrides them mid-drag.
 *
 * ★★★ It is deliberately **not** stored on the server.
 *
 * A menu width is a property of the screen someone is sitting at, not of their
 * account — the same director on a phone-sized window and a 27" monitor wants
 * two different answers, and a column in `User` can only hold one. It is also
 * the kind of write that would put a request on every drag.
 */

/** Narrow enough to still fit "Ажилтны бүртгэлийн код" on two lines. */
export const SIDEBAR_MIN_WIDTH = 190;
/** Past this the menu is competing with the content rather than serving it. */
export const SIDEBAR_MAX_WIDTH = 420;
/** The gutter between the rail's right edge and the content column. */
export const SIDEBAR_GUTTER = 12;
/**
 * The width of the icon rail the menu folds into — 2026-09-26.
 *
 * ★ It used to fold into nothing, with a round button floating on the seam to
 * bring it back; the client did not want that button («iim baimaargui»). A
 * rail of icons keeps every destination one click away while giving the
 * content almost all of the room, and the way back sits at its top.
 */
export const SIDEBAR_RAIL_WIDTH = 64;
/** What the content frame keeps clear beside the folded rail. */
export const SIDEBAR_COLLAPSED_PAD = SIDEBAR_RAIL_WIDTH + SIDEBAR_GUTTER;

const WIDTH_KEY = "nk.sidebar.width";
const COLLAPSED_KEY = "nk.sidebar.collapsed";

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_MIN_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

interface SidebarPrefs {
  width: number;
  collapsed: boolean;
  setWidth: (width: number) => void;
  setCollapsed: (collapsed: boolean) => void;
}

const SidebarPrefsContext = createContext<SidebarPrefs | null>(null);

/**
 * Reads the stored preferences once, after mount.
 *
 * ★ After mount, not during render. The server has no `localStorage`, so a
 * first render that read it would disagree with the server's HTML and React
 * would throw away the tree. The cost is one frame at the default width, which
 * is the same trade every persisted UI preference in this product makes —
 * `web-tests-had-no-real-localstorage` is the note about why the write half of
 * this is worth testing.
 */
export function useSidebarPrefs(): SidebarPrefs {
  const value = useContext(SidebarPrefsContext);
  if (!value) {
    throw new Error("useSidebarPrefs must be used inside <SidebarPrefsProvider>");
  }
  return value;
}

export function SidebarPrefsProvider({
  defaultWidth,
  children,
}: {
  /** The per-variant default, used until the reader has chosen otherwise. */
  defaultWidth: number;
  children: ReactNode;
}) {
  const [width, setWidthState] = useState(defaultWidth);
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    try {
      const storedWidth = window.localStorage.getItem(WIDTH_KEY);
      if (storedWidth !== null) setWidthState(clampWidth(Number(storedWidth)));
      setCollapsedState(window.localStorage.getItem(COLLAPSED_KEY) === "true");
    } catch {
      // A browser with storage disabled still gets a working sidebar, at the
      // default width, for the length of the visit.
    }
  }, []);

  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      /* see above */
    }
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      /* see above */
    }
  }, []);

  return (
    <SidebarPrefsContext.Provider value={{ width, collapsed, setWidth, setCollapsed }}>
      {children}
    </SidebarPrefsContext.Provider>
  );
}

/**
 * The two custom properties the shell is laid out from.
 *
 * `--sidebar-w` is the rail. `--shell-pad` is what the content frame keeps
 * clear on its left: the rail plus a gutter, or — when the rail is away — just
 * enough for the handle.
 */
export function sidebarVars({ width, collapsed }: { width: number; collapsed: boolean }) {
  return {
    "--sidebar-w": `${collapsed ? SIDEBAR_RAIL_WIDTH : width}px`,
    "--shell-pad": `${collapsed ? SIDEBAR_COLLAPSED_PAD : width + SIDEBAR_GUTTER}px`,
  } as CSSProperties;
}

/**
 * Writes the live drag value onto **`ShellSurface`'s element**, not onto
 * `<html>`.
 *
 * ★ This is the whole reason the function exists rather than two inline
 * `setProperty` calls. `ShellSurface` sets both variables as an inline style
 * on its own `<div>`, and an inline style on a nearer ancestor beats one on
 * the document element — so a drag that wrote to `<html>` would compute
 * correctly, change nothing on screen, and only "work" when the pointer was
 * released and React re-rendered. The keyboard path never touches this, which
 * is exactly why the tests would not have caught it.
 */
function writeLiveVars(width: number): void {
  const surface = document.querySelector<HTMLElement>("[data-sidebar]");
  if (!surface) return;
  surface.style.setProperty("--sidebar-w", `${width}px`);
  surface.style.setProperty("--shell-pad", `${width + SIDEBAR_GUTTER}px`);
}

/**
 * The rail's right edge: drag it to resize. Hiding it is the menu's own
 * «Цэс хураах» row now — see `SidebarCollapseRow` in `app-shell.tsx`.
 *
 * ★ One control, not two, because they are one thing to the eye — the seam
 * between the menu and the work. Two separate affordances at the same
 * coordinate is how a drag becomes an accidental collapse.
 *
 * ★★ It is a `separator` with `aria-valuenow`, and the arrow keys move it.
 * A drag handle reachable only by pointer is a control a keyboard user cannot
 * operate at all, and this one changes the layout of every screen in the
 * product. `Home` restores the default; `Enter` hides the rail, which is what
 * the button beside it does.
 *
 * ★★★ Desktop only (`lg`), because below it there is no rail to size — the
 * menu is `MobileMenuDrawer`, a sheet at its own fixed width.
 */
export function SidebarEdge({ defaultWidth }: { defaultWidth: number }) {
  const { width, collapsed, setWidth, setCollapsed } = useSidebarPrefs();
  const [dragging, setDragging] = useState(false);
  // The last width the pointer produced. `setWidth` persists on release rather
  // than on every move: a drag across 200px would otherwise write to
  // `localStorage` a hundred times for one decision.
  const liveWidth = useRef(width);

  useEffect(() => {
    liveWidth.current = width;
  }, [width]);

  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    // Without this, dragging over the page selects every heading it crosses.
    document.body.classList.add("select-none");
    return () => {
      document.body.style.cursor = previous;
      document.body.classList.remove("select-none");
    };
  }, [dragging]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsed || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    // The rail starts at the viewport's left edge, so the pointer's x is the
    // width. No offset to track, and no drift when the pointer leaves the strip.
    const next = clampWidth(event.clientX);
    liveWidth.current = next;
    writeLiveVars(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
    // Hand the value back to React. The overrides are the same element's own
    // style attribute, so `setWidth` simply rewrites them on the next render —
    // clearing them first would flash the old width for a frame.
    setWidth(liveWidth.current);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setWidth(width - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setWidth(width + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      setWidth(defaultWidth);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setCollapsed(!collapsed);
    }
  };

  // Folded, there is nothing to size — the rail is fixed at its own width.
  if (collapsed) return null;

  return (
    <div
      data-print-hide
      className="fixed inset-y-0 z-30 hidden w-3 lg:block"
      style={{ left: "var(--sidebar-w)" }}
    >
      {
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Хажуугийн цэсний өргөн"
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          onDoubleClick={() => setWidth(defaultWidth)}
          className={cn(
            "absolute inset-y-0 left-0 w-3 cursor-col-resize outline-none",
            // The seam itself: a hairline that thickens under the pointer, so
            // the strip reads as a grabbable edge rather than a gap.
            "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2",
            "before:bg-transparent before:transition-colors hover:before:bg-primary/40",
            "focus-visible:before:w-0.5 focus-visible:before:bg-primary",
            dragging && "before:w-0.5 before:bg-primary",
          )}
        />
      }
    </div>
  );
}
