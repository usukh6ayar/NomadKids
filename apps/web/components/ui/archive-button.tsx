"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";

/**
 * Archiving a record.
 *
 * ★ Never a hard delete, anywhere in this product.
 *
 * Every `DELETE` in this API sets `deletedAt` and stops serving the row; the
 * record survives so a mistake is recoverable and so an audit trail still has
 * something to point at. CLAUDE.md §3.2. The button says "архивлах" rather
 * than "устгах" because that is what actually happens, and a teacher who reads
 * "delete" and hesitates is being told the wrong thing about their own data.
 *
 * ★ One component for child, observation and announcement.
 *
 * The three screens had no archive control at all and would otherwise have
 * grown three confirmation dialogs with three slightly different wordings and
 * three chances to forget the cache invalidation. The differences that matter —
 * what it is called, what to invalidate, where to go afterwards — are props.
 */
export function ArchiveButton({
  path,
  label,
  confirmation,
  invalidate,
  redirectTo,
  variant = "secondary",
}: {
  /** API path, without `/v1`. */
  path: string;
  /** The visible button text. */
  label: string;
  /** What the confirmation asks. Names the record, so a mis-click is caught. */
  confirmation: string;
  /** Query keys to refetch. Prefixes match, so `["children"]` clears the lot. */
  invalidate: readonly (readonly unknown[])[];
  /** Where to send the user, for a record whose own page is about to 404. */
  redirectTo?: string;
  variant?: "secondary" | "ghost";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const archive = useMutation({
    mutationFn: () => mutate(path, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      for (const key of invalidate) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      // Pushed after invalidation so the list being returned to is already
      // refetching rather than showing the row that has just gone.
      if (redirectTo) router.push(redirectTo);
    },
  });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={archive.isPending}
        onClick={() => {
          if (window.confirm(confirmation)) archive.mutate();
        }}
        className="text-danger hover:bg-danger-soft"
      >
        <Trash2 size={18} />
        {archive.isPending ? "Архивлаж байна…" : label}
      </Button>

      {/*
        Shown in place rather than as a toast. The most likely failure is the
        409 an admin gets for a group that still has children in it, and that
        message is the instruction — it must not disappear after four seconds.
      */}
      {archive.isError ? (
        <span role="alert" className="max-w-[280px] text-right text-xs text-danger">
          {errorMessage(archive.error)}
        </span>
      ) : null}
    </span>
  );
}
