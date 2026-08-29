"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { InvitationHandover } from "@/components/admin/invitation-handover";

const resultSchema = z.object({
  invitationToken: z.string(),
  user: z.object({ id: z.string(), lastName: z.string(), firstName: z.string() }),
});

/**
 * Inviting a family to a child's portfolio.
 *
 * ★ The teacher never types a password.
 *
 * The account is created with 32 random bytes nobody has seen, and the parent
 * chooses their own on the invitation screen. An adult who types a password for
 * someone else knows that password, and "temporary" credentials are permanent
 * in practice.
 *
 * ★★ The QR encodes the invitation link and nothing else.
 *
 * It is a way to move a URL from a screen into a phone, not a credential of its
 * own — the token inside it is the same one-time, seven-day token the API
 * issues, and it opens exactly one child's portfolio because the guardianship
 * was created for that child when the invitation was made. Handing a parent a
 * printed QR is the same act as reading them the link.
 *
 * Rendered on a canvas rather than fetched from an image service: the token
 * would otherwise be sent to a third party to draw.
 */
export function InviteGuardianDialog({
  childId,
  childName,
  trigger,
}: {
  childId: string;
  childName: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      {open ? (
        <InviteDialog childId={childId} childName={childName} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function InviteDialog({
  childId,
  childName,
  onClose,
}: {
  childId: string;
  childName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [isPrimary, setIsPrimary] = useState(false);

  const invite = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/guardian-invitations`, resultSchema, {
        method: "POST",
        body: { isPrimary },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${childName} — эцэг эх урих`}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[480px] rounded-card border border-border bg-surface p-5">
        {invite.isSuccess ? (
          <InvitationHandover
            token={invite.data.invitationToken}
            title="Урилга бэлэн"
            /*
              The child, not the guardian: at this point the guardian has no name
              — they supply it when they accept. Naming the child is also what a
              teacher holding up two codes needs to tell them apart.
            */
            subtitle={`${childName}-ийн хавтас руу`}
            onClose={onClose}
          />
        ) : (
          /*
            ★ One button, no form fields.

            This asked a teacher for a surname, a given name, a login handle, a
            phone and the relationship — five facts about a person standing in
            front of them who can type them faster and correctly. The guardian
            now gives their own name, phone and relationship when they accept;
            the teacher's whole job is to press this and hold up the code.
          */
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-title font-semibold text-ink">Эцэг эх урих</h2>
              <p className="mt-0.5 text-body text-muted">
                {childName}-ийн хавтас руу. QR код үүсгэн уншуулна — эцэг эх нэр, утсаа өөрөө
                бөглөнө. Урилга 7 хоног хүчинтэй.
              </p>
            </div>

            <FormError message={invite.isError ? errorMessage(invite.error) : null} />

            {/*
              The one thing the kindergarten decides rather than the guardian:
              which of two guardians is the first to be called.
            */}
            <Checkbox
              label="Үндсэн асран хамгаалагч"
              description="Яаралтай үед эхэлж холбогдоно."
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              disabled={invite.isPending}
            />

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button onClick={() => invite.mutate()} disabled={invite.isPending}>
                <QrCode size={18} aria-hidden="true" />
                {invite.isPending ? "Үүсгэж байна…" : "QR код үүсгэх"}
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={invite.isPending}>
                Болих
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
