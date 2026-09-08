"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  FileBadge,
  GraduationCap,
  KeyRound,
  Pencil,
  ShieldPlus,
  UserCog,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  adminDashboardSchema,
  adminUserSchema,
  invitedUserSchema,
  kindergartenSchema,
  paginated,
  type Role,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatRelative, fullName, initials } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataList, DataRow } from "@/components/ui/data-list";
import { RowMenu, type RowMenuItem } from "@/components/ui/menu";
import { StatCard } from "@/components/ui/stat-card";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { StaffRecordsDialog } from "@/components/admin/staff-records-dialog";

const listSchema = paginated(adminUserSchema);

/**
 * `POST /users/:id/password-reset`.
 *
 * The user is echoed back so the dialog can name who the link is for without
 * trusting the row it was opened from — which may have been refetched in the
 * meantime. Only the token is used beyond that.
 */
const resetIssuedSchema = z.object({ resetToken: z.string() });

/** One row of the admin list — the shape both dialogs below edit. */
type AdminUser = z.infer<typeof adminUserSchema>;

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
 * The list's columns, shared by its header strip and every row.
 *
 * ★ The client's four, named — 2026-09-06: "list-ээр харуулах email албан
 * тушаал нэр н тр н харагддаг байх".
 *
 * The name is `DataRow`'s own `title` rather than a column, so what is declared
 * here is the other three plus the fact this screen is opened to check. Contact
 * details were a single `username · email · phone` subtitle before, which put
 * three different kinds of thing on one line and made the email — the one a
 * director copies — impossible to scan down.
 *
 * `Эрх` no longer carries controls of its own, so it needs half the width it
 * did; `Сүүлд нэвтэрсэн` is sized for `formatRelative`'s longest output
 * ("13 хоногийн өмнө").
 */
const USER_COLUMNS = [
  { key: "email", label: "И-мэйл", className: "md:w-[220px]" },
  { key: "phone", label: "Утас", className: "md:w-[112px]" },
  { key: "roles", label: "Албан тушаал", className: "md:w-[188px]" },
  { key: "lastLogin", label: "Сүүлд нэвтэрсэн", className: "md:w-[140px]" },
];

/**
 * The roles this screen lists — every role except PARENT.
 *
 * ★ Sent to the API as `roles=`, not filtered in the browser — 2026-09-06.
 *
 * The client's instruction was flat: "хэрэглэгч эрх дотор ерөөсөө эцэг эх
 * байхгүй". A guardian is reached from their child, where the guardianship
 * that gives the account its meaning is visible; here they were most of the
 * rows and none of the work. Dropping them client-side would have been wrong
 * on a paginated endpoint — see `rolesSchema` in `users.dto.ts`.
 *
 * `ASSIGNABLE_ROLES` is exactly this set already (PARENT is deliberately
 * absent from it), so this is derived rather than restated: a sixth staff role
 * appears here the day it appears there.
 */
