"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Backdrop dismissal for the dialogs in this product that are not Radix.
 *
 * ★ Why this exists: fourteen screens each wrote `<div role="dialog"
 * aria-modal="true" className="fixed inset-0 …">` by hand, and each decided
 * separately whether Escape closed it, whether the page behind it scrolled,
 * and whether clicking the dark area did anything. Most did not — a director
 * who opened "Бүлэг нэмэх" by mistake had exactly one way out, the Болих
 * button, and the reflex everybody has, clicking the grey, did nothing. The
 * client's instruction on 2026-09-19 was "бүх хэсэгт", so this is one hook
 * rather than fourteen fixes that drift apart again.
 *
 * ★★ A hook returning props, rather than a wrapper component, on purpose.
 * Every one of those dialogs already has its own overlay element with its own
 * layout — `grid place-items-center`, `grid items-end` for the survey sheet,
 * `flex` for the lightbox. Spreading two handlers onto what is already there
 * changes behaviour without touching a single line of layout, which is the
 * difference between a change that can be reviewed and one that cannot.
 *
 * ★★★ The backdrop closes on a click that both **started and ended** on it.
 *
 * A bare `onClick` closes the dialog when someone selects text in a field,
 * drags past the panel's edge and releases: the `click` lands on the backdrop
 * although the gesture began inside it. Losing a half-filled form to that is
 * worse than not having the behaviour at all.
 *
 * ★★★★ It does **not** trap focus. `FormDialog` and `ConfirmDialog` wrap Radix
 * and do, which is why new dialogs should start there. This is the smaller
 * thing, applied to what is already hand-rolled, and it is honest about that.
 */
export function useBackdropDismiss(
  onClose: () => void,
  {
    /**
     * Set false for a dialog that must be answered rather than dismissed.
     * Escape goes with it: a dialog that ignores the backdrop but vanishes on
     * Escape teaches two different rules for one question.
     */
    dismissable = true,
    /** Set false where the dialog's own effect already locks the page. */
    lockScroll = true,
  }: { dismissable?: boolean; lockScroll?: boolean } = {},
) {
  const startedOnBackdrop = useRef(false);

  useEffect(() => {
    if (!dismissable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismissable, onClose]);

  useEffect(() => {
    if (!lockScroll) return;
    // The page behind a modal must not scroll under it — on a phone that is
    // how a reader ends up looking at a list they cannot touch.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [lockScroll]);

  return {
    onPointerDown: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
      startedOnBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
      if (!dismissable) return;
      if (startedOnBackdrop.current && event.target === event.currentTarget) onClose();
    },
  };
}

/** The same behaviour with the usual backdrop, for a dialog written from new. */
export function ModalOverlay({
  label,
  onClose,
  children,
  className,
  dismissable = true,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  dismissable?: boolean;
}) {
  const backdrop = useBackdropDismiss(onClose, { dismissable });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      {...backdrop}
      className={cn(
        "fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
