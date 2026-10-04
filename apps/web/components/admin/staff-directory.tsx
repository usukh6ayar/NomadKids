"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import {
  Briefcase,
  CalendarDays,
  Download,
  Eye,
  IdCard,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Power,
  RefreshCw,
  Settings,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import {
  ROLE_LABEL,
  STAFF_CATEGORY_LABEL,
  adminUserSchema,
  groupListItemSchema,
  paginated,
  STAFF_ROLES,
  staffRosterRefreshSchema,
  unclaimedStaffSchema,
  type Role,
  type UnclaimedStaff,
} from "@kinder/contracts";
import { downloadUrl } from "@/lib/api/client";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/use-debounced";
import { fullName, shortName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { RowMenu } from "@/components/ui/menu";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { StaffLinkDialog } from "@/components/admin/staff/staff-link-dialog";
import { cn } from "@/lib/utils";

const listSchema = paginated(adminUserSchema);
const userDetailSchema = adminUserSchema.extend({
  specialization: z.string().nullish(),
  qualification: z.string().nullish(),
  education: z.string().nullish(),
});
type StaffUser = z.infer<typeof adminUserSchema>;

const PAGE_SIZES = [20, 50, 100] as const;

/** The roles of the Ажилтан section — every staff role but a teacher's. */
const OTHER_STAFF_ROLES = ["ADMIN", "COOK", "ACCOUNTANT"] as const satisfies readonly Role[];

type SectionKind = "teacher" | "staff";

const groupsSchema = paginated(groupListItemSchema);

/** How many of a section's accounts have (or lack) a group — `total` of a one-row page. */
function useStaffCount(
  kindergartenId: string | null | undefined,
  roles: string,
  hasGroup: "true" | "false",
  enabled: boolean,
) {
  return useQuery({
    queryKey: qk.adminUsers({ section: "count", roles, hasGroup }),
    queryFn: () =>
      get(
        `/users?kindergartenId=${kindergartenId}&roles=${roles}&hasGroup=${hasGroup}&page=1&pageSize=1`,
        listSchema,
      ),
    select: (page) => page.total,
    enabled: enabled && Boolean(kindergartenId),
  });
}

/**
 * Багш ба Ажилтан — the director's staff directory, client 2026-09-25, with two
 * drawings: two compact tables, and a side panel that opens on a person.
 *
 * ★ Only what the API holds is shown. Регистр, төрсөн огноо, албан тушаал,
 * ангилал, ажилд орсон огноо and the live groups arrived on 2026-09-27 (#147),
 * and the post and category filters on 2026-09-28 — a post is free text, so its
 * choices are the ones in use (`GET /users/positions`). The actions: edit (`PATCH /users/:id` and
 * `PATCH /memberships/:id/profile`), the role (`PATCH /memberships/:id`),
 * deactivate (`isActive`), invite, and the Excel file (`GET /users/export`,
 * the same filters as the table).
 */
export function StaffDirectory({ onInvite }: { onInvite: (role: Role) => void }) {
  const [openUserId, setOpenUserId] = useState<{ id: string; kind: SectionKind } | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">Багш, ажилтан</h1>
      <StaffSection kind="teacher" onInvite={onInvite} onOpen={setOpenUserId} />
      <StaffSection kind="staff" onInvite={onInvite} onOpen={setOpenUserId} />
      <UnclaimedEsisStaff />
      {openUserId ? (
        <StaffPanel
          userId={openUserId.id}
          kind={openUserId.kind}
          onClose={() => setOpenUserId(null)}
        />
      ) : null}
    </div>
  );
}

/** The person's role here, in this kindergarten, for the section they sit in. */
function sectionMembership(user: StaffUser, kindergartenId: string | null, kind: SectionKind) {
  const here = user.memberships.filter(
    (m) => (!kindergartenId || m.kindergartenId === kindergartenId) && m.role !== "PARENT",
  );
  return kind === "teacher"
    ? here.find((m) => m.role === "TEACHER")
    : here.find((m) => m.role !== "TEACHER");
}

