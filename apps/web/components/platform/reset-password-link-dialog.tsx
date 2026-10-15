"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { ApiError } from "@/lib/api/client";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError } from "@/components/ui/states";

/**
 * «Нууц үг сэргээх» from the operator — 2026-10-14, the user: a director or a
 * solo teacher who forgot the password and lost the phone has nobody above
 * them but the operator. A one-time link, as a director gives their staff
 * (`POST /users/:id/password-reset`); the person sets the password and then
 * their new phone. Shared by «Удирдлага» and «Бие даасан багш».
 *
 * ★ The operator first confirms who is asking — a "lost my phone" call is the
 * oldest way into somebody else's account. The routes are asked of the admin;
 * until one exists the dialog says what to do instead (`notReady`).
 */
export function ResetPasswordLinkDialog({
  path,
  person,
  username,
  notReady,
  notReadyStatuses = [404],
  onClose,
}: {
  /** The route that issues the link, answering `{ resetToken }`. */
  path: string;
  person: string;
  username?: string | null;
  notReady: string;
  /**
   * The answers that mean "not built yet". 404 by default; a parent's reset
   * also takes 409, which `POST /users/:id/password-reset` answers for a
   * guardian until the admin opens it to them (2026-10-14).
   */
  notReadyStatuses?: number[];
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const reset = useMutation({
    mutationFn: () => mutate(path, z.object({ resetToken: z.string() }), { method: "POST" }),
  });
  const who = username ? `${person} · ${username}` : person;

  if (reset.isSuccess) {
    return (
      <FormDialog open onOpenChange={(open) => !open && onClose()} title="Нууц үг сэргээх холбоос">
        <InvitationHandover
          token={reset.data.resetToken}
          path="/reset-password"
          title="Нууц үг сэргээх холбоос"
          subtitle={who}
          validity="Холбоос 1 цаг хүчинтэй. Нэвтэрсний дараа профайлаасаа шинэ утсаа бүртгэнэ."
          onClose={onClose}
        />
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      busy={reset.isPending}
      title="Нууц үг сэргээх"
      description={who}
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Болих
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!checked || reset.isPending}
            onClick={() => reset.mutate()}
          >
            {reset.isPending ? "Үүсгэж байна…" : "Холбоос үүсгэх"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-body text-muted">
          Нууц үгээ шинээр тохируулах нэг удаагийн холбоос үүснэ. Нууц үгийг та харахгүй.
        </p>
        <FormError
          message={
            reset.isError
              ? isNotFound(reset.error) ||
                (reset.error instanceof ApiError && notReadyStatuses.includes(reset.error.status))
                ? notReady
                : errorMessage(reset.error)
              : null
          }
        />
        <label className="flex items-start gap-2 text-body text-ink">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>
            Энэ хүнийг утсаар эсвэл биечлэн таньж, <strong>{person}</strong> мөн гэдгийг шалгасан.
          </span>
        </label>
      </div>
    </FormDialog>
  );
}
