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
import { ROLE_LABEL, adminUserSchema, paginated, type Role } from "@kinder/contracts";
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

/**
 * Багш ба Ажилтан — the director's staff directory, client 2026-09-25, with two
 * drawings: two compact tables, and a side panel that opens on a person.
 *
 * ★ Only what the API holds is shown. It has no register number, birth date,
 * position title, category, hire date, assigned group or ESIS record for a
 * staff member; those cells and filters read "—" or are disabled rather than
 * invented, and the report lists the API work each needs. The actions are the
 * existing ones: edit (`PATCH /users/:id`), the role (`PATCH /memberships/:id`),
 * deactivate (`isActive`), and invite.
 */
export function StaffDirectory({ onInvite }: { onInvite: (role: Role) => void }) {
  const [openUserId, setOpenUserId] = useState<{ id: string; kind: SectionKind } | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">Багш, ажилтан</h1>
      <StaffSection kind="teacher" onInvite={onInvite} onOpen={setOpenUserId} />
      <StaffSection kind="staff" onInvite={onInvite} onOpen={setOpenUserId} />
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [roleOf, setRoleOf] = useState<StaffUser | null>(null);
  const [deactivating, setDeactivating] = useState<StaffUser | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();

  const teacher = kind === "teacher";
  const roles = teacher ? "TEACHER" : role || OTHER_STAFF_ROLES.join(",");

  const users = useQuery({
    queryKey: qk.adminUsers({
      section: kind,
      q: search,
      roles,
      page: String(page),
      pageSize: String(pageSize),
    }),
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        roles,
      });
      if (search) params.set("q", search);
      if (primaryKindergartenId) params.set("kindergartenId", primaryKindergartenId);
      return get(`/users?${params}`, listSchema);
    },
    enabled: Boolean(primaryKindergartenId),
  });

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
          {/* No staff export exists yet — shown, never faked. */}
          <Button
            size="sm"
            variant="secondary"
            disabled
            title="Ажилтны Excel экспорт хараахан байхгүй байна"
          >
            <Download size={16} aria-hidden /> Excel
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href="/admin/integrations/esis">
              <RefreshCw size={16} aria-hidden /> ESIS татах
            </Link>
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
            value=""
            disabled
            title="Албан тушаалын мэдээлэл байхгүй"
          >
            <option value="">Бүх албан тушаал</option>
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
        <Select
          aria-label={teacher ? "Бүлэг" : "Ангилал"}
          value=""
          disabled
          title={teacher ? "Багшийн бүлгийн мэдээлэл байхгүй" : "Ангиллын мэдээлэл байхгүй"}
        >
          <option value="">{teacher ? "Бүх бүлэг" : "Бүх ангилал"}</option>
        </Select>
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
            · Бүлэг хариуцсан <span className="text-ink">—</span> · Бүлэггүй{" "}
            <span className="text-ink">—</span>
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
                    {/* No register number on a staff account yet. */}
                    <Td className="py-1.5 text-faint">—</Td>
                    <Td className="py-1.5 text-muted">
                      {membership ? ROLE_LABEL[membership.role] : "—"}
                    </Td>
                    {/* No group or category on the list yet. */}
                    <Td className="py-1.5 text-faint">—</Td>
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

      {editing ? <EditUserDialog user={editing} onClose={() => setEditing(null)} /> : null}
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
  const roleLabel = membership ? ROLE_LABEL[membership.role] : "—";
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
                    <InfoRow icon={<IdCard size={16} />} label="Регистр" value={null} />
                    <InfoRow icon={<CalendarDays size={16} />} label="Төрсөн огноо" value={null} />
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
                        value={null}
                      />
                    ) : (
                      <InfoRow icon={<UsersRound size={16} />} label="Ангилал" value={null} />
                    )}
                    <InfoRow
                      icon={<CalendarDays size={16} />}
                      label="Ажилд орсон огноо"
                      value={null}
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
                  <InfoRow icon={<UsersRound size={16} />} label="Хариуцсан бүлэг" value={null} />
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

        {editing && data ? <EditUserDialog user={data} onClose={() => setEditing(false)} /> : null}
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
function EditUserDialog({ user, onClose }: { user: StaffUser; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [lastName, setLastName] = useState(user.lastName);
  const [firstName, setFirstName] = useState(user.firstName);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [email, setEmail] = useState(user.email ?? "");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/users/${user.id}`, z.unknown(), {
        method: "PATCH",
        body: {
          lastName: lastName.trim(),
          firstName: firstName.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          email: email.trim() || null,
        },
      }),
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
        className="flex w-full max-w-[460px] flex-col gap-3 rounded-card border border-border bg-surface p-5"
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
