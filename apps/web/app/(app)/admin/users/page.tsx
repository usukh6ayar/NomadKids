"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { ASSIGNABLE_ROLES, ROLE_LABEL, invitedUserSchema, type Role } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { RequireRole } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { StaffDirectory } from "@/components/admin/staff-directory";
import { fullName } from "@/lib/format";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";

/**
 * `POST /users/:id/password-reset`.
 *
 * The user is echoed back so the dialog can name who the link is for without
 * trusting the row it was opened from — which may have been refetched in the
 * meantime. Only the token is used beyond that.
 */

/** One row of the admin list — the shape both dialogs below edit. */

/**
 * The roles this screen may hand out.
 *
 * ★ From `@kinder/contracts` rather than restated here — 2026-08-30.
 *
 * Two more staff roles arrived that day (Тогооч, Нягтлан) and this list was one
 * of three places spelling the names inline. A local copy is how a fourth
 * screen ends up offering three roles when the system has five.
 *
 * PARENT is deliberately absent from `ASSIGNABLE_ROLES` — a guardian is
 * created by inviting them against a child, which is what links the family to
 * the record. Offering it here would make an account with no child attached.
 */
const ROLES: { value: Role; label: string }[] = ASSIGNABLE_ROLES.map((value) => ({
  value,
  label: ROLE_LABEL[value],
}));

/**
 * Багш, ажилтан — the staff directory.
 *
 * ★ **Renamed from "Хэрэглэгчид" and rebuilt, 2026-09-23.** What stood here
 * was an accurate description of the data and a poor description of the job:
 * the kindergarten's own accounts, then ESIS `teacher/list`, then ESIS
 * `school/staff`, then `teacherMovements`, then two мэргэшлийн зэрэг services,
 * each as a full-width panel of ministry field names. Six sections, five
 * outbound requests on first paint, and a person who works here appearing on
 * as many as three of them.
 *
 * The directory below merges those *concepts* — one row per person, joined on
 * `esisPersonId` — without merging the sources. `StaffDirectory` explains the
 * join; `staff-model.ts` is where it lives and is a pure function, so the
 * dedupe and the group-assignment rules are testable without a screen.
 *
 * ★★ **The raw panels are not deleted**, they are behind the second tab.
 * Reconciling our records against the ministry's is a real task and those
 * tables are how it is done — but it is not the task a director opens this
 * screen for, and it is not one they should pay five ministry requests for on
 * the way to finding a teacher's phone number. The tab renders nothing until
 * it is selected, so nothing is fetched until it is.
 *
 * ★★★ Creating a user here never sets a password. The API generates 32 random
 * bytes nobody sees and returns an invitation token; the person chooses their
 * own password on `/invitation/[token]`. An administrator who types a password
 * for someone else knows that password, and "temporary" credentials are
 * permanent in practice.
 */
export default function AdminUsersPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminStaff />
    </RequireRole>
  );
}

function AdminStaff() {
  const { primaryKindergartenId } = useSession();
  const [inviting, setInviting] = useState<Role | null>(null);

  /*
    ★ Багш and Ажилтан, as two tables — client, 2026-09-25, with two drawings.
    The count tiles and the ESIS panels that stood here are not in either, so
    they went; `StaffDirectory` carries the lists, the person panel and the
    row actions, and this screen keeps the invitation.
  */
  return (
    <>
      <StaffDirectory onInvite={setInviting} />
      {inviting && primaryKindergartenId ? (
        <InviteUserDialog
          kindergartenId={primaryKindergartenId}
          initialRole={inviting}
          onClose={() => setInviting(null)}
        />
      ) : null}
    </>
  );
}

function InviteUserDialog({
  kindergartenId,
  initialRole = "TEACHER",
  onClose,
}: {
  kindergartenId: string;
  /** The section the invitation was started from — Багш or Ажилтан. */
  initialRole?: Role;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(initialRole);

  const invite = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/users`, invitedUserSchema, {
        method: "POST",
        body: {
          username,
          lastName,
          firstName,
          role,
          email: email.trim() === "" ? null : email.trim(),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const errors = fieldErrors(invite.error);
  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Хэрэглэгч нэмэх"
      {...backdrop}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[480px] rounded-card border border-border bg-surface p-5">
        {invite.isSuccess ? (
          <InvitationHandover
            token={invite.data.invitationToken}
            title="Урилга бэлэн"
            subtitle={`${fullName(invite.data.user)} — ${ROLE_LABEL[role]}`}
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
              <h2 className="text-title font-semibold text-ink">Хэрэглэгч нэмэх</h2>
              <p className="mt-0.5 text-body text-muted">
                Нууц үгээ тэр хүн өөрөө сонгоно. Урилга 7 хоног хүчинтэй.
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
              hint="Латин үсэг, тоо, . _ -"
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

            <Field label="И-мэйл" error={errors.email} hint="Заавал биш.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoCapitalize="none"
                />
              )}
            </Field>

            <Field label="Эрх" error={errors.role} required>
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {/*
              Parents are normally invited from a child's page: that flow
              attaches the guardianship at the same time, so the account is
              bound to a child from the moment it exists. Creating one here
              makes an account with no children attached.
            */}
            {role === "PARENT" ? (
              <p className="rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
                Эцэг эхийг ихэвчлэн хүүхдийн хуудаснаас урина — тэгвэл хүүхэдтэй нь шууд холбогдоно.
                Эндээс үүсгэвэл хүүхэдгүй бүртгэл үүснэ.
              </p>
            ) : null}

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
