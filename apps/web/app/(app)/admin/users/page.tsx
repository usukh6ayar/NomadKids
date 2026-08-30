"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { GraduationCap, Pencil, ShieldPlus, UserPlus, Users, UsersRound, X } from "lucide-react";
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
import { StatCard } from "@/components/ui/stat-card";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";

const listSchema = paginated(adminUserSchema);

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
 * `Эрх` is the widest because a dual-role account carries two badges and each
 * badge carries its own revoke control; `Сүүлд нэвтэрсэн` is sized for
 * `formatRelative`'s longest output ("13 хоногийн өмнө").
 */
const USER_COLUMNS = [
  { key: "roles", label: "Эрх", className: "md:w-[228px]" },
  { key: "lastLogin", label: "Сүүлд нэвтэрсэн", className: "md:w-[140px]" },
];

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
        lede="Багш, админ, эцэг эхийн бүртгэл."
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
      <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label={role ? "Шүүлтэд тохирсон" : "Нийт бүртгэл"}
          value={users.data?.total ?? "—"}
          unit="хэрэглэгч"
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
        <StatCard
          label="Эцэг эх"
          value={overview.data?.counts.guardians ?? "—"}
          unit="бүртгэл"
          tone="mint"
          art={<Users size={22} aria-hidden />}
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
          title="Хэрэглэгч олдсонгүй"
          description={query || role ? "Шүүлтээ өөрчилж үзнэ үү." : "Эхний багшаа нэмээрэй."}
        />
      ) : null}

      {/*
        ★ Four columns, because the response already carried four things and the
        row rendered one of them.

        This list was `[avatar] [name flex-1] [badges] [two buttons]`, which put
        a person's name against the left edge and their controls against the
        right with the width of a laptop screen between. `lastLoginAt` was in
        `adminUserSchema` from the beginning and had never been displayed
        anywhere — and it is the column a director actually wants here, because
        it answers the question a staff list is opened to answer: who has
        started using this, and who was invited and never came.

        ★★ Both actions still live on the row rather than behind a kebab, for
        the reason the previous note gave and this one keeps: two controls is
        not a menu's worth, and hiding the only way to correct a mistyped phone
        number behind an unlabelled click is worse than repeating a word.
      */}
      {items.length > 0 ? <ResultCount total={users.data!.total} noun="хэрэглэгч" /> : null}

      {items.length > 0 ? (
        <DataList
          columns={USER_COLUMNS}
          actionsWidth="w-[236px]"
          className={users.isPlaceholderData ? "opacity-60" : ""}
        >
          {items.map((user) => (
            <DataRow
              key={user.id}
              lead={
                <span className="grid size-10 place-items-center rounded-pill bg-primary-soft text-body font-semibold text-primary">
                  {initials(user)}
                </span>
              }
              title={fullName(user)}
              subtitle={[user.username, user.email, user.phone].filter(Boolean).join(" · ") || "—"}
              cells={{
                roles: (
                  <span className="flex flex-wrap items-center gap-1">
                    {user.memberships.map((m) =>
                      m.isActive === false ? (
                        // Kept visible rather than filtered out. The record of
                        // the relationship survives revocation, and an admin
                        // looking for "why can this teacher not see the group"
                        // needs to see that the answer is here.
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
                ),
                lastLogin: user.lastLoginAt ? (
                  <span className="text-body text-muted">{formatRelative(user.lastLoginAt)}</span>
                ) : (
                  // Not an em dash: "never signed in" is a fact about the
                  // account, and the dash this list uses for a missing value
                  // would read as "we do not know".
                  <span className="text-body text-faint">Нэвтрээгүй</span>
                ),
              }}
              actions={
                <>
                  <EditUserButton user={user} />
                  <AddMembershipButton user={user} />
                </>
              }
            />
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
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${label} эрхийг хураах`}
          disabled={revoke.isPending}
          className="text-muted hover:bg-danger-soft hover:text-danger"
        >
          <X size={16} aria-hidden />
        </Button>
      }
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
function EditUserButton({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    lastName: user.lastName,
    firstName: user.firstName,
    email: user.email ?? "",
    phone: user.phone ?? "",
    isActive: user.isActive !== false,
  });

  /*
   * ★ Re-seeded every time the dialog opens.
   *
   * The row can refetch while this is closed — somebody else edits the same
   * person, or the list reloads after an unrelated change — and a form still
   * holding the values it read on mount would quietly write them back.
   */
  function openWith() {
    setForm({
      lastName: user.lastName,
      firstName: user.firstName,
      email: user.email ?? "",
      phone: user.phone ?? "",
      isActive: user.isActive !== false,
    });
    save.reset();
    setOpen(true);
  }

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
      setOpen(false);
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={openWith}>
        <Pencil size={16} aria-hidden="true" />
        Засах
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
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
              onClick={() => setOpen(false)}
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
function AddMembershipButton({ user }: { user: AdminUser }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { session, primaryKindergartenId } = useSession();
  const [open, setOpen] = useState(false);

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
      setOpen(false);
    },
  });

  // Nothing to grant into. An admin always has at least one, so this is the
  // defensive branch rather than the expected one.
  if (adminKindergartenIds.length === 0) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          grant.reset();
          setKindergartenId(primaryKindergartenId ?? adminKindergartenIds[0] ?? "");
          setRole("TEACHER");
          setOpen(true);
        }}
      >
        <ShieldPlus size={16} aria-hidden="true" />
        Эрх нэмэх
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
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
              onClick={() => setOpen(false)}
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