function StaffSection({
  kind,
  onInvite,
  onOpen,
}: {
  kind: SectionKind;
  onInvite: (role: Role) => void;
  onOpen: (target: { id: string; kind: SectionKind }) => void;
}) {
  const { primaryKindergartenId } = useSession();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const search = useDebounced(typed.trim());
  const [role, setRole] = useState("");
  /** "" every teacher, "with"/"without" by assignment, or a group id. */
  const [groupFilter, setGroupFilter] = useState("");
  /** A teacher's free-text post — one of the ones in use here. */
  const [position, setPosition] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [roleOf, setRoleOf] = useState<StaffUser | null>(null);
  const [deactivating, setDeactivating] = useState<StaffUser | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();

  const teacher = kind === "teacher";
  const roles = teacher ? "TEACHER" : role || OTHER_STAFF_ROLES.join(",");

  /*
    The section's filters as the API's query — the list and the Excel file read
    the same one, so the file is always what the table shows (every page).
  */
  const filters = new URLSearchParams({ roles });
  if (search) filters.set("q", search);
  if (primaryKindergartenId) filters.set("kindergartenId", primaryKindergartenId);
  if (teacher && groupFilter === "with") filters.set("hasGroup", "true");
  else if (teacher && groupFilter === "without") filters.set("hasGroup", "false");
  else if (teacher && groupFilter) filters.set("groupId", groupFilter);
  if (teacher && position) filters.set("position", position);
  if (!teacher && category) filters.set("staffCategory", category);

  const users = useQuery({
    queryKey: qk.adminUsers({
      section: kind,
      q: search,
      roles,
      group: groupFilter,
      position,
      category,
      page: String(page),
      pageSize: String(pageSize),
    }),
    queryFn: () => get(`/users?${filters}&page=${page}&pageSize=${pageSize}`, listSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  // The posts in use for this section's roles — the only honest choices for free text.
  const positions = useQuery({
    queryKey: qk.adminUsers({ section: "positions", roles }),
    queryFn: () =>
      get(
        `/users/positions?kindergartenId=${primaryKindergartenId}&roles=${roles}`,
        z.array(z.string()),
      ),
    enabled: teacher && Boolean(primaryKindergartenId),
    staleTime: 60_000,
  });

  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: teacher,
    staleTime: 60_000,
  });

  // «Бүлэг хариуцсан · Бүлэггүй» — two counts, one row each, never a guess.
  const assignedCount = useStaffCount(primaryKindergartenId, roles, "true", teacher);
  const unassignedCount = useStaffCount(primaryKindergartenId, roles, "false", teacher);

  const deactivate = useMutation({
    mutationFn: (id: string) =>
      mutate(`/users/${id}`, z.unknown(), { method: "PATCH", body: { isActive: false } }),
    onSuccess: () => {
      toast.success("Идэвхгүй болголоо.");
      setDeactivating(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /*
    ★ «ESIS татах» linked to `/admin/integrations/esis`, deleted on
    2026-09-14, so it opened a 404 until 2026-09-28. It now refills the ESIS
    staff roster directly — the list the public staff-registration form is
    matched against. It creates no accounts: a person gets one by registering
    with the institution number, which `/admin/staff-code` shows.
  */
  const esisRefresh = useMutation({
    mutationFn: () =>
      mutate(
        `/kindergartens/${primaryKindergartenId}/esis/staff-roster/refresh`,
        staffRosterRefreshSchema,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      toast.success(
        `ESIS-ээс ${result.count} ажилтны мэдээлэл шинэчлэгдлээ. Бүртгүүлээгүй нь доорх жагсаалтад харагдана.`,
      );
      void queryClient.invalidateQueries({ queryKey: UNCLAIMED_KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resetting =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const title = teacher ? "Багш" : "Ажилтан";
  const noun = teacher ? "багш" : "ажилтан";
  const data = users.data;
  const offset = (page - 1) * pageSize;
  const headingId = `staff-${kind}-heading`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-display font-bold leading-heading text-ink">
          {title}
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild size="sm" variant="secondary">
            <a href={downloadUrl(`/users/export?${filters}`)}>
              <Download size={16} aria-hidden /> Excel
            </a>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!primaryKindergartenId || esisRefresh.isPending}
            onClick={() => esisRefresh.mutate()}
          >
            <RefreshCw size={16} aria-hidden />{" "}
            {esisRefresh.isPending ? "Татаж байна…" : "ESIS татах"}
          </Button>
          <Button size="sm" onClick={() => onInvite(teacher ? "TEACHER" : "COOK")}>
            <Plus size={16} aria-hidden /> {teacher ? "Багш нэмэх" : "Ажилтан нэмэх"}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[200px_200px_minmax(0,1fr)]">
        {teacher ? (
          <Select
            aria-label="Албан тушаал"
            value={position}
            onChange={(event) => resetting(setPosition)(event.target.value)}
          >
            <option value="">Бүх албан тушаал</option>
            {(positions.data ?? []).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        ) : (
          <Select
            aria-label="Албан тушаал"
            value={role}
            onChange={(event) => resetting(setRole)(event.target.value)}
          >
            <option value="">Бүх албан тушаал</option>
            {OTHER_STAFF_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </Select>
        )}
        {teacher ? (
          <Select
            aria-label="Бүлэг"
            value={groupFilter}
            onChange={(event) => resetting(setGroupFilter)(event.target.value)}
          >
            <option value="">Бүх бүлэг</option>
            <option value="with">Бүлэг хариуцсан</option>
            <option value="without">Бүлэггүй</option>
            {(groups.data?.items ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        ) : (
          <Select
            aria-label="Ангилал"
            value={category}
            onChange={(event) => resetting(setCategory)(event.target.value)}
          >
            <option value="">Бүх ангилал</option>
            {Object.entries(STAFF_CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
        <SearchField
          label={`${title} хайх`}
          placeholder="Нэр, регистр, утсаар хайх..."
          value={typed}
          onChange={resetting(setTyped)}
        />
      </div>

      <p className="text-caption text-muted" aria-live="polite">
        Нийт <span className="font-semibold tabular-nums text-ink">{data?.total ?? "—"}</span>{" "}
        {noun}
        {teacher ? (
          <>
            {" "}
            · Бүлэг хариуцсан{" "}
            <span className="tabular-nums text-ink">{assignedCount.data ?? "—"}</span> · Бүлэггүй{" "}
            <span className="tabular-nums text-ink">{unassignedCount.data ?? "—"}</span>
          </>
        ) : null}
      </p>

      {users.isLoading ? <LoadingState rows={5} /> : null}
      {users.isError ? <ErrorState description={errorMessage(users.error)} /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title={`${title} олдсонгүй`}
          description="Шүүлтүүр эсвэл хайлтаа өөрчилж үзнэ үү."
        />
      ) : null}

      {data && data.items.length > 0 ? (
        /* Plain and unclipped, so the ⋯ menu opens whole (as on Анги, бүлэг). */
        <div className="rounded-card border border-border bg-surface">
          <table className="w-full border-collapse text-body">
            <caption className="sr-only">
              {teacher ? "Багшийн жагсаалт" : "Ажилтны жагсаалт"}
            </caption>
            <thead>
              <tr>
                <Th className="w-12 rounded-tl-card py-2">№</Th>
                <Th className="py-2">{teacher ? "Багшийн нэр" : "Ажилтны нэр"}</Th>
                <Th className="py-2">Регистр</Th>
                <Th className="py-2">Албан тушаал</Th>
                <Th className="py-2">{teacher ? "Хариуцсан бүлэг" : "Ангилал"}</Th>
                <Th className="py-2">Утас</Th>
                <Th className="w-12 rounded-tr-card py-2">
                  <span className="sr-only">Үйлдэл</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((user, index) => {
                const membership = sectionMembership(user, primaryKindergartenId, kind);
                return (
                  <tr key={user.id} className="hover:bg-sunken/60">
                    <Td className="py-1.5 tabular-nums text-muted">{offset + index + 1}</Td>
                    <Td className="py-1.5">
                      <button
                        type="button"
                        onClick={() => onOpen({ id: user.id, kind })}
                        className="text-left font-medium text-ink hover:text-primary hover:underline"
                      >
                        {teacher ? shortName(user) : fullName(user)}
                      </button>
                    </Td>
                    <Td className="py-1.5 tabular-nums text-muted">{user.registerNumber ?? "—"}</Td>
                    <Td className="py-1.5 text-muted">
                      {membership ? (membership.position ?? ROLE_LABEL[membership.role]) : "—"}
                    </Td>
                    <Td className="py-1.5 text-muted">
                      {teacher
                        ? membership?.groups.length
                          ? membership.groups.map((group) => group.name).join(", ")
                          : "Бүлэггүй"
                        : membership?.staffCategory
                          ? STAFF_CATEGORY_LABEL[membership.staffCategory]
                          : "—"}
                    </Td>
                    <Td className="py-1.5 tabular-nums text-muted">{user.phone || "—"}</Td>
                    <Td className="py-1 text-right">
                      <RowMenu
                        ariaLabel={`${fullName(user)} — үйлдэл`}
                        triggerIcon={<MoreHorizontal size={18} aria-hidden="true" />}
                        items={[
                          {
                            label: "Мэдээлэл харах",
                            icon: <Eye size={16} aria-hidden />,
                            onSelect: () => onOpen({ id: user.id, kind }),
                          },
                          {
                            label: "Мэдээлэл засах",
                            icon: <Pencil size={16} aria-hidden />,
                            onSelect: () => setEditing(user),
                          },
                          ...(teacher
                            ? [
                                {
                                  label: "Бүлэг оноох / солих",
                                  icon: <UsersRound size={16} aria-hidden />,
                                  hint: "Анги, бүлэг хуудаснаас",
                                  onSelect: () => router.push("/admin/groups"),
                                },
                              ]
                            : []),
                          {
                            label: "Системийн эрх тохируулах",
                            icon: <Settings size={16} aria-hidden />,
                            onSelect: () => setRoleOf(user),
                          },
                          {
                            label: "Идэвхгүй болгох",
                            icon: <Power size={16} aria-hidden />,
                            tone: "danger" as const,
                            separated: true,
                            onSelect: () => setDeactivating(user),
                          },
                        ]}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body font-semibold text-ink">
            Нийт <span className="tabular-nums">{data.total}</span> {noun}
          </p>
          <Pagination page={page} totalPages={data.totalPages} onPage={setPage} />
          <label className="flex items-center gap-2 text-caption text-muted">
            Хуудас тутамд:
            <Select
              aria-label={`${title} — хуудас тутамд`}
              value={String(pageSize)}
              onChange={(event) => {
                setPageSize(Number(event.target.value) as (typeof PAGE_SIZES)[number]);
                setPage(1);
              }}
              className="h-9 w-auto px-2"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={String(size)}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        </div>
      ) : null}

      {editing ? (
        <EditUserDialog
          user={editing}
          membership={sectionMembership(editing, primaryKindergartenId, kind)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {roleOf ? (
        <RoleDialog
          user={roleOf}
          membership={sectionMembership(roleOf, primaryKindergartenId, kind)}
          onClose={() => setRoleOf(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deactivating)}
        onOpenChange={(next) => (next ? undefined : setDeactivating(null))}
        title="Идэвхгүй болгох уу?"
        description={
          deactivating ? `${fullName(deactivating)} системд нэвтрэх боломжгүй болно.` : ""
        }
        confirmLabel="Идэвхгүй болгох"
        cancelLabel="Болих"
        tone="danger"
        pending={deactivate.isPending}
        onConfirm={() => (deactivating ? deactivate.mutate(deactivating.id) : undefined)}
      />
    </section>
  );
}

const TEACHER_TABS = ["Ерөнхий", "Ажлын мэдээлэл", "Бүлэг/үүрэг", "Системийн эрх"] as const;
const STAFF_TABS = ["Ерөнхий", "Ажлын мэдээлэл", "Системийн эрх", "ESIS мэдээлэл"] as const;

/**
 * The person, opened from a row — the second drawing: a panel at the right
 * with their name, state and role, four tabs, Хаах and Мэдээлэл засах.
 */
function StaffPanel({
  userId,
  kind,
  onClose,
}: {
  userId: string;
  kind: SectionKind;
  onClose: () => void;
}) {
  const { primaryKindergartenId } = useSession();
  const teacher = kind === "teacher";
  const tabs = teacher ? TEACHER_TABS : STAFF_TABS;
  const [tab, setTab] = useState<string>(tabs[0]);
  const [editing, setEditing] = useState(false);

  const user = useQuery({
    queryKey: ["admin", "users", "detail", userId],
    queryFn: () => get(`/users/${userId}`, userDetailSchema),
  });
  const data = user.data;
  const membership = data ? sectionMembership(data, primaryKindergartenId, kind) : undefined;
  const roleLabel = membership ? (membership.position ?? ROLE_LABEL[membership.role]) : "—";
  const groupNames = membership?.groups.length
    ? membership.groups.map((group) => group.name).join(", ")
    : "Бүлэггүй";
  const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
  const active = data?.isActive !== false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={teacher ? "Багшийн мэдээлэл" : "Ажилтны мэдээлэл"}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-[440px] flex-col gap-4 overflow-y-auto bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-title font-bold text-ink">
            {teacher ? "Багшийн мэдээлэл" : "Ажилтны мэдээлэл"}
          </h2>
          <button
            type="button"
            aria-label="Хаах"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {user.isLoading ? <LoadingState rows={4} /> : null}
        {user.isError ? <ErrorState description={errorMessage(user.error)} /> : null}

        {data ? (
          <>
            <div className="flex items-center gap-4">
              <span className="grid size-16 shrink-0 place-items-center rounded-pill bg-primary-soft text-primary">
                <UserRound size={30} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-lead font-bold text-ink">
                    {teacher ? shortName(data) : fullName(data)}
                  </span>
                  <span
                    className={cn(
                      "rounded-pill px-2 py-0.5 text-caption font-medium",
                      active ? "bg-mint text-mint-ink" : "bg-danger-soft text-danger",
                    )}
                  >
                    {active ? "Идэвхтэй" : "Идэвхгүй"}
                  </span>
                </p>
                <p className="text-body text-muted">{roleLabel}</p>
              </div>
            </div>

            <div
              role="tablist"
              aria-label="Мэдээллийн хэсэг"
              className="flex gap-1 border-b border-border"
            >
              {tabs.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  onClick={() => setTab(name)}
                  className={cn(
                    "-mb-px border-b-2 px-2 pb-2 text-caption font-medium transition-colors",
                    tab === name
                      ? "border-primary text-primary"
                      : "border-transparent text-muted hover:text-ink",
                  )}
                >
                  {name}
                </button>
              ))}
            </div>

            <div role="tabpanel" aria-label={tab} className="flex flex-col gap-4">
              {tab === "Ерөнхий" ? (
                <>
                  <InfoBlock title="Хувийн мэдээлэл">
                    <InfoRow
                      icon={<IdCard size={16} />}
                      label="Регистр"
                      value={data.registerNumber}
                    />
                    <InfoRow
                      icon={<CalendarDays size={16} />}
                      label="Төрсөн огноо"
                      value={day(data.dateOfBirth)}
                    />
                    <InfoRow icon={<Phone size={16} />} label="Утас" value={data.phone} />
                    <InfoRow icon={<Mail size={16} />} label="Цахим шуудан" value={data.email} />
                  </InfoBlock>
                  <InfoBlock title="Ажлын мэдээлэл">
                    <InfoRow
                      icon={<Briefcase size={16} />}
                      label="Албан тушаал"
                      value={roleLabel}
                    />
                    {teacher ? (
                      <InfoRow
                        icon={<UsersRound size={16} />}
                        label="Хариуцсан бүлэг"
                        value={groupNames}
                      />
                    ) : (
                      <InfoRow
                        icon={<UsersRound size={16} />}
                        label="Ангилал"
                        value={
                          membership?.staffCategory
                            ? STAFF_CATEGORY_LABEL[membership.staffCategory]
                            : null
                        }
                      />
                    )}
                    <InfoRow
                      icon={<CalendarDays size={16} />}
                      label="Ажилд орсон огноо"
                      value={day(membership?.startedOn)}
                    />
                  </InfoBlock>
                </>
              ) : null}

              {tab === "Ажлын мэдээлэл" ? (
                <InfoBlock title="Ажлын мэдээлэл">
                  <InfoRow
                    icon={<Briefcase size={16} />}
                    label="Мэргэжил"
                    value={data.specialization}
                  />
                  <InfoRow
                    icon={<Briefcase size={16} />}
                    label="Мэргэшлийн зэрэг"
                    value={data.qualification}
                  />
                  <InfoRow
                    icon={<Briefcase size={16} />}
                    label="Төгссөн сургууль"
                    value={data.education}
                  />
                </InfoBlock>
              ) : null}

              {tab === "Бүлэг/үүрэг" ? (
                <InfoBlock title="Бүлэг, үүрэг">
                  <InfoRow
                    icon={<UsersRound size={16} />}
                    label="Хариуцсан бүлэг"
                    value={groupNames}
                  />
                  <p className="text-caption text-muted">
                    Багш хуваарилалтыг «Анги, бүлэг» хуудаснаас хийнэ.
                  </p>
                </InfoBlock>
              ) : null}

              {tab === "Системийн эрх" ? (
                <InfoBlock title="Системийн эрх">
                  <InfoRow
                    icon={<UserRound size={16} />}
                    label="Нэвтрэх нэр"
                    value={data.username}
                  />
                  <InfoRow
                    icon={<Settings size={16} />}
                    label="Эрх"
                    value={
                      data.memberships
                        .filter(
                          (m) =>
                            !primaryKindergartenId || m.kindergartenId === primaryKindergartenId,
                        )
                        .map((m) => ROLE_LABEL[m.role])
                        .join(", ") || null
                    }
                  />
                  <InfoRow
                    icon={<CalendarDays size={16} />}
                    label="Сүүлд нэвтэрсэн"
                    value={data.lastLoginAt ? data.lastLoginAt.slice(0, 10) : null}
                  />
                </InfoBlock>
              ) : null}

              {tab === "ESIS мэдээлэл" ? (
                <InfoBlock title="ESIS мэдээлэл">
                  <p className="text-body text-muted">ESIS-ийн мэдээлэл холбогдоогүй байна.</p>
                </InfoBlock>
              ) : null}
            </div>

            <div className="mt-auto flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="secondary" onClick={onClose}>
                Хаах
              </Button>
              <Button onClick={() => setEditing(true)}>Мэдээлэл засах</Button>
            </div>
          </>
        ) : null}

        {editing && data ? (
          <EditUserDialog user={data} membership={membership} onClose={() => setEditing(false)} />
        ) : null}
      </div>
    </div>
  );
}

function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-body font-semibold text-ink">{title}</h3>
      <dl className="flex flex-col gap-2">{children}</dl>
    </div>
  );
}

/** One fact. Nothing on the record reads "—", never a placeholder value. */
function InfoRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="grid grid-cols-[20px_140px_minmax(0,1fr)] items-center gap-2 text-body">
      <span aria-hidden="true" className="text-muted">
        {icon}
      </span>
      <dt className="text-muted">{label}</dt>
      <dd className={cn("min-w-0 break-words", value ? "text-ink" : "text-faint")}>
        {value || "—"}
      </dd>
    </div>
  );
}

/** Мэдээлэл засах — the fields `PATCH /users/:id` already takes. */
/**
 * «Мэдээлэл засах» — the person (`PATCH /users/:id`) and, when they have one
 * here, their post in this kindergarten (`PATCH /memberships/:id/profile`):
 * албан тушаал, ангилал, ажилд орсон огноо belong to the membership, because
 * a person can hold a different post in a second kindergarten.
 */
function EditUserDialog({
  user,
  membership,
  onClose,
}: {
  user: StaffUser;
  membership?: StaffUser["memberships"][number];
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [lastName, setLastName] = useState(user.lastName);
  const [firstName, setFirstName] = useState(user.firstName);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [registerNumber, setRegisterNumber] = useState(user.registerNumber ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth?.slice(0, 10) ?? "");
  const [position, setPosition] = useState(membership?.position ?? "");
  const [staffCategory, setStaffCategory] = useState<string>(membership?.staffCategory ?? "");
  const [startedOn, setStartedOn] = useState(membership?.startedOn?.slice(0, 10) ?? "");

  const save = useMutation({
    mutationFn: async () => {
      await mutate(`/users/${user.id}`, z.unknown(), {
        method: "PATCH",
        body: {
          lastName: lastName.trim(),
          firstName: firstName.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          email: email.trim() || null,
          registerNumber: registerNumber.trim() || null,
          dateOfBirth: dateOfBirth || null,
        },
      });
      if (membership) {
        await mutate(`/memberships/${membership.id}/profile`, z.unknown(), {
          method: "PATCH",
          body: {
            position: position.trim() || null,
            staffCategory: staffCategory || null,
            startedOn: startedOn || null,
          },
        });
      }
    },
    onSuccess: () => {
      toast.success("Мэдээлэл хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const errors = fieldErrors(save.error);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Мэдээлэл засах"
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/50 p-4"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[520px] flex-col gap-3 overflow-y-auto rounded-card border border-border bg-surface p-5"
        noValidate
      >
        <h2 className="text-lead font-semibold text-ink">Мэдээлэл засах</h2>
        <FormError message={save.isError ? errorMessage(save.error) : null} />
        <Field label="Овог" error={errors.lastName} required>
          {({ id }) => (
            <Input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          )}
        </Field>
        <Field label="Нэр" error={errors.firstName} required>
          {({ id }) => (
            <Input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          )}
        </Field>
        <Field label="Утас" error={errors.phone}>
          {({ id }) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
        <Field label="Цахим шуудан" error={errors.email}>
          {({ id }) => (
            <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Регистр" error={errors.registerNumber} hint="Жишээ: УБ12345678">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={registerNumber}
                onChange={(e) => setRegisterNumber(e.target.value)}
              />
            )}
          </Field>
          <Field label="Төрсөн огноо" error={errors.dateOfBirth}>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            )}
          </Field>
        </div>
        {membership ? (
          <>
            <Field
              label="Албан тушаал"
              error={errors.position}
              hint="Жишээ: Бүлгийн багш, Арга зүйч"
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                />
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ангилал" error={errors.staffCategory}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={staffCategory}
                    onChange={(e) => setStaffCategory(e.target.value)}
                  >
                    <option value="">Сонгоогүй</option>
                    {Object.entries(STAFF_CATEGORY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Ажилд орсон огноо" error={errors.startedOn}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={startedOn}
                    onChange={(e) => setStartedOn(e.target.value)}
                  />
                )}
              </Field>
            </div>
          </>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Болих
          </Button>
          <Button type="submit" disabled={!lastName.trim() || !firstName.trim() || save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Системийн эрх тохируулах — `PATCH /memberships/:id` with a new role. */
function RoleDialog({
  user,
  membership,
  onClose,
}: {
  user: StaffUser;
  membership: StaffUser["memberships"][number] | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<string>(membership?.role ?? "");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/memberships/${membership!.id}`, z.unknown(), { method: "PATCH", body: { role } }),
    onSuccess: () => {
      toast.success("Эрх солигдлоо.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Системийн эрх тохируулах"
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/50 p-4"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (membership && role && !save.isPending) save.mutate();
        }}
        className="flex w-full max-w-[420px] flex-col gap-3 rounded-card border border-border bg-surface p-5"
      >
        <h2 className="text-lead font-semibold text-ink">Системийн эрх тохируулах</h2>
        <p className="text-body text-muted">{fullName(user)}</p>
        <FormError message={save.isError ? errorMessage(save.error) : null} />
        <Field label="Эрх" required>
          {({ id }) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              {(["TEACHER", ...OTHER_STAFF_ROLES] as Role[]).map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Болих
          </Button>
          <Button type="submit" disabled={!membership || !role || save.isPending}>
            Хадгалах
          </Button>
        </div>
      </form>
    </div>
  );
}

const UNCLAIMED_KEY = ["esis", "staff-unclaimed"] as const;

/**
 * ESIS staff with no account here yet — 2026-09-29, the client: "ESIS-ээс 13
 * ажилтны мэдээлэл шинэчлэгдлээ … ингэж ирж байгаа мөртлөө дэлгэцэнд
 * харуулахгүй байна". «ESIS татах» fills the stored roster; the two tables
 * above list accounts, so what it brought was nowhere on the page.
 *
 * ★ A list, not accounts. A person gets an account by registering with the
 * institution number (`/admin/staff-code`) — the flow the client chose, which
 * lets them set their own password — and then moves up into the tables.
 * Hidden while empty: a heading over nothing reads as a fault.
 */
function UnclaimedEsisStaff() {
  const { primaryKindergartenId } = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [linking, setLinking] = useState<UnclaimedStaff | null>(null);
  const pageSize = 20;

  const roster = useQuery({
    queryKey: [...UNCLAIMED_KEY, primaryKindergartenId, page],
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/esis/staff-roster/unclaimed?page=${page}&pageSize=${pageSize}`,
        paginated(unclaimedStaffSchema),
      ),
    enabled: Boolean(primaryKindergartenId),
    retry: false,
  });

  /*
   * ★ «Холбох» — the second answer to a row here, and usually the right one.
   * "ESIS-д байгаа, энд байхгүй" also covers a person who *has* an account
   * that nobody tied to their ministry record: every invited account starts
   * that way. The dialog lived only in `staff/staff-directory.tsx`, which this
   * page stopped rendering on 2026-09-27, so the dashboard's «Холбох» led to a
   * screen with no way to do it. The server re-checks everything
   * (`linkStaffToEsisPerson`); this list is only the shortest path.
   */
  const accounts = useQuery({
    queryKey: qk.adminUsers({ section: "esis-link", kindergartenId: primaryKindergartenId ?? "" }),
    queryFn: () =>
      get(
        `/users?kindergartenId=${primaryKindergartenId}&roles=${STAFF_ROLES.join(",")}&page=1&pageSize=100`,
        listSchema,
      ),
    enabled: Boolean(primaryKindergartenId) && Boolean(roster.data?.total),
  });
  const candidates = (accounts.data?.items ?? []).filter(
    (user) =>
      !user.esisPersonId &&
      user.isActive !== false &&
      user.memberships.some(
        (m) =>
          m.kindergartenId === primaryKindergartenId && m.role !== "PARENT" && m.isActive !== false,
      ),
  );

  const data = roster.data;
  if (!data || data.total === 0) return null;
  const offset = (page - 1) * pageSize;

  return (
    <section aria-labelledby="staff-unclaimed-heading" className="flex flex-col gap-3">
      <div>
        <h2
          id="staff-unclaimed-heading"
          className="text-display font-bold leading-heading text-ink"
        >
          ESIS-д бүртгэлтэй, системд бүртгүүлээгүй
        </h2>
        <p className="mt-1 text-body text-muted">
          Эдгээр хүмүүс{" "}
          <Link href="/admin/staff-code" className="text-primary underline">
            цэцэрлэгийн кодоор
          </Link>{" "}
          өөрсдөө бүртгүүлмэгц дээрх жагсаалтад орно. Аль хэдийн бүртгэлтэй бол «Холбох» дарж
          бүртгэлтэй нь холбоно уу.
        </p>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">ESIS-д бүртгэлтэй, бүртгүүлээгүй ажилтнууд</caption>
          <thead>
            <tr>
              <Th className="w-12 rounded-tl-card py-2">№</Th>
              <Th className="py-2">Нэр</Th>
              <Th className="py-2">Албан тушаал</Th>
              <Th className="py-2">Төрөл</Th>
              <Th className="rounded-tr-card py-2">
                <span className="sr-only">Үйлдэл</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((person, index) => (
              <tr key={person.esisPersonId} className="border-t border-border-soft">
                <Td className="py-1.5 tabular-nums text-muted">{offset + index + 1}</Td>
                <Td className="py-1.5 font-medium text-ink">{shortName(person)}</Td>
                <Td className="py-1.5 text-muted">{person.positionName || "—"}</Td>
                <Td className="py-1.5 text-muted">{person.isInstructor ? "Багш" : "Ажилтан"}</Td>
                <Td className="py-1.5 text-right">
                  {candidates.length > 0 ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${shortName(person)}-г бүртгэлтэй холбох`}
                      onClick={() => setLinking(person)}
                    >
                      Холбох
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body font-semibold text-ink">
          Нийт <span className="tabular-nums">{data.total}</span> хүн
        </p>
        <Pagination page={page} totalPages={data.totalPages} onPage={setPage} />
      </div>
      {linking && primaryKindergartenId ? (
        <StaffLinkDialog
          person={linking}
          kindergartenId={primaryKindergartenId}
          candidates={candidates}
          onLinked={() => void queryClient.invalidateQueries({ queryKey: UNCLAIMED_KEY })}
          onClose={() => setLinking(null)}
        />
      ) : null}
    </section>
  );
}