const STAFF_ROLES = ASSIGNABLE_ROLES.join(",");

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
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);

  /*
    ★ A new filter starts at page one.

    `/admin/audit` learned this first and says why: filtering from page four
    shows an empty result that reads as "no such users" rather than "no such
    users *on this page*".
  */
  function narrow(change: () => void) {
    change();
    setPage(1);
  }

  /*
    ★ The response has been paginated since this screen was written; the screen
    asked for page one and rendered whatever came back.

    `pageSize: 50` was hardcoded and `total` / `totalPages` were both ignored,
    so a kindergarten with more than fifty accounts showed the first fifty and
    said nothing at all about the rest. The demo has twelve, which is why this
    was invisible — a real kindergarten of 200 children has that many guardians
    before its staff are counted.
  */
  const users = useQuery({
    queryKey: qk.adminUsers({ q: query, role, page: String(page) }),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      // Staff only — see `STAFF_ROLES`. The role picker below narrows *within*
      // this set; it can never widen it back to include guardians.
      params.set("roles", STAFF_ROLES);
      if (query.trim()) params.set("q", query.trim());
      if (role) params.set("role", role);
      if (primaryKindergartenId) params.set("kindergartenId", primaryKindergartenId);
      return get(`/users?${params}`, listSchema);
    },
    enabled: Boolean(primaryKindergartenId),
    // The list does not collapse to a skeleton on every keystroke — same
    // reasoning as `/admin/audit` and `/children`.
    placeholderData: (previous) => previous,
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

  const items = users.data?.items ?? [];

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
          label={role ? "Шүүлтэд тохирсон" : "Нийт ажилтан"}
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

      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Нэрээр хайх"
          placeholder="Нэр эсвэл нэвтрэх нэрээр хайх"
          value={query}
          onChange={(e) => narrow(() => setQuery(e.target.value))}
          className="max-w-[320px] flex-1"
        />
        <Select
          aria-label="Эрхээр шүүх"
          value={role}
          onChange={(e) => narrow(() => setRole(e.target.value))}
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
          title="Ажилтан олдсонгүй"
          description={query || role ? "Шүүлтээ өөрчилж үзнэ үү." : "Эхний багшаа нэмээрэй."}
        />
      ) : null}

      {items.length > 0 ? <ResultCount total={users.data!.total} noun="ажилтан" /> : null}

      {/*
        ★ One overflow menu per row, replacing five controls spread across two
        cells — 2026-09-06, at the client's request: "3 цэг буюу цэсээр
        оруулаад засах устгах эрх нэмэх гэх мэт н цэснд харагдана".

        The previous row put "Засах" and "Эрх нэмэх" in the actions gutter and
        hung two 44px icon buttons off *every badge* in the Эрх cell — so a
        director with a dual-role account read five controls before they read
        the person's telephone number. The note this replaces argued the other
        way ("two controls is not a menu's worth"), and it was right about two.
        It is five, and they are not all about the same object: three act on a
        membership and two on the account.

        What the row is for is reading. The name, the email, the phone and the
        role are the four things a staff list is opened to check, and they now
        occupy the row without a control between them.
      */}
      {items.length > 0 ? (
        <DataList
          columns={USER_COLUMNS}
          actionsWidth="w-[56px]"
          className={users.isPlaceholderData ? "opacity-60" : ""}
        >
          {items.map((user) => (
            <UserRow key={user.id} user={user} />
          ))}
        </DataList>
      ) : null}

      {users.data ? (
        <Pagination page={users.data.page} totalPages={users.data.totalPages} onPage={setPage} />
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

/**
 * One person in the staff directory: four facts, and one menu.
 *
 * ★ The dialogs live here rather than inside the menu entries.
 *
 * `RowMenu` closes before it runs a handler — it has to, or the menu would
 * still be mounted underneath the dialog and would swallow the outside-press
 * that dismisses it. That rules out a `Dialog.Trigger` as a menu entry, so the
 * row owns which dialog is open and every dialog below it is controlled. See
 * the note on `ConfirmDialog`'s `trigger` prop.
 *
 * ★★ Membership actions are named with the role they act on.
 *
 * "Албан тушаал солих" is meaningless on an account that holds two, and most
 * staff hold exactly one — where naming it reads naturally ("Албан тушаал
 * солих (Багш)") and costs nothing. Listing one entry per active membership is
 * the honest form of the rare case rather than a picker inside a picker.
 */
type RowDialog =
  | { kind: "edit" }
  | { kind: "membership" }
  | { kind: "reset" }
  | { kind: "staff" }
  | { kind: "role"; membershipId: string; role: Role }
  | { kind: "revoke"; membershipId: string; role: Role };

function UserRow({ user }: { user: AdminUser }) {
  const { session, primaryKindergartenId } = useSession();
  const [dialog, setDialog] = useState<RowDialog | null>(null);
  const name = fullName(user);
  const active = user.memberships.filter((m) => m.isActive !== false);

  /*
   * ★ "Эрх нэмэх" is omitted when there is nothing to grant into.
   *
   * `AddMembershipDialog` already returns null in that case — the same
   * derivation `TenantAccessService.adminKindergartenIds` makes on the server —
   * and before the overflow menu that was enough, because the control it
   * withheld was the button itself. A menu entry that opens an empty dialog is
   * worse than the button ever was: it looks like an action and does nothing.
   */
  const canGrant = (session?.memberships ?? []).some((m) => m.role === "ADMIN");

  const items: RowMenuItem[] = [
    {
      label: "Засах",
      icon: <Pencil size={16} aria-hidden />,
      onSelect: () => setDialog({ kind: "edit" }),
    },
    {
      label: "Нууц үг сэргээх",
      icon: <KeyRound size={16} aria-hidden />,
      onSelect: () => setDialog({ kind: "reset" }),
    },
    /*
      ★ "Хувийн хэрэг" — the staff file (А/261 шалгуур 51).

      A menu entry rather than the row button it was, because this row's
      actions became an overflow menu on 2026-09-06. Omitted entirely when
      there is no kindergarten in scope: a super-admin listing users across the
      platform has no single one to file a record under, and the endpoint is
      scoped to exactly that.
    */
    ...(primaryKindergartenId
      ? [
          {
            label: "Хувийн хэрэг",
            icon: <FileBadge size={16} aria-hidden />,
            onSelect: () => setDialog({ kind: "staff" }),
          },
        ]
      : []),
    ...(canGrant
      ? [
          {
            label: "Эрх нэмэх",
            icon: <ShieldPlus size={16} aria-hidden />,
            onSelect: () => setDialog({ kind: "membership" }),
          },
        ]
      : []),
    ...active.map((m) => ({
      label: `Албан тушаал солих${active.length > 1 ? ` (${ROLE_LABEL[m.role] ?? m.role})` : ""}`,
      icon: <UserCog size={16} aria-hidden />,
      onSelect: () => setDialog({ kind: "role", membershipId: m.id, role: m.role }),
    })),
    ...active.map((m) => ({
      label: `Эрх хураах${active.length > 1 ? ` (${ROLE_LABEL[m.role] ?? m.role})` : ""}`,
      icon: <X size={16} aria-hidden />,
      tone: "danger" as const,
      onSelect: () => setDialog({ kind: "revoke", membershipId: m.id, role: m.role }),
    })),
  ];

  const close = () => setDialog(null);

  return (
    <>
      <DataRow
        lead={
          <span className="grid size-10 place-items-center rounded-pill bg-primary-soft text-body font-semibold text-primary">
            {initials(user)}
          </span>
        }
        title={name}
        subtitle={user.username ?? "—"}
        cells={{
          // A missing email is a real gap on a staff account — it is how a
          // reset link reaches somebody — so it is named rather than dashed.
          email: user.email ? (
            <span className="block truncate text-body text-ink">{user.email}</span>
          ) : (
            <span className="text-body text-faint">Бүртгээгүй</span>
          ),
          phone: user.phone ? (
            <span className="text-body text-ink">{user.phone}</span>
          ) : (
            <span className="text-body text-faint">—</span>
          ),
          roles: (
            <span className="flex flex-wrap items-center gap-1">
              {user.memberships.map((m) =>
                m.isActive === false ? (
                  // Kept visible rather than filtered out. The record of the
                  // relationship survives revocation, and an admin looking for
                  // "why can this teacher not see the group" needs to see that
                  // the answer is here.
                  <Badge key={m.id} tone="neutral">
                    {ROLE_LABEL[m.role] ?? m.role} · хураасан
                  </Badge>
                ) : (
                  <Badge key={m.id} tone={m.role === "ADMIN" ? "peach" : "sky"}>
                    {ROLE_LABEL[m.role] ?? m.role}
                  </Badge>
                ),
              )}
              {user.isActive === false ? <Badge tone="sun">Идэвхгүй</Badge> : null}
            </span>
          ),
          lastLogin: user.lastLoginAt ? (
            <span className="text-body text-muted">{formatRelative(user.lastLoginAt)}</span>
          ) : (
            // Not an em dash: "never signed in" is a fact about the account,
            // and the dash this list uses for a missing value would read as
            // "we do not know".
            <span className="text-body text-faint">Нэвтрээгүй</span>
          ),
        }}
        actions={<RowMenu ariaLabel={`${name} — үйлдэл`} items={items} />}
      />

      <EditUserDialog user={user} open={dialog?.kind === "edit"} onOpenChange={close} />
      <AddMembershipDialog user={user} open={dialog?.kind === "membership"} onOpenChange={close} />
      <PasswordResetDialog user={user} open={dialog?.kind === "reset"} onOpenChange={close} />

      {dialog?.kind === "staff" && primaryKindergartenId ? (
        <StaffRecordsDialog user={user} kindergartenId={primaryKindergartenId} onClose={close} />
      ) : null}

      {/*
        Keyed by the membership so switching between two roles in the menu
        remounts the dialog with the right starting value — its `Select` seeds
        from `currentRole` once, on mount.
      */}
      {dialog?.kind === "role" ? (
        <ChangeRoleDialog
          key={dialog.membershipId}
          membershipId={dialog.membershipId}
          currentRole={dialog.role}
          label={name}
          open
          onOpenChange={close}
        />
      ) : null}

      {dialog?.kind === "revoke" ? (
        <RevokeMembershipDialog
          key={dialog.membershipId}
          membershipId={dialog.membershipId}
          label={`${name} — ${ROLE_LABEL[dialog.role] ?? dialog.role}`}
          open
          onOpenChange={close}
        />
      ) : null}
    </>
  );
}

/**
 * A one-time password-reset link for a member of staff — `POST
 * /users/:id/password-reset`, added 2026-09-06.
 *
 * ★ An administrator never types somebody else's password, and this does not
 * let them start.
 *
 * The client asked for "нууц үг солих" on the staff row. The literal reading —
 * a field where a director sets a teacher's password — is the one thing this
 * API has refused since the day accounts were invented here, and for a reason
 * that has not changed: whoever types a password knows it, and a "temporary"
 * one is permanent in practice. What a locked-out teacher actually needs is a
 * way back in, so this issues the same one-time link the forgot-password flow
 * issues and hands it over on the same screen an invitation is handed over on.
 *
 * ★★ The link is shown once and is not retrievable. `InvitationHandover` says
 * so in its own docblock; nothing here is written to storage.
 */
function PasswordResetDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();

  const issue = useMutation({
    mutationFn: () =>
      mutate(`/users/${user.id}/password-reset`, resetIssuedSchema, { method: "POST" }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  // A fresh dialog each time: a token from a previous opening must not be on
  // screen when the next one starts.
  useEffect(() => {
    if (open) issue.reset();
    // `issue` is a stable mutation object, so it is not a dependency.
  }, [open]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={issue.isPending}
      title="Нууц үг сэргээх"
      description={`${fullName(user)} — нэг удаагийн холбоос үүсгэнэ.`}
      footer={
        issue.isSuccess ? null : (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={issue.isPending}
              onClick={() => onOpenChange(false)}
            >
              Болих
            </Button>
            <Button size="sm" disabled={issue.isPending} onClick={() => issue.mutate()}>
              {issue.isPending ? "Үүсгэж байна…" : "Холбоос үүсгэх"}
            </Button>
          </>
        )
      }
    >
      {issue.isSuccess ? (
        <InvitationHandover
          token={issue.data.resetToken}
          path="/reset-password"
          validity="Холбоос 1 цаг хүчинтэй."
          title="Холбоос бэлэн"
          subtitle={`${fullName(user)} — нууц үгээ өөрөө шинээр сонгоно.`}
          onClose={() => onOpenChange(false)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <FormError message={issue.isError ? errorMessage(issue.error) : null} />
          <p className="text-body text-muted">
            Шинэ нууц үгийг та оруулахгүй. Энэ хүн холбоосоор орж нууц үгээ өөрөө сонгоно. Өмнө
            үүсгэсэн холбоос байвал хүчингүй болно.
          </p>
        </div>
      )}
    </FormDialog>
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
/**
 * Moving a member of staff to another role — "албан тушаал солих", 2026-09-04.
 *
 * ★ One request, not revoke-then-grant.
 *
 * Both of those endpoints existed and this screen could have called them in
 * order. It must not: between the two calls the person holds no role at all,
 * and a failure on the second leaves a teacher demoted to nothing. `PATCH
 * /memberships/:id` does the pair inside one transaction — see
 * `users.repository.ts`.
 *
 * ★★ Confirmed, unlike the plain edit form on this screen.
 *
 * That form's note reserves `ConfirmDialog` for what is destructive or hard to
 * undo and argues that a prompt in front of a typo fix teaches people to click
 * through prompts. A role change is on the other side of that line: it ends
 * every group assignment the old role carried, and re-granting the role does
 * not bring them back — the same consequence, and the same sentence, the
 * revoke dialog beside it already warns about.
 */
function ChangeRoleDialog({
  membershipId,
  currentRole,
  label,
  open,
  onOpenChange,
}: {
  membershipId: string;
  currentRole: Role;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<string>(currentRole);

  const change = useMutation({
    mutationFn: () =>
      mutate(`/memberships/${membershipId}`, z.unknown(), { method: "PATCH", body: { role } }),
    onSuccess: () => {
      toast.success("Албан тушаалыг өөрчиллөө.");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Албан тушаал солих"
      description={
        `${label} — одоогийн эрх: ${ROLE_LABEL[currentRole] ?? currentRole}. ` +
        "Шинэ эрх сонгоно уу. Хуучин эрхэд харьяалагдах бүлгийн хуваарилалт дуусна."
      }
      body={
        <Field label="Шинэ албан тушаал">
          {({ id }) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      }
      confirmLabel="Солих"
      pendingLabel="Солиж байна…"
      pending={change.isPending}
      onConfirm={() => change.mutate()}
    />
  );
}

function RevokeMembershipDialog({
  membershipId,
  label,
  open,
  onOpenChange,
}: {
  membershipId: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const revoke = useMutation({
    mutationFn: () => mutate(`/memberships/${membershipId}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Эрхийг хураалаа.");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /*
   * ★ 28px and a `window.confirm`, both of which this product had already
   * ruled out everywhere else.
   *
   * `globals.css` documents `--size-tap: 44px` as a floor rather than a
   * preference — "so a component cannot quietly ship a 32px button that is
   * unusable with a thumb" — and `responsive.test.tsx` asserts it against
   * `Button`'s variants. This was a hand-rolled `<button>`, so it never passed
   * through the component the test guards, and it shipped at 28px: the
   * smallest control in the product, on the one action here that cannot be
   * undone.
   *
   * `confirm-dialog.tsx` says in its own first line that it replaced
   * `window.confirm` in five places. This was a sixth, and it is the case that
   * argues hardest for it — the native dialog renders its buttons in the
   * browser's language, so a Mongolian sentence about revoking a teacher's
   * access was answered with an English "OK".
   */
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Эрхийг хураах уу?"
      description={
        `${label} эрхийг хураана. Бүлгийн хуваарилалт нь мөн дуусна. ` +
        "Эрхийг буцааж өгөхөд хуваарилалт автоматаар сэргэхгүй тул дахин хийх шаардлагатай."
      }
      confirmLabel="Хураах"
      pendingLabel="Хурааж байна…"
      tone="danger"
      pending={revoke.isPending}
      onConfirm={() => revoke.mutate()}
    />
  );
}

/**
 * Correcting an existing account — `PATCH /users/:id`.
 *
 * ★ The fields are exactly what `updateUserSchema` accepts, and no more.
 *
 * The DTO allows `lastName`, `firstName`, `email`, `phone` and `isActive`.
 * `username` is deliberately absent from it: it is a login identifier other
 * people may already have been told, and the API offers no way to change it —
 * so this form shows it read-only rather than offering an input that would be
 * silently dropped. The professional fields (`specialization`, `education`,
 * `bio`) belong to `PATCH /me/profile`; they are the user's own to write, and
 * an admin editing somebody's biography is not a capability this API grants.
 *
 * ★★ No confirmation. An edit with an explicit "Хадгалах" is already
 * deliberate, and `ConfirmDialog` is reserved for what is destructive or hard
 * to undo — putting a prompt in front of a typo fix teaches people to click
 * through prompts.
 */
function EditUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [form, setForm] = useState({
    lastName: user.lastName,
    firstName: user.firstName,
    email: user.email ?? "",
    phone: user.phone ?? "",
    isActive: user.isActive !== false,
  });

  const save = useMutation({
    mutationFn: () =>
      mutate(`/users/${user.id}`, adminUserSchema, {
        method: "PATCH",
        body: {
          lastName: form.lastName.trim(),
          firstName: form.firstName.trim(),
          // `null` clears the field. `""` would fail the API's email format
          // check, which is the difference between "no email" and "bad email".
          email: form.email.trim() === "" ? null : form.email.trim(),
          phone: form.phone.trim() === "" ? null : form.phone.trim(),
          isActive: form.isActive,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success(`${fullName(user)} — хадгалагдлаа.`);
      onOpenChange(false);
    },
  });

  /*
   * ★ Re-seeded every time the dialog opens.
   *
   * The row can refetch while this is closed — somebody else edits the same
   * person, or the list reloads after an unrelated change — and a form still
   * holding the values it read on mount would quietly write them back.
   *
   * An effect rather than the `openWith` handler this used before the overflow
   * menu: the control that opens the dialog is now a menu entry in a different
   * component, so the seeding has to hang off the state it can see. `user.id`
   * is in the dependency list because a row is keyed by it and React can reuse
   * this instance for a different person after a refetch.
   */
  useEffect(() => {
    if (!open) return;
    setForm({
      lastName: user.lastName,
      firstName: user.firstName,
      email: user.email ?? "",
      phone: user.phone ?? "",
      isActive: user.isActive !== false,
    });
    save.reset();
    // `save` is intentionally absent from the dependency list: it is a stable
    // mutation object, and listing it would re-seed the form on every render.
  }, [open, user.id, user.lastName, user.firstName, user.email, user.phone, user.isActive]);

  const errors = fieldErrors(save.error);

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        busy={save.isPending}
        title="Хэрэглэгч засах"
        description={user.username ? `Нэвтрэх нэр: ${user.username}` : undefined}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={save.isPending}
              onClick={() => onOpenChange(false)}
            >
              Болих
            </Button>
            <Button type="submit" form="edit-user-form" size="sm" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id="edit-user-form"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
        >
          {/*
            A 409 for a duplicate email or phone arrives without a field name,
            so it shows here rather than under an input. `fieldErrors` puts the
            validation failures on the fields themselves.
          */}
          <FormError
            message={
              save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Овог" error={errors.lastName} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              )}
            </Field>

            <Field label="Нэр" error={errors.firstName} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              )}
            </Field>
          </div>

          <Field label="И-мэйл" error={errors.email}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            )}
          </Field>

          {/* The API wants eight digits starting 5–9; the hint says so before
              the server has to. */}
          <Field label="Утас" error={errors.phone} hint="8 оронтой, 5–9-өөр эхэлнэ">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            )}
          </Field>

          {/*
            ★ Deactivating blocks sign-in; it does not remove the account or any
            role. Reversible from this same checkbox, which is why it is a field
            here rather than a confirmed destructive action of its own.
          */}
          <Checkbox
            label="Идэвхтэй"
            description="Тэмдэглэгээг авбал энэ хэрэглэгч нэвтэрч чадахгүй болно. Эрх, бүртгэл хэвээр үлдэнэ."
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
        </form>
      </FormDialog>
    </>
  );
}

/**
 * Granting a role — `POST /users/:id/memberships`.
 *
 * ★ A membership is a pair, not a role.
 *
 * `addMembershipSchema` requires `{ kindergartenId, role }`, and the
 * kindergarten is not a formality: `Membership` is the only thing that grants
 * access to anything, and every repository derives its tenant scope from it. A
 * role picked without one would be meaningless, so this form asks for both.
 *
 * ★★ The kindergartens offered are the ones this admin administers.
 *
 * `addMembership` calls `assertAdmin(actor, dto.kindergartenId)`, so a
 * kindergarten where the actor is merely a member — a director who is also a
 * parent elsewhere — would be refused. The list is derived from the session's
 * own memberships exactly as `adminKindergartenIds` derives it on the server,
 * rather than from `GET /kindergartens`, which answers with *member* scope and
 * would offer targets the API then rejects.
 *
 * This does not weaken anything: the server re-checks. It only avoids putting a
 * control on screen whose only outcome is an error.
 *
 * ★★★ Duplicates are the API's to judge, not this form's.
 *
 * Re-granting a **revoked** role reactivates it and is the common case — an
 * admin re-hiring a teacher. Re-granting a role that is already active is a
 * 409 whose message is the explanation. So every role stays selectable and the
 * server's answer is shown; a client-side filter would block the reactivation
 * that is supposed to work.
 */
function AddMembershipDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { session, primaryKindergartenId } = useSession();

  // The same derivation `TenantAccessService.adminKindergartenIds` makes.
  const adminKindergartenIds = [
    ...new Set(
      (session?.memberships ?? []).filter((m) => m.role === "ADMIN").map((m) => m.kindergartenId),
    ),
  ];

  const [kindergartenId, setKindergartenId] = useState(
    primaryKindergartenId ?? adminKindergartenIds[0] ?? "",
  );
  const [role, setRole] = useState<Role>("TEACHER");

  /*
   * Names for the ids above. Member-scoped, so it is filtered rather than
   * trusted — and it is only fetched while the dialog is open, because a list
   * of fifty users would otherwise fire fifty identical requests.
   */
  const kindergartens = useQuery({
    queryKey: qk.kindergartens(),
    queryFn: () => get("/kindergartens", z.array(kindergartenSchema)),
    enabled: open && adminKindergartenIds.length > 1,
  });

  const options = (kindergartens.data ?? []).filter((k) => adminKindergartenIds.includes(k.id));

  const grant = useMutation({
    mutationFn: () =>
      mutate(`/users/${user.id}/memberships`, z.unknown(), {
        method: "POST",
        body: { kindergartenId, role },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success(`${fullName(user)} — ${ROLE_LABEL[role] ?? role} эрх нэмэгдлээ.`);
      onOpenChange(false);
    },
  });

  // Same reasoning as `EditUserDialog`'s: the trigger lives in the row's menu,
  // so the form resets from the state it can observe.
  useEffect(() => {
    if (!open) return;
    grant.reset();
    setKindergartenId(primaryKindergartenId ?? adminKindergartenIds[0] ?? "");
    setRole("TEACHER");
    // `grant` is stable and `adminKindergartenIds` is rebuilt from the session
    // on every render, so neither belongs in the dependency list.
  }, [open, primaryKindergartenId]);

  // Nothing to grant into. An admin always has at least one, so this is the
  // defensive branch rather than the expected one.
  if (adminKindergartenIds.length === 0) return null;

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        busy={grant.isPending}
        title="Эрх нэмэх"
        description={`${fullName(user)} — ямар цэцэрлэгт ямар эрх эзэмших вэ.`}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={grant.isPending}
              onClick={() => onOpenChange(false)}
            >
              Болих
            </Button>
            <Button type="submit" form="add-membership-form" size="sm" disabled={grant.isPending}>
              {grant.isPending ? "Нэмж байна…" : "Эрх нэмэх"}
            </Button>
          </>
        }
      >
        <form
          id="add-membership-form"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!grant.isPending) grant.mutate();
          }}
        >
          {/* The 409 for an already-active role lands here, and its message is
              the whole explanation. */}
          <FormError message={grant.isError ? errorMessage(grant.error) : null} />

          {/*
            One kindergarten is the normal case, and a select with a single
            option is a control that cannot be used. It states the target
            instead — the value still goes in the request.
          */}
          {adminKindergartenIds.length > 1 ? (
            <Field label="Цэцэрлэг" required>
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={kindergartenId}
                  onChange={(e) => setKindergartenId(e.target.value)}
                >
                  {options.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field label="Эрх" required>
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
            Says what the current state is, so an admin can see before
            submitting that the role they are about to grant is already held —
            without the form refusing a re-grant the API would have accepted.
          */}
          {user.memberships.length > 0 ? (
            <p className="text-caption text-muted">
              Одоогийн эрх:{" "}
              {user.memberships
                .map(
                  (m) =>
                    `${ROLE_LABEL[m.role] ?? m.role}${m.isActive === false ? " (хураасан)" : ""}`,
                )
                .join(", ")}
            </p>
          ) : null}
        </form>
      </FormDialog>
    </>
  );
}
