"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  Info,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { z } from "zod";
import {
  adminUserSchema,
  esisPreviewResultSchema,
  groupListItemSchema,
  groupWithTeachersSchema,
  paginated,
  schoolYearSchema,
  programKindSchema,
  PROGRAM_KIND_LABEL,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { fullName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Td, Th } from "@/components/ui/table";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RowMenu } from "@/components/ui/menu";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { EsisCurriculumChain } from "@/components/esis/esis-curriculum";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

const groupsSchema = paginated(groupListItemSchema);
const usersSchema = paginated(adminUserSchema);
const yearsSchema = z.array(schoolYearSchema);

const AGE_BANDS = [
  { value: "NURSERY", label: "Бага бүлэг" },
  { value: "JUNIOR", label: "Дунд бүлэг" },
  { value: "MIDDLE", label: "Ахлах бүлэг" },
  { value: "SENIOR", label: "Бэлтгэл бүлэг" },
] as const;

const BAND_LABEL = Object.fromEntries(AGE_BANDS.map((b) => [b.value, b.label]));

/**
 * Programme and hours — Order А/261, Annex 2 §1 items 6, 14 and 16, all
 * mandatory.
 *
 * ★ Derived from the schemas rather than retyped, the way `SURVEY_KINDS` is on
 * the survey screen. A hand-written list here is a list that disagrees with the
 * API the day somebody adds a third programme: the select would offer a value
 * the server rejects, or hide one it accepts, and neither is visible from this
 * file.
 */
const PROGRAM_KINDS = programKindSchema.options;

type GroupItem = z.infer<typeof groupListItemSchema>;

const PAGE_SIZES = [20, 50, 100] as const;

/**
 * Groups and the teachers assigned to them.
 *
 * ★ The assignment is what decides what a teacher can see.
 *
 * A TEACHER membership alone reaches no child — `canAccessChild` resolves
 * access through the groups they are *actively assigned to* and the enrolments
 * in them (SECURITY.md §7). So removing someone here is a real revocation, not
 * a display change, and it takes effect on their next request because roles and
 * assignments are re-read every time.
 *
 * That is also why removal asks for confirmation: it is the screen where a
 * misclick quietly takes a teacher's children away from them.
 *
 * ★★ The local list came back on 2026-09-09, for the teacher control only.
 *
 * `f265b03` removed this list on 2026-09-08 at the client's instruction, and
 * with it five row controls: Багш оноох, Дэвшүүлэх, Засах, Архивлах, Устгах.
 * The director then asked for the first one back, so the list returns carrying
 * *only* that one. The other four stay deleted — their endpoints still exist
 * and still work, and nothing here calls them.
 *
 * The gutter is a single labelled button rather than the "⋯" menu it used to
 * be: a menu holding one entry is two gestures to reach one action, and the
 * registers that justified the menu (Ирц, Хоол, Үнэлгээ) are on `/groups/:id`,
 * which the group's name links to.
 */
export default function AdminGroupsPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminGroups />
    </RequireRole>
  );
}

