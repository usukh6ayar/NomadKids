"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Confirm before delete" — CLAUDE.md §5, in the product's own design system.
 *
 * ★ It replaces `window.confirm`, which was doing this job in five places.
 *
 * The native dialog cannot be styled, renders in the browser's language rather
 * than the product's — an "OK / Cancel" in English above Mongolian body text —
 * and on iOS Safari it names the origin, so a parent is asked to confirm
 * something by `nomadkids.mn says…`. It also blocks the main thread, which
 * means the button behind it cannot show that anything is happening.
 *
 * ★★ Radix, because `report-dialog.tsx` already uses it.
 *
 * `@radix-ui/react-dialog` is an existing dependency and brings the parts that
 * are tedious and easy to get wrong: a focus trap, focus restored to the
 * trigger on close, `Escape`, `aria-modal`, and the outside-click. The other
 * dialog in this product — `invite-guardian-dialog.tsx` — is hand-rolled with a
 * bare `role="dialog"` and has none of them; this deliberately follows the
 * better of the two patterns rather than averaging them.
 *
 * ★★★ `tone` defaults to `default`, not to `danger`.
 *
 * Confirmation is not the same thing as danger. Finalising a term report asks
 * because it cannot be undone, not because anything is destroyed, and painting
 * that dialog red teaches people to click through red. `danger` is for a
 * removal; everything else is a plain question.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  body,
  confirmLabel,
  cancelLabel = "Болих",
  pendingLabel,
  tone = "default",
  pending = false,
  onConfirm,
}: {
  /** The control that opens it — usually the button that used to do the work. */
  trigger: ReactNode;
  title: string;
  /** What actually happens, in a sentence. Name the record where you can. */
  description: string;
  /**
   * One control the confirmation itself needs — a select, a reason field.
   *
   * ★ Optional, and most dialogs should stay without one.
   *
   * A confirmation asks "are you sure"; a form asks "with what". Putting a
   * whole form in here would turn every destructive prompt into a modal editor,
   * which is the thing `archive-button.tsx` avoids by keeping its errors on the
   * page. It exists for the case where the confirmation *is* the choice —
   * changing a role, where "yes" is meaningless without "to what" — and it sits
   * between the description and the buttons so the sentence explaining the
   * consequence is read first.
   */
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Shown on the confirm button while `pending`. Falls back to `confirmLabel`. */
  pendingLabel?: string;
  tone?: "default" | "danger";
  /** Drive from the mutation: `pending={remove.isPending}`. */
  pending?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();

  /*
   * ★ It closes once the confirmed work is no longer pending.
   *
   * The dialog stays up while `pending` is true so the confirm button can say
   * "Архивлаж байна…". Both outcomes close it, deliberately: a success has
   * nothing more to say, and a failure is reported by the caller *outside* the
   * dialog — `archive-button.tsx` keeps its 409 on the page precisely because
   * that message is the next instruction and must not be dismissed with a
   * modal.
   *
   * ★★ Gated on "a confirm happened", not on a true → false edge of `pending`.
   *
   * The edge version shipped first and was wrong. A mutation that resolves
   * inside a single commit — a fast local API, a cached response, a stubbed
   * one in a test — never leaves `pending` observably `true`, so the edge never
   * arrived and the dialog stayed open on top of a completed action. Worse, it
   * failed *silently*: `aria-modal` hides the rest of the page from the
   * accessibility tree, so the caller's own inline error was in the DOM and
   * unreachable to a screen reader and to `getByRole`.
   *
   * Radix restores focus to the trigger on close, so the keyboard lands back
   * on the button that opened this.
   */
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (!confirmed || pending) return;
    setOpen(false);
    setConfirmed(false);
  }, [confirmed, pending]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // While the action is running the dialog stays put: closing it would
        // hide the only thing saying the work is still going.
        if (pending && !next) return;
        setOpen(next);
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          aria-describedby={descriptionId}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-surface p-5 shadow-lg"
        >
          <Dialog.Title className="text-lead font-semibold text-ink">{title}</Dialog.Title>
          <Dialog.Description id={descriptionId} className="mt-1.5 text-body text-muted">
            {description}
          </Dialog.Description>

          {body ? <div className="mt-4">{body}</div> : null}

          {/*
            Cancel first in the DOM, so it is what `Tab` reaches first and what
            `Escape` is the shortcut for. The confirm sits to the right, where
            the eye finishes.
          */}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary" size="sm" disabled={pending}>
                {cancelLabel}
              </Button>
            </Dialog.Close>

            <Button
              type="button"
              size="sm"
              // Guards the double-click: the second press cannot re-fire.
              disabled={pending}
              onClick={() => {
                setConfirmed(true);
                onConfirm();
              }}
              className={cn(tone === "danger" && "bg-danger text-white hover:bg-danger/90")}
            >
              {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
