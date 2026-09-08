"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormError } from "@/components/ui/states";
import { GraduationCap, UserPlus, UsersRound } from "lucide-react";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  adminDashboardSchema,
  adminUserSchema,
  invitedUserSchema,
  paginated,
  type Role,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { StatCard } from "@/components/ui/stat-card";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";

const listSchema = paginated(adminUserSchema);

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
/**
 * The roles this screen's list asked the API for.
 *
 * ★ Kept after the list went: the count tile above still reads `total` from
 * `/users`, and that total means "staff" only. `ASSIGNABLE_ROLES` is exactly
 * that set (PARENT is deliberately absent from it), so this is derived rather
 * than restated — a sixth staff role appears here the day it appears there.
 */
const STAFF_ROLES = ASSIGNABLE_ROLES.join(",");

const ROLES: { value: Role; label: string }[] = ASSIGNABLE_ROLES.map((value) => ({
  value,
  label: ROLE_LABEL[value],
}));

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
  const [inviting, setInviting] = useState(false);

  /*
    ★ The response has been paginated since this screen was written; the screen
    asked for page one and rendered whatever came back.

    `pageSize: 50` was hardcoded and `total` / `totalPages` were both ignored,
    so a kindergarten with more than fifty accounts showed the first fifty and
    said nothing at all about the rest. The demo has twelve, which is why this
    was invisible — a real kindergarten of 200 children has that many guardians
    before its staff are counted.
  */
  /*
   * ★ One page of one row, for its `total` alone.

     The list this fed is gone; the count tile beside it is not, and `total` is
     the honest source for "Нийт ажилтан" — it counts server-side rather than
     folding whatever rows happened to load. `pageSize: 1` because the rows
     themselves are no longer read.
   */
  const users = useQuery({
    queryKey: qk.adminUsers({ q: "", role: "", page: "1" }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "1" });
      // Staff only — see `STAFF_ROLES`. Guardians are counted on `/admin`.
      params.set("roles", STAFF_ROLES);
      if (primaryKindergartenId) params.set("kindergartenId", primaryKindergartenId);
      return get(`/users?${params}`, listSchema);
    },
    enabled: Boolean(primaryKindergartenId),
  });

  /*
   * ★ The headline counts come from `/dashboard/admin`, not from this page of
   * fifty rows.
   *
   * "Хэдэн багштай вэ" is a fact about the kindergarten, and folding it out of
   * whatever fifty accounts happened to load would answer it wrongly the moment
   * there are fifty-one — a number that is right until it quietly is not. The
   * dashboard endpoint counts server-side, and `/admin` has usually fetched it
   * already, so on the way in from there this resolves from cache.
   */
  const overview = useQuery({
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Хэрэглэгчид"
        actions={
          <Button size="sm" onClick={() => setInviting(true)}>
            <UserPlus size={18} />
            Хэрэглэгч нэмэх
          </Button>
        }
      />

      {/*
        ★ Three tiles, and the third is the one this screen could not answer.

        A director opening Хэрэглэгч ба эрх is usually asking one of two things:
        how many staff accounts exist, and how many families are actually
        connected. The list answered neither — it opened on page one of fifty
        rows mixing all three roles, and the totals were in a different screen.

        `Нийт` comes from the list's own `total` because that figure is exactly
        what the filters above produce: with a role selected it narrows with
        them, which is the honest reading of "нийт" on a filtered list. The
        other two are kindergarten-wide and never narrow, so they are labelled
        for what they are.
      */}
      {/*
        ★ Two tiles now, not three — the "Эцэг эх" count went with the rows.

        It was the honest third figure while this screen listed families. It is
        not one on a staff directory: a tile counting people the list beneath
        it deliberately excludes is the kind of number somebody reads, then
        scrolls looking for. The guardians are counted on `/admin`, beside the
        children they belong to.
      */}
      <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3">
        <StatCard
          label="Нийт ажилтан"
          value={users.data?.total ?? "—"}
          unit="бүртгэл"
          tone="sky"
          art={<UsersRound size={22} aria-hidden />}
        />
        <StatCard
          label="Багш, ажилтан"
          value={overview.data?.counts.staff ?? "—"}
          unit="бүртгэл"
          tone="cornflower"
          art={<GraduationCap size={22} aria-hidden />}
        />
      </section>

      {/*
        ★ The staff, from ESIS — 2026-09-08, at the client's instruction, given
        twice with the consequence written out first.

        The local directory is gone, and with it its search, its role filter,
        its pager and every row control that had no other home: changing a
        role, revoking a membership, editing an account, resetting a password.
        Those endpoints still exist and still work; nothing in this product
        calls them any more. "Хэрэглэгч нэмэх" still invites, and the two count
        tiles above still come from our own records.

        ★★ Two panels, because ESIS answers the staff question with two
        services and neither is a subset of the other. `teacher/list` carries
        the teaching assignment — instructor type, subject department,
        availability — and `school/staff` carries employment: position, job
        code, years of service, the parent education authority. Merging them
        into one table would put a багш's empty `Ажилласан жил` beside a
        тогооч's filled one and imply the field failed rather than not applying.
      */}
      <EsisDataPanel resource="teachers" title="Багш нар" description="Томилгоо ба заах эрх" />
      <EsisDataPanel
        resource="staff"
        title="Ажилтнууд"
        description="Эрхлэгч, эмч, тогооч, нягтлан — албан тушаал ба ажил эрхлэлт"
      />

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
