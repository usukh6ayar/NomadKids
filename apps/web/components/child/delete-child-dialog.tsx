"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

/**
 * «Устгах» from a roster row — client, 2026-10-06.
 *
 * ★ Confirmed first (CLAUDE.md §5), then `DELETE /children/:id`, which is a
 * soft delete (`deletedAt`, §3.2) written to the audit log — the child's
 * record leaves the roster and nothing is destroyed. The route is
 * administrator-only, so the rosters offer this to an administrator alone.
 */
export function DeleteChildDialog({
  child,
  onClose,
}: {
  child: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: (id: string) => mutate(`/children/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Хүүхэд устгагдлаа.");
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <ConfirmDialog
      open={child !== null}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
      tone="danger"
      title={`${child?.name ?? ""}-г устгах уу?`}
      description="Хүүхэд жагсаалтаас хасагдана. Энэ үйлдлийг буцаах боломжгүй."
      confirmLabel="Устгах"
      pendingLabel="Устгаж байна…"
      pending={remove.isPending}
      onConfirm={() => {
        if (child) remove.mutate(child.id);
      }}
    />
  );
}
