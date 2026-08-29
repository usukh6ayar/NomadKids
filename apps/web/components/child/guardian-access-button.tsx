"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, X } from "lucide-react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Revoking or restoring one guardian's view of one child.
 *
 * ★ This is a custody control, and it had no button.
 *
 * `PATCH /guardianships/:id { canView }` has existed since Phase 5. Until now
 * the only way a kindergarten could stop a parent seeing a child — after a
 * custody order, a separation, a safeguarding referral — was to call the API by
 * hand. That is the one operation in this product most likely to be needed the
 * same afternoon it is decided.
 *
 * ★ Revoking sets a flag; it never deletes the guardianship.
 *
 * The record of the relationship is what lets it be restored when a situation
 * reverses, and deleting it would also erase who used to have access. The API
 * is built the same way — `canView: false` is the revocation, and
 * `child-access.ts` reads it on every request, so the parent's next page load
 * already returns 404.
 */
export function GuardianAccessButton({
  guardianshipId,
  childId,
  guardianName,
  canView,
}: {
  guardianshipId: string;
  childId: string;
  guardianName: string;
  canView: boolean;
}) {
  const queryClient = useQueryClient();

  const change = useMutation({
    mutationFn: (next: boolean) =>
      mutate(`/guardianships/${guardianshipId}`, z.unknown(), {
        method: "PATCH",
        body: { canView: next },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.child(childId) }),
  });

  if (!canView) {
    return (
      <button
        type="button"
        disabled={change.isPending}
        onClick={() => change.mutate(true)}
        className="flex min-h-[36px] items-center gap-1.5 rounded-pill px-2.5 text-compact text-muted transition-colors hover:bg-canvas hover:text-ink disabled:opacity-50"
      >
        <RotateCcw size={14} aria-hidden />
        Сэргээх
        <span className="sr-only">— {guardianName}</span>
      </button>
    );
  }

  return (
    // Confirmed: it takes a parent's access to their child away, and the
    // control sits in a list where the rows look alike. Was `window.confirm`.
    <ConfirmDialog
      title="Харах эрхийг хураах"
      description={`${guardianName} энэ хүүхдийн мэдээллийг цаашид харахгүй болно. Дараа нь эргүүлэн сэргээж болно.`}
      confirmLabel="Эрхийг хураах"
      pendingLabel="Хураж байна…"
      tone="danger"
      pending={change.isPending}
      onConfirm={() => change.mutate(false)}
      trigger={
        <button
          type="button"
          disabled={change.isPending}
          className="grid size-[36px] place-items-center rounded-pill text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
        >
          <X size={16} aria-hidden />
          <span className="sr-only">{guardianName} — харах эрхийг хураах</span>
        </button>
      }
    />
  );
}
