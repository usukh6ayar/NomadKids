"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { UserPlus, X } from "lucide-react";
import { adminUserSchema, invitedUserSchema, paginated, type Role } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { fullName, initials } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowList } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";

const listSchema = paginated(adminUserSchema);

const ROLES: { value: Role; label: string }[] = [
  { value: "TEACHER", label: "Багш" },
  { value: "ADMIN", label: "Админ" },
  { value: "PARENT", label: "Эцэг эх" },
];

const ROLE_LABEL: Record<string, string> = {
  TEACHER: "Багш",
  ADMIN: "Админ",
  PARENT: "Эцэг эх",
};

/**
 * Staff and families in this kindergarten.
 *
 * ★ Creating a user here never sets a password.
 *
 * The API generates 32 random bytes nobody sees and returns an invitation
 * token; the person chooses their own password on `/invitation/[token]`. An
 * administrator who types a password for someone else knows that password, and
 * "temporary" credentials are permanent in practice.
 *
 * ★★ Parents are normally invited from a child's page, not here.
 *
 * That flow attaches the guardianship at the same time, so the account is bound
 * to a child from the moment it exists. Creating a PARENT here makes an account
 * with no children attached — occasionally what you want (a second guardian
 * added later), usually not. The copy says so rather than hiding the option.
 */
export default function AdminUsersPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminUsers />
    </RequireRole>
  );
}

function AdminUsers() {
  const { primaryKindergartenId } = useSession();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string>("");
  const [inviting, setInviting] = useState(false);

  const users = useQuery({
    queryKey: qk.adminUsers({ q: query, role }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (query.trim()) params.set("q", query.trim());
      if (role) params.set("role", role);
      if (primaryKindergartenId) params.set("kindergartenId", primaryKindergartenId);
      return get(`/users?${params}`, listSchema);
    },
    enabled: Boolean(primaryKindergartenId),
  });

  const items = users.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader
        title="Хэрэглэгчид"
        lede="Багш, админ, эцэг эхийн бүртгэл."
        actions={
          <Button size="sm" onClick={() => setInviting(true)}>
            <UserPlus size={18} />
            Хэрэглэгч нэмэх
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Нэрээр хайх"
          placeholder="Нэр эсвэл нэвтрэх нэрээр хайх"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-[320px] flex-1"
        />
        <Select
          aria-label="Эрхээр шүүх"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="max-w-[180px]"
        >
          <option value="">Бүх эрх</option>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>

      {users.isLoading ? <LoadingState rows={5} /> : null}
      {users.isError ? <ErrorState description={errorMessage(users.error)} /> : null}

      {users.data && items.length === 0 ? (
        <EmptyState
          title="Хэрэглэгч олдсонгүй"
          description={query || role ? "Шүүлтээ өөрчилж үзнэ үү." : "Эхний багшаа нэмээрэй."}
        />
      ) : null}

      {items.length > 0 ? (
        <RowList>
          {items.map((user) => (
            <div
              key={user.id}
              className="flex min-h-[64px] flex-wrap items-center gap-3 rounded-row border border-border bg-surface px-4 py-3"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-pill bg-primary-soft text-body font-semibold text-primary">
                {initials(user)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-lead font-semibold text-ink">
                  {fullName(user)}
                </span>
                <span className="mt-px block truncate text-compact text-muted">
                  {[user.username, user.email, user.phone].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>

              <span className="flex flex-wrap items-center gap-1">
                {user.memberships.map((m) =>
                  m.isActive === false ? (
                    // Kept visible rather than filtered out. The record of the
                    // relationship survives revocation, and an admin looking
                    // for "why can this teacher not see the group" needs to see
                    // that the answer is here.
                    <Badge key={m.id} tone="neutral">
                      {ROLE_LABEL[m.role] ?? m.role} · хураасан
                    </Badge>
                  ) : (
                    <span key={m.id} className="flex items-center gap-1">
                      <Badge tone={m.role === "ADMIN" ? "peach" : "sky"}>
                        {ROLE_LABEL[m.role] ?? m.role}
                      </Badge>
                      <RevokeMembershipButton
                        membershipId={m.id}
                        label={`${fullName(user)} — ${ROLE_LABEL[m.role] ?? m.role}`}
                      />
                    </span>
                  ),
                )}
                {user.isActive === false ? <Badge tone="sun">Идэвхгүй</Badge> : null}
              </span>
            </div>
          ))}
        </RowList>
      ) : null}

      {inviting && primaryKindergartenId ? (
        <InviteUserDialog
          kindergartenId={primaryKindergartenId}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </div>
  );
}

function InviteUserDialog({
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
  const [role, setRole] = useState<Role>("TEACHER");

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Хэрэглэгч нэмэх"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[480px] rounded-card border border-border bg-surface p-5">
        {invite.isSuccess ? (
          <InvitationHandover
            token={invite.data.invitationToken}
            title="Урилга бэлэн"
            subtitle={`${invite.data.user.lastName} ${invite.data.user.firstName} — ${ROLE_LABEL[role]}`}
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

/**
 * Revoking one membership.
 *
 * ★ This is how a teacher who has left loses access, and there was no way to
 * do it from the product.
 *
 * `DELETE /memberships/:id` deactivates rather than deleting — the record of
 * the relationship survives, so a group a teacher taught still says who taught
 * it. The effect on access is immediate: `Actor` is rebuilt from `Membership`
 * on every request, so the next one they make already fails.
 *
 * ★ It also ends every group assignment the membership carried, and
 * re-granting does NOT bring them back.
 *
 * That is deliberate in the API — reactivating a membership must not silently
 * restore access to groups nobody re-granted — but it is invisible from here,
 * so the confirmation says it. An admin who revokes a teacher by mistake and
 * puts the role back would otherwise be left wondering why their rosters are
 * empty.
 *
 * Confirmed, because it takes someone's access away and the row it acts on is
 * a badge among several. The confirmation names which person and which role,
 * so a mis-click on a user with two memberships is not silently the wrong one.
 */
function RevokeMembershipButton({ membershipId, label }: { membershipId: string; label: string }) {
  const queryClient = useQueryClient();

  const revoke = useMutation({
    mutationFn: () => mutate(`/memberships/${membershipId}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  return (
    <button
      type="button"
      disabled={revoke.isPending}
      onClick={() => {
        if (
          window.confirm(
            `${label} эрхийг хураах уу?\n\n` +
              "Бүлгийн хуваарилалт нь мөн дуусна. Эрхийг буцааж өгөхөд хуваарилалт " +
              "автоматаар сэргэхгүй тул дахин хийх шаардлагатай.",
          )
        ) {
          revoke.mutate();
        }
      }}
      className="grid size-[28px] place-items-center rounded-pill text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
    >
      <X size={14} aria-hidden />
      <span className="sr-only">{label} эрхийг хураах</span>
    </button>
  );
}
