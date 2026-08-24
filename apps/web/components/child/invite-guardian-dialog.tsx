"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { InvitationHandover } from "@/components/admin/invitation-handover";

const RELATIONS = [
  { value: "MOTHER", label: "Ээж" },
  { value: "FATHER", label: "Аав" },
  { value: "GRANDPARENT", label: "Өвөө, эмээ" },
  { value: "SIBLING", label: "Ах, эгч" },
  { value: "OTHER", label: "Бусад" },
] as const;

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
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState<string>("MOTHER");

  const invite = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/guardian-invitations`, resultSchema, {
        method: "POST",
        body: {
          username,
          lastName,
          firstName,
          relation,
          phone: phone.trim() === "" ? null : phone.trim(),
        },
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

  const errors = fieldErrors(invite.error);

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
            subtitle={`${invite.data.user.lastName} ${invite.data.user.firstName} — ${childName}-ийн хавтас руу`}
            onClose={onClose}
          />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!invite.isPending) invite.mutate();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <div>
              <h2 className="text-title font-semibold text-ink">Эцэг эх урих</h2>
              <p className="mt-0.5 text-body text-muted">
                {childName}-ийн хавтас руу. Урилга 7 хоног хүчинтэй.
              </p>
            </div>

            <FormError message={invite.isError ? errorMessage(invite.error) : null} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Овог" error={errors.lastName} required>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoFocus
                  />
                )}
              </Field>

              <Field label="Нэр" error={errors.firstName} required>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <Field
              label="Нэвтрэх нэр"
              error={errors.username}
              hint="Латин үсэг, тоо. Эцэг эх үүгээр нэвтэрнэ."
              required
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoCapitalize="none"
                />
              )}
            </Field>

            <Field label="Утас" error={errors.phone} hint="Заавал биш.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              )}
            </Field>

            <Field label="Хүүхэдтэй ямар хамааралтай" error={errors.relation} required>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                >
                  {RELATIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button type="submit" disabled={invite.isPending}>
                <UserPlus size={18} />
                {invite.isPending ? "Үүсгэж байна…" : "Урилга үүсгэх"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose} disabled={invite.isPending}>
                Болих
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
