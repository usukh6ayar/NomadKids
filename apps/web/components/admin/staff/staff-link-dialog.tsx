"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link2 } from "lucide-react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";
import { displayName, type StaffDirectoryRow } from "./staff-model";

/**
 * «Одоо байгаа бүртгэлтэй холбох» — tying an ESIS person to an account here.
 *
 * ★ **A person chooses, and that is the point.** The directory joins on
 * `esisPersonId`, and almost no account has one: it is written by
 * self-registration only, so on live data 12 of 13 were blank and the same
 * five people appeared twice on one screen. The obvious repair — match them by
 * name — is the one thing this design refuses, and the kindergarten that
 * prompted the feature is the argument: it employs a Соня Золжаргал *and* an
 * Ариунаа Золжаргал. A surname is not an identity.
 *
 * ★★ **The list offered is only accounts with no ESIS person yet.** Anyone
 * already linked is left out rather than shown and rejected with a 409, the
 * same courtesy `ManageTeachersDialog` extends to teachers already assigned.
 *
 * ★★★ The server checks all of this again and more — that the account is in
 * this kindergarten, that the ministry's own roster lists the person, that
 * nobody else holds them. Nothing here is a security control; it is the
 * shortest path to the choice.
 */
export function StaffLinkDialog({
  row,
  kindergartenId,
  candidates,
  onClose,
}: {
  /** The ESIS-only row the director pressed. */
  row: StaffDirectoryRow;
  kindergartenId: string;
  /** Local accounts not yet tied to an ESIS person. */
  candidates: StaffDirectoryRow[];
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const backdrop = useBackdropDismiss(onClose);

  const link = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/esis/staff-link`, z.unknown(), {
        method: "POST",
        body: { userId, esisPersonId: row.esisPersonId },
      }),
    onSuccess: () => {
      toast.success("Бүртгэл ЭСИС-ийн ажилтантай холбогдлоо.");
      /*
       * The directory is built from `/users` and the ESIS reads together, so
       * the accounts query is the one that has to come back — the ESIS rows
       * are unchanged, only which account claims them. Invalidating the whole
       * `["admin", "users"]` prefix covers the directory without re-asking the
       * ministry anything.
       */
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Бүртгэлтэй холбох"
      {...backdrop}
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[440px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (userId && !link.isPending) link.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <h2 className="text-title font-semibold text-ink">Бүртгэлтэй холбох</h2>
            <p className="mt-0.5 text-body text-muted">
              ЭСИС-ийн <span className="text-ink">{displayName(row)}</span> хэн болохыг сонгоно уу.
            </p>
          </div>

          <FormError message={link.isError ? errorMessage(link.error) : null} />

          {candidates.length === 0 ? (
            <p className="rounded-control bg-sun px-3 py-2 text-body text-sun-ink">
              Холбох боломжтой бүртгэл алга. Бүх бүртгэл аль хэдийн ЭСИС-тэй холбогдсон байна.
            </p>
          ) : (
            <>
              <Field
                label="Энэ системийн бүртгэл"
                hint="ЭСИС-тэй холбогдоогүй бүртгэлүүд харагдана."
              >
                {({ id }) => (
                  <Select
                    id={id}
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                  >
                    <option value="">Сонгоно уу</option>
                    {candidates.map((candidate) => (
                      <option key={candidate.localUserId!} value={candidate.localUserId!}>
                        {candidate.lastName} {candidate.firstName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {/*
                ★ Says what the link does *not* do. A director could reasonably
                read "холбох" as "this person now has an account" — they do
                not; the account already existed and this only records that the
                two are the same human.
              */}
              <p className="rounded-control bg-canvas px-3 py-2 text-caption leading-relaxed text-muted">
                Холбосноор шинэ бүртгэл үүсэхгүй. Хоёр бичлэг нэг хүн гэдгийг тэмдэглэж, жагсаалтад
                нэг мөр болно.
              </p>

              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button type="submit" disabled={!userId || link.isPending}>
                  <Link2 size={16} />
                  {link.isPending ? "Холбож байна…" : "Холбох"}
                </Button>
                <Button type="button" variant="ghost" onClick={onClose}>
                  Болих
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
