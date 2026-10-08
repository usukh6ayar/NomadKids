"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { X } from "lucide-react";
import { FEEDBACK_LEDE, ParentFeedbackPanel } from "@/components/feedback/parent-feedback";
import { Art } from "@/components/ui/art";
import { cn } from "@/lib/utils";

/**
 * Санал хүсэлт as a floating button — 2026-10-08, the client: "Миний
 * судалгаанууд хэсэг рүү ороход чаттай адилхан загвараар чатны яг дээр гарч
 * ирэх".
 *
 * ★ The chat launcher's twin (`chat-widget.tsx`): the same 56px disc, the same
 * panel — the whole screen on a phone, a 400 × 600 card from `lg` — stacked one
 * disc and an 8px gap above it. Both offsets read the chat's own, so the two
 * cannot drift into each other when the bottom bar changes height.
 *
 * Mounted by the family's survey page only, not by the shell: it belongs to
 * the place a family is already being asked what they think.
 */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="Санал хүсэлт"
        data-print-hide
        className={cn(
          "fixed right-4 z-30 grid size-14 place-items-center rounded-pill bg-transparent shadow-lg transition-transform hover:scale-105",
          "bottom-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom)+4.5rem)] lg:bottom-[5.5rem] lg:right-6",
        )}
      >
        {/* A sealed letter on a yellow disc — 2026-10-08, the client's picture. */}
        <Art name="feedbackWrite" size={56} className="size-14 object-contain" />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 data-[state=open]:animate-in data-[state=open]:fade-in lg:bg-ink/20" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-surface",
            "inset-0",
            "lg:inset-auto lg:bottom-40 lg:right-6 lg:h-[600px] lg:w-[400px] lg:rounded-card lg:border lg:border-border lg:shadow-xl",
            "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-2",
          )}
        >
          <header className="border-b border-track bg-white px-4 pb-4 pt-5">
            <div className="flex min-h-11 items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-title font-extrabold tracking-tight text-ink">
                  Санал хүсэлт
                </Dialog.Title>
                <p className="mt-0.5 text-caption text-muted">{FEEDBACK_LEDE}</p>
              </div>
              <Dialog.Close
                aria-label="Хаах"
                className="grid size-11 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink"
              >
                <X size={19} aria-hidden="true" />
              </Dialog.Close>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-4">
            <ParentFeedbackPanel />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
