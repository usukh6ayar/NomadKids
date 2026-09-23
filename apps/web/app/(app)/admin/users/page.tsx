"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { UserPlus, UsersRound } from "lucide-react";
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
import { EmptyState, FormError, LoadingState } from "@/components/ui/states";
import { StatCard } from "@/components/ui/stat-card";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { StaffRecordsButton } from "@/components/admin/staff-records-dialog";
import { Art } from "@/components/ui/art";
import { TableShell, Td, Th } from "@/components/ui/table";
import { shortName } from "@/lib/format";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";

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

  /*
   * ★ Every staff account, for one purpose: turning an ESIS row into the
   * account it belongs to — 2026-09-20, the client asking for мэргэшлийн зэрэг
   * to be enterable. `StaffRecord` hangs off `User.id`, and an ESIS row knows
   * only `personId`, so something has to hold the join.
   *
   * ★★ A second query rather than widening the one above, which deliberately
   * asks for `pageSize: 1` because it wants `total` and nothing else. Merging
   * them would make the count tile depend on a list it does not read.
   *
   * ★★★ `pageSize: 200` and no pager. This is a staff list — the largest
   * kindergarten in the RFP has a few dozen — and the rows are never rendered,
   * only indexed. A kindergarten past 200 loses the button on the overflow,
   * which is a missing shortcut rather than a wrong screen, and the panel says
   * so by simply not drawing it.
   */
  const staffAccounts = useQuery({
    queryKey: qk.adminUsers({ q: "", role: "staff-index", page: "1" }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "200" });
      params.set("roles", STAFF_ROLES);
      if (primaryKindergartenId) params.set("kindergartenId", primaryKindergartenId);
      return get(`/users?${params}`, listSchema);
    },
    enabled: Boolean(primaryKindergartenId),
  });

  /** ESIS `personId` → the account it belongs to. Built once per fetch. */
  const accountByPersonId = new Map(
    (staffAccounts.data?.items ?? [])
      .filter((user) => user.esisPersonId)
      .map((user) => [String(user.esisPersonId), user]),
  );

  /*
   * ★ The row action the two staff panels below share.
   *
   * Returns null for an ESIS row with no account here — a person the ministry
   * lists who has not registered. Offering "Хувийн хэрэг" there would promise
   * a file with nowhere to put it, the same reasoning as the camera on the
   * children's roster.
   */
  const staffRecordsAction = (row: Record<string, string | null>) => {
    const account = row.personId ? accountByPersonId.get(String(row.personId)) : undefined;
    if (!account || !primaryKindergartenId) return null;
    return (
      <StaffRecordsButton
        user={{ id: account.id, lastName: account.lastName, firstName: account.firstName }}
        kindergartenId={primaryKindergartenId}
      />
    );
  };

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
        {/*
         * ★ The count is a way in — 2026-09-20, the client: "Багшийг бүртгэх 3
         * гэж гарч байна гэхдээ хэн хэн бүртгэлтэй байгааг харах хэрэгтэй юм
         * байна."
         *
         * The list of who has registered themselves already existed, on
         * `/admin/staff-code` («Ажилтны бүртгэл»), with a name, a role and a
         * date for each. Nothing pointed at it from the number that raised the
         * question, so the number was a dead end: it said three and offered no
         * way to ask which three.
         */}
        <StatCard
          label="Нийт ажилтан"
          value={users.data?.total ?? "—"}
          unit="бүртгэл"
          tone="sky"
          href="/admin/staff-code"
          art={<UsersRound size={22} aria-hidden />}
        />
        <StatCard
          label="Багш, ажилтан"
          value={overview.data?.counts.staff ?? "—"}
          unit="бүртгэл"
          tone="cornflower"
          art={<Art name="teacher" size={36} />}
          artSurface={false}
        />
      </section>

      {/*
        ★ **The registered staff, first — 2026-09-22**, the client: "дээд
        хэсэгт бүртгэгдсэн багш ажилчдыг харуулах".

        The rows were already being fetched. `staffAccounts` above asks for two
        hundred of them and its own note says they "are never rendered, only
        indexed" — it existed solely to map an ESIS `personId` onto the account
        it belongs to. So the question "who actually has an account here" was
        answerable from data already on the screen and had no answer on it.

        ★★ Above the ESIS panels rather than below, which is the whole of the
        request: a director opening this screen is usually asking about their
        own staff, and the ministry's two tables are the reference they check
        against. The order now matches which of those is the question.
      */}
      <RegisteredStaff
        rows={staffAccounts.data?.items ?? []}
        isLoading={staffAccounts.isPending}
        kindergartenId={primaryKindergartenId}
      />

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
      <EsisDataPanel
        resource="teachers"
        title="Багш нар"
        description="Томилгоо ба заах эрх"
        rowActions={staffRecordsAction}
      />
      <EsisDataPanel
        resource="staff"
        title="Ажилтнууд"
        description="Эрхлэгч, эмч, тогооч, нягтлан — албан тушаал ба ажил эрхлэлт"
        rowActions={staffRecordsAction}
      />

      {/*
        ★ Appointments and releases — 2026-09-10, at the client's request.
        `api-12` takes a `:beginDate` and answers for the whole institution,
        which is a director's question rather than a teacher's: it stays off
        the TEACHER service list and therefore off `/settings`, where a teacher
        sees only their own заах аргын нэгдэл.
      */}
      <EsisDataPanel
        resource="teacherMovements"
        title="Багшийн шилжилт хөдөлгөөн"
        description="Томилгоо, шилжилт, чөлөөлөлт — сонгосон огнооноос хойш"
      />

      {/*
        ★ Мэргэшлийн зэргийн хүсэлт — 2026-09-22, the client naming the four
        degree services. These are the two **reads**, keyed by a request number
        the director types from the application in front of them.

        ★★ They ask rather than reading on open, which is the rule the three
        panels above follow: a service that needs an id the reader has to supply
        cannot be called without guessing one, and guessing an id means asking
        the ministry about a request that is not ours.

        ★★★ Neither declares its output fields. Nothing here can produce a
        request number yet — 119 is refused by the live gateway and dropped at
        the client's instruction, and 165 files a real application so it waits
        on their decision — so no populated response has ever been seen.
        `esisFieldsFor` reads the columns off the first real record instead,
        which is also what keeps the trial's "show every output value" rule.
      */}
      <EsisDataPanel
        resource="degreeDecisions"
        title="Мэргэшлийн зэргийн шийдвэрлэлт"
        description="Хүсэлтийн дугаараар ЭСИС-ийн шийдвэрлэлтийн төлөв"
      />
      <EsisDataPanel
        resource="degreeHistory"
        title="Мэргэшлийн зэргийн хүсэлтийн түүх"
        description="Хүсэлтийн дугаараар өөрчлөлтийн түүх"
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