function AdminGroups() {
  const { primaryKindergartenId } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<
    | { kind: "create" }
    | { kind: "edit"; group: GroupItem }
    | { kind: "teachers"; group: GroupItem }
    | { kind: "delete"; group: GroupItem }
    | null
  >(null);
  const [band, setBand] = useState("");
  const [yearId, setYearId] = useState<string | null>(null);
  const [esisOpen, setEsisOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);

  const groups = useQuery({
    queryKey: qk.adminGroups(),
    /*
     * ★ `pageSize=100`, the API's maximum. A kindergarten has far fewer
     * groups, so every filter and the pager below work on the whole list in
     * the browser rather than guessing at a server page.
     */
    queryFn: () => get("/groups?pageSize=100", groupsSchema),
  });

  const years = useQuery({
    queryKey: qk.adminSchoolYears(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(primaryKindergartenId),
  });
  const currentYear = (years.data ?? []).find((y) => y.isCurrent) ?? years.data?.[0];
  // The current school year until the director picks another; "" is all years.
  const selectedYear = yearId ?? currentYear?.id ?? "";

  const remove = useMutation({
    mutationFn: (id: string) => mutate(`/groups/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Бүлэг устгагдлаа.");
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const esisBundle = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${primaryKindergartenId}/esis/preview`, esisPreviewResultSchema, {
        method: "POST",
        body: {
          resources: ["academicYearStatuses", "groups", "groupsNextYear", "programs"],
        },
      }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const term = typed.trim().toLowerCase();
  const filtered = (groups.data?.items ?? []).filter(
    (group) =>
      (!band || group.ageBand === band) &&
      (!selectedYear || group.schoolYear?.id === selectedYear) &&
      (!term || group.name.toLowerCase().includes(term)),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, totalPages);
  const offset = (current - 1) * pageSize;
  const visible = filtered.slice(offset, offset + pageSize);
  const resetting =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  /*
    ★ The client's 2026-09-25 drawing: title and two actions, three filters, the
    register's sync date, one compact table, a pager. Two things it shows have
    no data yet — the group's teacher on the list and the sync date — and read
    "—" rather than anything invented; see the report for the API work.
  */
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Анги, бүлэг"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!primaryKindergartenId || esisBundle.isPending}
              onClick={() => {
                setEsisOpen(true);
                esisBundle.reset();
                esisBundle.mutate();
              }}
            >
              <RefreshCw
                size={16}
                className={cn(esisBundle.isPending && "animate-spin")}
                aria-hidden
              />
              {esisBundle.isPending ? "Татаж байна…" : "ESIS татах"}
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: "create" })}>
              <Plus size={18} aria-hidden />
              Бүлэг нэмэх
            </Button>
          </div>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[200px_170px_minmax(0,1fr)]">
        <Select
          aria-label="Насны бүлэг"
          value={band}
          onChange={(event) => resetting(setBand)(event.target.value)}
        >
          <option value="">Бүх насны бүлэг</option>
          {AGE_BANDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Хичээлийн жил"
          value={selectedYear}
          onChange={(event) => resetting(setYearId)(event.target.value)}
        >
          <option value="">Бүх хичээлийн жил</option>
          {(years.data ?? []).map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </Select>
        <SearchField
          label="Бүлэг эсвэл багш хайх"
          placeholder="Бүлэг эсвэл багш хайх..."
          value={typed}
          onChange={resetting(setTyped)}
        />
      </div>

      <p className="flex items-center gap-2 rounded-control border border-primary/20 bg-primary-soft px-3 py-2 text-caption text-primary">
        <Info size={15} aria-hidden /> Нэгдсэн журмаар шинэчлэгдсэн: —
      </p>

      {groups.isLoading ? <LoadingState rows={5} /> : null}
      {groups.isError ? <ErrorState description={errorMessage(groups.error)} /> : null}

      {groups.data && groups.data.items.length === 0 ? (
        <EmptyState
          title="Бүлэг байхгүй байна"
          description="Хүүхэд бүртгэхийн өмнө бүлэг үүсгэх шаардлагатай."
        />
      ) : null}
      {groups.data && groups.data.items.length > 0 && filtered.length === 0 ? (
        <EmptyState title="Бүлэг олдсонгүй" description="Шүүлтүүр эсвэл хайлтаа өөрчилж үзнэ үү." />
      ) : null}

      {visible.length > 0 ? (
        /*
          ★ A plain table, not `TableShell` — 2026-09-25, the client: the ⋯ menu
          came out cut off. `TableShell` clips its card and scrolls sideways,
          and the row menu opens inside that box; here nothing clips it.
        */
        <div className="rounded-card border border-border bg-surface">
          <table className="w-full border-collapse text-body">
            <caption className="sr-only">Бүлгүүдийн жагсаалт</caption>
            <thead>
              <tr>
                <Th className="w-12 rounded-tl-card py-2">№</Th>
                <Th className="py-2">Бүлгийн нэр</Th>
                <Th className="py-2">Насны бүлэг</Th>
                <Th className="py-2">Хөтөлбөр</Th>
                <Th className="py-2">Бүлгийн багш</Th>
                <Th className="py-2">Хүүхэд</Th>
                <Th className="w-12 rounded-tr-card py-2">
                  <span className="sr-only">Үйлдэл</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((group, index) => (
                <tr key={group.id} className="hover:bg-sunken/60">
                  <Td className="py-1.5 tabular-nums text-muted">{offset + index + 1}</Td>
                  <Td className="py-1.5">
                    <Link
                      href={`/groups/${group.id}`}
                      className="font-medium text-ink hover:text-primary hover:underline"
                    >
                      {group.name}
                    </Link>
                  </Td>
                  <Td className="py-1.5 text-muted">
                    {group.ageBand ? (BAND_LABEL[group.ageBand] ?? group.ageBand) : "—"}
                  </Td>
                  <Td className="py-1.5 text-muted">
                    {group.programKind ? (PROGRAM_KIND_LABEL[group.programKind] ?? "—") : "—"}
                  </Td>
                  {/* The list endpoint carries no teacher yet — see the report. */}
                  <Td className="py-1.5 text-faint">—</Td>
                  <Td className="py-1.5 tabular-nums text-ink">{group._count?.enrollments ?? 0}</Td>
                  <Td className="py-1 text-right">
                    <RowMenu
                      ariaLabel={`${group.name} — үйлдэл`}
                      triggerIcon={<MoreHorizontal size={18} aria-hidden="true" />}
                      items={[
                        {
                          label: "Мэдээлэл засах",
                          icon: <Pencil size={16} aria-hidden />,
                          onSelect: () => setDialog({ kind: "edit", group }),
                        },
                        {
                          label: "Багш солих",
                          icon: <UsersRound size={16} aria-hidden />,
                          onSelect: () => setDialog({ kind: "teachers", group }),
                        },
                        {
                          label: "Суралцагчдыг харах",
                          icon: <UsersRound size={16} aria-hidden />,
                          href: `/groups/${group.id}`,
                        },
                        {
                          label: "Устгах",
                          icon: <Trash2 size={16} aria-hidden />,
                          tone: "danger",
                          separated: true,
                          onSelect: () => setDialog({ kind: "delete", group }),
                        },
                      ]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {groups.data && filtered.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body font-semibold text-ink">
            Нийт <span className="tabular-nums">{filtered.length}</span> бүлэг
          </p>
          <Pagination page={current} totalPages={totalPages} onPage={setPage} />
          <label className="flex items-center gap-2 text-caption text-muted">
            Хуудас тутамд:
            <Select
              aria-label="Хуудас тутамд"
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

      {dialog?.kind === "create" && primaryKindergartenId ? (
        <GroupFormDialog
          kindergartenId={primaryKindergartenId}
          schoolYearId={selectedYear || currentYear?.id || ""}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "edit" && primaryKindergartenId ? (
        <GroupFormDialog
          kindergartenId={primaryKindergartenId}
          schoolYearId={dialog.group.schoolYear?.id ?? ""}
          group={dialog.group}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "teachers" ? (
        <ManageTeachersDialog
          groupId={dialog.group.id}
          groupName={dialog.group.name}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {esisOpen ? (
        <EsisGroupBundleDialog
          pending={esisBundle.isPending}
          result={esisBundle.data ?? null}
          error={esisBundle.isError ? errorMessage(esisBundle.error) : null}
          onRetry={() => esisBundle.mutate()}
          onClose={() => setEsisOpen(false)}
        />
      ) : null}
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(next) => (next ? undefined : setDialog(null))}
        title="Энэ бүлгийг устгах уу?"
        description={dialog?.kind === "delete" ? dialog.group.name : ""}
        confirmLabel="Устгах"
        cancelLabel="Болих"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => (dialog?.kind === "delete" ? remove.mutate(dialog.group.id) : undefined)}
      />
    </div>
  );
}

function EsisGroupBundleDialog({
  pending,
  result,
  error,
  onRetry,
  onClose,
}: {
  pending: boolean;
  result: z.infer<typeof esisPreviewResultSchema> | null;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const label = (resource: string) =>
    resource === "academicYearStatuses"
      ? "Хичээлийн жил"
      : resource === "groupsNextYear"
        ? "Дараа жилийн бүлэг"
        : resource === "programs"
          ? "Сургалтын хөтөлбөр"
          : "Анги бүлэг";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ESIS анги бүлгийн мэдээлэл"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="relative flex w-full max-w-[620px] flex-col gap-4 rounded-card border border-border bg-surface p-5">
        <button
          type="button"
          aria-label="Хаах"
          onClick={onClose}
          className="absolute right-3 top-3 grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
        >
          <X size={18} aria-hidden />
        </button>

        <div className="pr-10">
          <h2 className="text-lead font-semibold text-ink">ESIS анги бүлгийн мэдээлэл</h2>
          <p className="mt-1 text-body text-muted">
            Хичээлийн жил болон анги бүлгийг нэг үйлдлээр зэрэг татна.
          </p>
        </div>

        {pending ? <LoadingState rows={2} /> : null}
        <FormError message={error} />

        {result ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {result.results.map((item) => (
              <div
                key={item.resource}
                className={cn(
                  "rounded-row border p-4",
                  item.status === "SUCCEEDED"
                    ? "border-mint-ink/20 bg-mint"
                    : "border-danger/20 bg-danger-soft",
                )}
              >
                <p className="text-body font-semibold text-ink">{label(item.resource)}</p>
                <p className="mt-1 text-title font-semibold tabular-nums text-ink">
                  {item.count} бичлэг
                </p>
                <p className="mt-1 text-caption text-muted">
                  {item.status === "SUCCEEDED" ? "Амжилттай татлаа" : `Алдаа: ${item.errorCode}`}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {result ? (
          <section className="rounded-row border border-border p-4" aria-label="Сургалтын хөтөлбөр">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-body font-semibold text-ink">Сургалтын хөтөлбөр</h3>
                <p className="mt-1 text-caption text-muted">
                  Хөтөлбөр → үе шат → төлөвлөгөө → хичээлийг эндээс шалгана.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setCurriculumOpen((current) => !current)}
              >
                {curriculumOpen ? "Хураах" : "Шатлал харах"}
              </Button>
            </div>
            {curriculumOpen ? (
              <div className="mt-4 border-t border-border pt-4">
                <EsisCurriculumChain />
              </div>
            ) : null}
          </section>
        ) : null}

        <p className="rounded-control bg-canvas px-3 py-2 text-caption text-muted">
          Улирлын тусдаа ESIS сервис байхгүй. Улирал нь татагдсан хичээлийн жилтэй NomadKids дотор
          холбоотой ажиллана. Энэ үйлдэл одоогоор read-only шалгалт бөгөөд дотоод бүртгэлийг
          автоматаар өөрчлөхгүй.
        </p>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {error ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={onRetry}>
              Дахин оролдох
            </Button>
          ) : null}
          <Button type="button" onClick={onClose}>
            Хаах
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Багш хуваарилалт — the client's 2026-09-25 drawing: the group's teachers in
 * two lists, Бүлгийн багш (LEAD) and Багшийн туслах (ASSISTANT), each with its
 * own "Багш нэмэх" and a bin on every row.
 *
 * ★ The same two endpoints as before — `POST /groups/:id/teachers` with the
 * list's role, `DELETE /group-teachers/:id` — and a removal still asks first
 * (§5): it takes a teacher's children away from them on their next request.
 * The class photograph's upload went on 2026-09-25, at the client's request.
 */
function ManageTeachersDialog({
  groupId,
  groupName,
  onClose,
}: {
  groupId: string;
  groupName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { primaryKindergartenId } = useSession();
  const [adding, setAdding] = useState<"LEAD" | "ASSISTANT" | null>(null);
  const [membershipId, setMembershipId] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const group = useQuery({
    queryKey: ["admin", "groups", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupWithTeachersSchema),
  });

  const teachers = useQuery({
    queryKey: qk.adminUsers({ role: "TEACHER" }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "100", role: "TEACHER" });
      if (primaryKindergartenId) params.set("kindergartenId", primaryKindergartenId);
      return get(`/users?${params}`, usersSchema);
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
  };

  const assign = useMutation({
    mutationFn: (role: "LEAD" | "ASSISTANT") =>
      mutate(`/groups/${groupId}/teachers`, z.unknown(), {
        method: "POST",
        body: { membershipId, role },
      }),
    onSuccess: () => {
      toast.success("Багш хуваарилагдлаа.");
      setMembershipId("");
      setAdding(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => mutate(`/group-teachers/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Багшийг хаслаа.");
      setRemovingId(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const assigned = (group.data?.teachers ?? []).filter((t) => !t.endedOn);
  const assignedMembershipIds = new Set(assigned.map((t) => t.membership?.id));
  const options = (teachers.data?.items ?? []).flatMap((u) => {
    const m = u.memberships.find((x) => x.role === "TEACHER");
    return m && !assignedMembershipIds.has(m.id)
      ? [{ membershipId: m.id, label: fullName(u) }]
      : [];
  });

  const lists = [
    { role: "LEAD" as const, title: "Бүлгийн багш", tone: "bg-primary-soft text-primary" },
    { role: "ASSISTANT" as const, title: "Багшийн туслах", tone: "bg-mint text-mint-ink" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${groupName} — багш`}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="relative flex w-full max-w-[480px] flex-col gap-3 rounded-card border border-border bg-surface p-5">
        <button
          type="button"
          aria-label="Хаах"
          onClick={onClose}
          className="absolute right-3 top-3 grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
        >
          <X size={18} aria-hidden />
        </button>
        <div>
          <h2 className="text-lead font-bold leading-heading text-ink">Багш хуваарилалт</h2>
          <p className="mt-0.5 text-caption text-muted">
            {groupName} бүлэгт ажиллах багш нарыг нэмнэ.
          </p>
        </div>

        <FormError
          message={
            assign.isError
              ? errorMessage(assign.error)
              : remove.isError
                ? errorMessage(remove.error)
                : null
          }
        />

        {group.isLoading ? <LoadingState rows={2} /> : null}

        {lists.map(({ role, title, tone }) => {
          const people = assigned.filter((t) =>
            role === "LEAD" ? t.role !== "ASSISTANT" : t.role === "ASSISTANT",
          );
          const headingId = `teachers-${role}`;
          return (
            <section
              key={role}
              aria-labelledby={headingId}
              className="flex flex-col rounded-card border border-border-soft"
            >
              <div className="flex items-center justify-between gap-3 rounded-t-card bg-sunken px-3 py-2">
                <h3
                  id={headingId}
                  className="flex items-center gap-2 text-body font-semibold text-ink"
                >
                  {title}
                  <span
                    className={cn(
                      "grid min-w-6 place-items-center rounded-pill px-1.5 text-caption tabular-nums",
                      tone,
                    )}
                  >
                    {people.length}
                  </span>
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={options.length === 0}
                  onClick={() => {
                    setAdding(role);
                    setMembershipId("");
                  }}
                >
                  <Plus size={16} aria-hidden /> Багш нэмэх
                </Button>
              </div>

              <div className="flex flex-col gap-1.5 p-2">
                {people.length === 0 && !group.isLoading ? (
                  <p className="px-1 text-caption text-muted">Хуваарилаагүй байна.</p>
                ) : null}
                {people.map((t) => (
                  <div
                    key={t.id}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-control border border-border-soft px-3 py-1"
                  >
                    <span className="text-compact text-ink">{fullName(t.membership?.user)}</span>
                    {removingId === t.id ? (
                      <span className="flex items-center gap-1.5">
                        <span className="text-caption text-muted">Хасах уу?</span>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => remove.mutate(t.id)}
                          disabled={remove.isPending}
                        >
                          Тийм
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemovingId(null)}>
                          Үгүй
                        </Button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRemovingId(t.id)}
                        aria-label={`${fullName(t.membership?.user)}-г бүлгээс хасах`}
                        className="grid size-8 place-items-center rounded-control border border-border-soft text-muted hover:text-danger"
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    )}
                  </div>
                ))}

                {adding === role ? (
                  <form
                    className="flex flex-wrap items-end gap-2 pt-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (membershipId && !assign.isPending) assign.mutate(role);
                    }}
                  >
                    <Field label="Багш" className="min-w-[220px] flex-1">
                      {({ id }) => (
                        <Select
                          id={id}
                          value={membershipId}
                          onChange={(e) => setMembershipId(e.target.value)}
                        >
                          <option value="">Сонгоно уу</option>
                          {options.map((o) => (
                            <option key={o.membershipId} value={o.membershipId}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Button type="submit" disabled={!membershipId || assign.isPending}>
                      <UserPlus size={16} aria-hidden />
                      {assign.isPending ? "Нэмж байна…" : "Нэмэх"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
                      Болих
                    </Button>
                  </form>
                ) : null}
              </div>
            </section>
          );
        })}

        {options.length === 0 && teachers.data ? (
          <p className="flex items-center gap-2 rounded-control bg-sun px-3 py-2.5 text-caption text-sun-ink">
            <CircleAlert size={18} aria-hidden className="shrink-0" />
            Нэмэх багш алга. «Хэрэглэгчид» хэсгээс багш урина уу.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Бүлэг нэмэх / Мэдээлэл засах — the client's 2026-09-25 drawing: name, age
 * band, programme and (when adding) the group's teacher.
 *
 * ★ Only existing endpoints: `POST …/groups` and then `POST /groups/:id/teachers`
 * for the teacher, or `PATCH /groups/:id` when editing. The school year the
 * API requires is the one the list is filtered to, so the new group lands
 * where the director is looking.
 */
function GroupFormDialog({
  kindergartenId,
  schoolYearId,
  group,
  onClose,
}: {
  kindergartenId: string;
  schoolYearId: string;
  group?: GroupItem;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const editing = Boolean(group);
  const [name, setName] = useState(group?.name ?? "");
  const [ageBand, setAgeBand] = useState<string>(group?.ageBand ?? "");
  const [programKind, setProgramKind] = useState<string>(group?.programKind ?? "");
  const [membershipId, setMembershipId] = useState("");

  const teachers = useQuery({
    queryKey: qk.adminUsers({ role: "TEACHER" }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "100", role: "TEACHER" });
      params.set("kindergartenId", kindergartenId);
      return get(`/users?${params}`, usersSchema);
    },
    enabled: !editing,
  });
  const options = (teachers.data?.items ?? []).flatMap((u) => {
    const m = u.memberships.find((x) => x.role === "TEACHER");
    return m ? [{ membershipId: m.id, label: fullName(u) }] : [];
  });

  const save = useMutation({
    mutationFn: async () => {
      if (group) {
        return mutate(`/groups/${group.id}`, z.unknown(), {
          method: "PATCH",
          body: { name, ageBand, programKind },
        });
      }
      const created = await mutate(
        `/kindergartens/${kindergartenId}/groups`,
        z.object({ id: z.string() }).passthrough(),
        { method: "POST", body: { name, ageBand, programKind, schoolYearId } },
      );
      await mutate(`/groups/${created.id}/teachers`, z.unknown(), {
        method: "POST",
        body: { membershipId, role: "LEAD" },
      });
      return created;
    },
    onSuccess: () => {
      toast.success(editing ? "Бүлгийн мэдээлэл хадгалагдлаа." : "Бүлэг үүслээ.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);
  const ready =
    name.trim() && ageBand && programKind && (editing || (membershipId && schoolYearId));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "Мэдээлэл засах" : "Бүлэг нэмэх"}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-[560px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !save.isPending) save.mutate();
          }}
          className="flex flex-col gap-3"
          noValidate
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lead font-semibold text-ink">
              {editing ? "Мэдээлэл засах" : "Бүлэг нэмэх"}
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

          <FormError message={save.isError ? errorMessage(save.error) : null} />

          {!editing && !schoolYearId ? (
            <p className="rounded-control bg-sun px-3 py-2 text-body text-sun-ink">
              Хичээлийн жил үүсгээгүй байна. ESIS таталтаа шалгаад шаардлагатай бол{" "}
              <Link href="/admin/school-years" className="font-semibold underline">
                хичээлийн жил тохируулна уу
              </Link>
              .
            </p>
          ) : null}

          <Field label="Бүлгийн нэр" error={errors.name} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Жишээ: Дэлбээ"
                autoFocus
              />
            )}
          </Field>

          <Field label="Насны бүлэг" error={errors.ageBand} required>
            {({ id }) => (
              <Select id={id} value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
                <option value="">Сонгох</option>
                {AGE_BANDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Хөтөлбөр" error={errors.programKind} required>
            {({ id }) => (
              <Select id={id} value={programKind} onChange={(e) => setProgramKind(e.target.value)}>
                <option value="">Сонгох</option>
                {PROGRAM_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {PROGRAM_KIND_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {editing ? null : (
            <Field label="Бүлгийн багш" required>
              {({ id }) => (
                <Select
                  id={id}
                  value={membershipId}
                  onChange={(e) => setMembershipId(e.target.value)}
                >
                  <option value="">Багш сонгох</option>
                  {options.map((o) => (
                    <option key={o.membershipId} value={o.membershipId}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Болих
            </Button>
            <Button type="submit" disabled={!ready || save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
