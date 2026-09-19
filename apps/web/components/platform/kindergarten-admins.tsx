"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { platformAdminInvitedSchema, type PlatformAdmin } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, FormError } from "@/components/ui/states";
import { InvitationHandover } from "@/components/admin/invitation-handover";

/**
 * Who administers this kindergarten, and the way to add one.
 *
 * ★ The gap this closes. `POST /kindergartens/:id/users` — what `/admin/users`
 * calls — is `@Roles("ADMIN")`, and a platform operator holds no membership,
 * so it answers them 404. Correct (CLAUDE.md §1.1), and it left one situation
 * with no route out inside the product: a kindergarten whose only director
 * cannot sign in, because the invitation was closed without being handed over,
 * or expired, or the person left. The answer was a shell on the server, which
 * is not an answer for somebody onboarding kindergartens.
 *
 * ★★ The list exists for `lastLoginAt`, not for the names.
 *
 * "Who administers this" is a question the operator can mostly guess. "Can
 * anybody actually get in" is the one they cannot, and a director who was
 * invited and never accepted looks identical to a working one in every other
 * column. That is exactly the tenant that needs a second invitation, so the
 * row says **Нэвтэрч байгаагүй** in as many words rather than leaving a date
 * column blank.
 *
 * ★★★ Adding one grants the operator nothing new. Registering a kindergarten
 * already creates its first ADMIN and hands them that invitation — this is the
 * same act at a later moment, and it writes the same kind of audit row.
 */
export function KindergartenAdmins({
  kindergartenId,
  admins,
}: {
  kindergartenId: string;
  admins: PlatformAdmin[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby="platform-admins-heading">
      <SectionHeader
        id="platform-admins-heading"
        title="Удирдлага"
        lede="Энэ цэцэрлэгийг удирдах эрхтэй хүмүүс. Багш, ажилтныг тэд өөрсдөө нэмнэ."
        action={
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <UserPlus size={18} aria-hidden />
            Удирдлага нэмэх
          </Button>
        }
      />

      <Card pad="roomy">
        {admins.length === 0 ? (
          /*
           * Reachable, and the worst state there is: a tenant nobody can
           * administer. It should read as a problem to fix rather than as an
           * empty table.
           */
          <EmptyState
            title="Удирдлагагүй байна"
            description="Энэ цэцэрлэгт нэвтрэх эрхтэй хүн алга. Дээрх товчоор удирдлага нэмнэ үү."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {admins.map((admin) => (
              <li
                key={admin.id}
                className="flex min-h-[56px] flex-wrap items-center gap-x-3 gap-y-1 rounded-row border border-border-soft px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-ink">
                    {admin.lastName} {admin.firstName}
                  </span>
                  <span className="block truncate text-caption text-muted">
                    {admin.username}
                    {admin.email ? ` · ${admin.email}` : ""}
                  </span>
                </span>

                {admin.isActive ? null : <Badge>Идэвхгүй</Badge>}

                {admin.lastLoginAt ? (
                  <span className="shrink-0 text-caption text-muted">
                    Сүүлд нэвтэрсэн: {formatRelative(admin.lastLoginAt)}
                  </span>
                ) : (
                  <Badge tone="sun">Нэвтэрч байгаагүй</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {adding ? (
        <AddAdminDialog kindergartenId={kindergartenId} onClose={() => setAdding(false)} />
      ) : null}
    </section>
  );
}

function AddAdminDialog({
  kindergartenId,
  onClose,
}: {
  kindergartenId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");

  const create = useMutation({
    mutationFn: () =>
      mutate(`/platform/kindergartens/${kindergartenId}/admins`, platformAdminInvitedSchema, {
        method: "POST",
        body: {
          username,
          lastName,
          firstName,
          email: email.trim() === "" ? null : email.trim(),
          phone: null,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.platformKindergarten(kindergartenId) });
      void queryClient.invalidateQueries({ queryKey: qk.platformStats() });
    },
  });

  const errors = fieldErrors(create.error);

  if (create.isSuccess) {
    return (
      <FormDialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title="Урилга бэлэн"
      >
        <InvitationHandover
          token={create.data.invitationToken}
          title="Урилга бэлэн"
          subtitle={`${create.data.user.lastName} ${create.data.user.firstName} — Захирал/Эрхлэгч`}
          onClose={onClose}
        />
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      busy={create.isPending}
      title="Удирдлага нэмэх"
      description="Нууц үг энд тавигдахгүй — тэр хүн урилгын холбоосоор орж өөрөө сонгоно."
      footer={
        <>
          <Button type="submit" form="add-admin-form" disabled={create.isPending}>
            <UserPlus size={18} aria-hidden />
            {create.isPending ? "Үүсгэж байна…" : "Урилга үүсгэх"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
            Болих
          </Button>
        </>
      }
    >
      <form
        id="add-admin-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!create.isPending) create.mutate();
        }}
      >
        <FormError message={create.isError ? errorMessage(create.error) : null} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Овог" error={errors.lastName} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
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
                onChange={(event) => setFirstName(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Нэвтрэх нэр" error={errors.username} hint="Латин үсэг, тоо, . _ -" required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
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
              onChange={(event) => setEmail(event.target.value)}
              autoCapitalize="none"
            />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}
