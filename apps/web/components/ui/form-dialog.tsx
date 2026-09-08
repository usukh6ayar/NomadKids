"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A modal that holds a form.
 *
 * ★ `ConfirmDialog` answers a question; this one collects input.
 *
 * The two are deliberately separate components rather than one with a `mode`.
 * A confirmation has a fixed shape — title, sentence, two buttons — and its
 * whole value is that it is uniform. A form dialog owns arbitrary children and
 * its own submit, and folding them together would mean a component whose props
 * only make sense in half its states.
 *
 * ★★ Radix, for the third time in this product and for the same reason.
 *
 * `report-dialog.tsx` and `ConfirmDialog` use it; `invite-guardian-dialog.tsx`
 * and this screen's own `InviteUserDialog` are hand-rolled `role="dialog"`
 * overlays with no focus trap, no `Escape`, and no focus restored to the
 * trigger. This follows the better pattern rather than the nearer one. The two
 * hand-rolled dialogs are worth migrating; that is not this task.
 *
 * ★★★ It is `controlled` — `open` comes from the caller.
 *
 * The forms inside need to survive a failed submit and close only when the
 * caller says so, which an uncontrolled dialog cannot express.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  /** Kept out of `children` so every dialog's actions sit in the same place. */
  footer,
  /** Blocks the close affordances while a submit is in flight. */
  busy = false,
  /**
   * A wider column, for a dialog whose content is a table rather than a form.
   *
   * ★ Added for the ESIS field catalog — 31 field rows and a 27-column value
   * table, which at 480px is a column of horizontal scrollbars. The default is
   * unchanged, because 480px is the right width for the five-field forms this
   * component was built for and every existing caller is one of those.
   */
  size = "form",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  size?: "form" | "wide";
}) {
  const descriptionId = useId();

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Closing mid-save would hide the only thing saying the work started,
        // and leave the caller's mutation writing into an unmounted tree.
        if (busy && !next) return;
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        {/*
          ★ `max-h` plus its own scroll.

          At 390px a form of five fields is taller than the viewport, and a
          modal that cannot scroll puts its submit button somewhere unreachable.
          The dialog scrolls inside itself rather than the page behind it.
        */}
        <Dialog.Content
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-card border border-border bg-surface p-5 shadow-lg",
            size === "wide" ? "max-w-[1040px]" : "max-w-[480px]",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-lead font-semibold text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description id={descriptionId} className="mt-1 text-body text-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>

            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Хаах" disabled={busy}>
                <X size={18} aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>

          {children}

          {footer ? <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