/**
 * The kindergarten's own staff accounts — "Бүртгэгдсэн багш, ажилтан".
 *
 * ★ Our records, not the ministry's, and the distinction is the point of the
 * section. ESIS lists everyone it has been told about; this lists everyone who
 * can sign in. A person in the first and not the second has not registered yet,
 * which is the gap a director opening this screen is usually chasing.
 *
 * ★★ No search and no pager, deliberately. `staffAccounts` asks for two
 * hundred and the RFP's largest kindergarten has a few dozen staff, so the
 * table is complete in practice — the same reasoning, and the same ceiling, as
 * the query's own note. A kindergarten past two hundred loses rows off the end
 * here exactly as it loses the ESIS row-to-account shortcut, and both want a
 * pager together rather than one of them growing one alone.
 */
function RegisteredStaff({
  rows,
  isLoading,
  kindergartenId,
}: {
  /**
   * ★ Separate from an empty list, and it has to be.
   *
   * Without it the section drew "Бүртгэгдсэн ажилтан байхгүй" while the request
   * was still in flight, so a director with a full staff list met "nobody has
   * registered" for as long as the fetch took — and the empty state tells them
   * to go and invite people. A test asserting that empty state also could not
   * tell the two apart, which is how it was found.
   */
  isLoading: boolean;
  rows: {
    id: string;
    lastName: string;
    firstName: string;
    username?: string | null;
    phone?: string | null;
    email?: string | null;
    isActive?: boolean | null;
    esisPersonId?: string | null;
    memberships?: { role: Role; isActive?: boolean | null }[];
  }[];
  kindergartenId: string | null;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-body font-semibold text-ink">Бүртгэгдсэн багш, ажилтан</h2>
        <p className="text-caption text-muted">{rows.length} бүртгэл</p>
      </div>

      {isLoading ? (
        <LoadingState rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Бүртгэгдсэн ажилтан байхгүй"
          description="«Хэрэглэгч нэмэх»-ээр урих эсвэл ажилтан өөрөө цэцэрлэгийн ESIS дугаараар бүртгүүлнэ."
        />
      ) : (
        /*
          ★ The caption is not the heading's words again. It is screen-reader
          only and says what the rows *are*, where the `h2` above names the
          section — repeating the heading would have a reader hear it twice, and
          it makes `getByText` ambiguous for anything testing the section.
        */
        <TableShell caption="Цэцэрлэгт бүртгэлтэй ажилтны бүртгэл" minWidth="min-w-0" stacked>
          <thead>
            <tr>
              <Th>Нэр</Th>
              <Th>Албан тушаал</Th>
              <Th>Холбоо барих</Th>
              <Th className="w-12">
                <span className="sr-only">Хувийн хэрэг</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => {
              /*
                ★ Every role they hold here, not the first one. A person can be
                a багш and the нягтлан of the same kindergarten, and showing one
                of the two would make the other invisible on the only screen
                that lists it.
              */
              const roles = (user.memberships ?? [])
                .filter((m) => m.isActive !== false)
                .map((m) => ROLE_LABEL[m.role])
                .filter((label, index, all) => label && all.indexOf(label) === index);

              return (
                <tr key={user.id} className={user.isActive === false ? "opacity-60" : undefined}>
                  <Td data-label="Нэр" className="font-medium text-ink">
                    {shortName(user)}
                    {user.isActive === false ? (
                      <span className="ml-2 text-caption font-normal text-muted">(хаагдсан)</span>
                    ) : null}
                  </Td>
                  <Td data-label="Албан тушаал">
                    {roles.length > 0 ? roles.join(", ") : <span className="text-faint">—</span>}
                  </Td>
                  {/*
                    ★ Whichever of the three they actually registered with. The
                    account needs one of a username, a phone or an e-mail, never
                    all three, so a column per field would be mostly dashes.
                  */}
                  <Td data-label="Холбоо барих" className="text-muted">
                    {user.phone || user.email || user.username || "—"}
                  </Td>
                  <Td data-label="Хувийн хэрэг" className="text-right">
                    {kindergartenId ? (
                      <StaffRecordsButton
                        user={{
                          id: user.id,
                          lastName: user.lastName,
                          firstName: user.firstName,
                        }}
                        kindergartenId={kindergartenId}
                      />
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </section>
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
