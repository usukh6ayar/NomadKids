"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { childDetailSchema, GUARDIAN_RELATION_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { fullName } from "@/lib/format";
import { ResetPasswordLinkDialog } from "@/components/platform/reset-password-link-dialog";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError, LoadingState } from "@/components/ui/states";

/**
 * A parent's password reset is refused by the API until the admin opens it to
 * a director and the child's teacher (2026-10-14); until then it says so.
 */
export const GUARDIAN_RESET_NOT_READY =
  "Эцэг эхийн нууц үг сэргээх хэсэг хараахан бэлэн болоогүй. Утас нь гарт байвал «Нууц үгээ мартсан уу?»-аар өөрөө сэргээнэ.";

type Guardian = { id: string; lastName?: string | null; firstName: string };

/** The check-first, one-time link for one parent. */
export function GuardianResetDialog({
  guardian,
  onClose,
}: {
  guardian: Guardian;
  onClose: () => void;
}) {
  return (
    <ResetPasswordLinkDialog
      path={`/users/${guardian.id}/password-reset`}
      person={fullName(guardian)}
      notReady={GUARDIAN_RESET_NOT_READY}
      notReadyStatuses={[404, 409]}
      onClose={onClose}
    />
  );
}

/**
 * «⋯ → Эцэг эхийн нууц үг сэргээх» from a roster row — 2026-10-14, the user:
 * without opening the child. One parent opens straight away; two or more are
 * named first, «Аль эцэг эх?».
 */
export function GuardianResetPicker({
  childId,
  childName,
  onClose,
}: {
  childId: string;
  childName: string;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Guardian | null>(null);
  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });
  const parents = (child.data?.guardianships ?? []).flatMap((guardianship) =>
    guardianship.guardian
      ? [{ guardian: guardianship.guardian, relation: guardianship.relation }]
      : [],
  );

  const only = parents.length === 1 ? parents[0]!.guardian : null;
  if (chosen ?? only) return <GuardianResetDialog guardian={(chosen ?? only)!} onClose={onClose} />;

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Аль эцэг эх?"
      description={childName}
      footer={
        <Button type="button" size="sm" variant="secondary" onClick={onClose}>
          Болих
        </Button>
      }
    >
      {child.isLoading ? <LoadingState rows={2} /> : null}
      <FormError message={child.isError ? errorMessage(child.error) : null} />
      {child.data && parents.length === 0 ? (
        <p className="text-body text-muted">
          Энэ хүүхдэд холбогдсон эцэг эх алга. Хүүхдийн хуудаснаас урина уу.
        </p>
      ) : null}
      {parents.length > 1 ? (
        <ul className="flex flex-col gap-2">
          {parents.map(({ guardian, relation }) => (
            <li key={guardian.id}>
              <button
                type="button"
                onClick={() => setChosen(guardian)}
                className="flex min-h-12 w-full items-center justify-between rounded-control border border-border bg-white px-3 text-left text-body text-ink hover:bg-canvas"
              >
                <span className="font-semibold">{fullName(guardian)}</span>
                <span className="text-caption text-muted">
                  {GUARDIAN_RELATION_LABEL[relation] ?? relation}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </FormDialog>
  );
}
