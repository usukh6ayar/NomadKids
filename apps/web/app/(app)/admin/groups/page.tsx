"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, Trash2, UserMinus, UserPlus } from "lucide-react";
import { z } from "zod";
import {
  adminUserSchema,
  groupListItemSchema,
  groupWithTeachersSchema,
  paginated,
  schoolYearSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/shell/app-shell";
import { SingleImageUpload } from "@/components/media/single-image-upload";
import { RequireRole } from "@/components/shell/require-role";

const groupsSchema = paginated(groupListItemSchema);
const yearsSchema = z.array(schoolYearSchema);
const usersSchema = paginated(adminUserSchema);

const AGE_BANDS = [
  { value: "NURSERY", label: "Бага бүлэг" },
  { value: "JUNIOR", label: "Дунд бүлэг" },
  { value: "MIDDLE", label: "Ахлах бүлэг" },
  { value: "SENIOR", label: "Бэлтгэл бүлэг" },
] as const;

const BAND_LABEL = Object.fromEntries(AGE_BANDS.map((b) => [b.value, b.label]));

/**
 * The list's columns.
 *
 * `Хүүхэд` is the narrowest and the one a director scans — it is the answer to
 * "is this group full?" and it now sits in a column instead of at the end of a
 * dot-joined sentence.
 */
const GROUP_COLUMNS = [
  { key: "band", label: "Насны бүлэг", className: "md:w-[124px]" },
  { key: "year", label: "Хичээлийн жил", className: "md:w-[120px]" },
  { key: "children", label: "Хүүхэд", className: "md:w-[92px]" },
];

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
  const [creating, setCreating] = useState(false);

  const groups = useQuery({
    queryKey: qk.adminGroups(),
    queryFn: () => get("/groups", groupsSchema),
  });

  const items = groups.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Бүлгүүд"
        lede="Бүлэг үүсгэж, багш хуваарилна."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={18} />
            Бүлэг нэмэх
          </Button>
        }
      />

      {groups.isLoading ? <LoadingState rows={3} /> : null}
      {groups.isError ? <ErrorState description={errorMessage(groups.error)} /> : null}

      {groups.data && items.length === 0 ? (
        <EmptyState
          title="Бүлэг байхгүй байна"
          description="Хүүхэд бүртгэхийн өмнө бүлэг үүсгэх шаардлагатай."
        />
      ) : null}

      {items.length > 0 ? (
        <DataList columns={GROUP_COLUMNS} leadWidth={null} actionsWidth="w-[352px]">
          {items.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </DataList>
      ) : null}

      {creating && primaryKindergartenId ? (
        <CreateGroupDialog
          kindergartenId={primaryKindergartenId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

function GroupRow({ group }: { group: z.infer<typeof groupListItemSchema> }) {
  const [managing, setManaging] = useState(false);
  const children = group._count?.enrollments ?? 0;
  const isArchived = group.status === "ARCHIVED";

  return (
    <>
      <DataRow
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate">{group.name}</span>
            {/*
              ★ The status had no representation at all before this.

              `Group.status` has existed since the schema was written and the
              list has always returned it, so an archived group was
              indistinguishable from a live one — it simply sat in the list
              behaving normally.
            */}
            {isArchived ? <Badge tone="neutral">Архивласан</Badge> : null}
          </span>
        }
        cells={{
          /*
            ★ Three facts that used to be one dot-joined line under the name.

            "Дунд бүлэг · 2026-2027 · 5 хүүхэд" reads as a sentence and has to
            be parsed as one: nothing lines up between rows, so comparing two
            groups' enrolment means finding the third fragment of each. It also
            put the age band immediately after a name that, for most
            kindergartens, *is* the age band — the demo data renders "Дунд
            бүлэг" twice on the same row.
          */
          band: group.ageBand ? (
            <span className="text-body text-ink">{BAND_LABEL[group.ageBand] ?? group.ageBand}</span>
          ) : null,
          year: group.schoolYear?.name ? (
            <span className="text-body text-muted">{group.schoolYear.name}</span>
          ) : null,
          children: (
            <span className="text-body tabular-nums text-ink">
              {children}
              <span className="text-muted"> хүүхэд</span>
            </span>
          ),
        }}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setManaging(true)}>
              <UserPlus size={16} />
              Багш
            </Button>

            <EditGroupButton group={group} />
            <ArchiveToggleButton group={group} />
            <DeleteGroupButton group={group} enrolled={children} />
          </>
        }
      />

      {managing ? (
        <ManageTeachersDialog
          groupId={group.id}
          groupName={group.name}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Renaming a group, or moving it to a different age band — `PATCH /groups/:id`.
 *
 * ★ The fields are what `updateGroupSchema` accepts, minus `status`.
 *
 * The DTO allows `name`, `ageBand` and `status`. `status` is deliberately not
 * in this form: it is a reversible state with an immediate effect, and burying
 * it in a form behind a Save button is the wrong shape for something that reads
 * as a switch. It gets its own control beside this one.
 *
 * `schoolYearId` is absent from the DTO entirely, so a group cannot be moved
 * between years — that is a real backend constraint, not an omission here.
 *
 * No confirmation: an edit with an explicit "Хадгалах" is already deliberate.
 */
function EditGroupButton({ group }: { group: z.infer<typeof groupListItemSchema> }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group.name);
  const [ageBand, setAgeBand] = useState(group.ageBand ?? "NURSERY");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/groups/${group.id}`, groupListItemSchema, {
        method: "PATCH",
        body: { name: name.trim(), ageBand },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.adminGroups() });
      toast.success(`${name.trim()} — хадгалагдлаа.`);
      setOpen(false);
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          // Re-seeded on open: the list refetches while this is closed, and a
          // form still holding its mount-time values would write them back.
          setName(group.name);
          setAgeBand(group.ageBand ?? "NURSERY");
          save.reset();
          setOpen(true);
        }}
      >
        <Pencil size={16} aria-hidden="true" />
        Засах
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        busy={save.isPending}
        title="Бүлэг засах"
        description={group.schoolYear?.name ? `Хичээлийн жил: ${group.schoolYear.name}` : undefined}
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
            <Button type="submit" form="edit-group-form" size="sm" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id="edit-group-form"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
        >
          <FormError
            message={
              save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
            }
          />

          <Field label="Бүлгийн нэр" error={errors.name} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>

          <Field label="Насны бүлэг" error={errors.ageBand} required>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={ageBand}
                onChange={(e) => setAgeBand(e.target.value)}
              >
                {AGE_BANDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </form>
      </FormDialog>
    </>
  );
}

/**
 * Archiving and restoring — `PATCH /groups/:id { status }`.
 *
 * ★ This is the reversible one, and it is NOT the `DELETE` route.
 *
 * The product has two separate operations on a group and they are easy to
 * confuse. `status: ARCHIVED | ACTIVE` is a flag on the row: the group stays in
 * the list, keeps its children and its history, and flips back with one press.
 * `DELETE /groups/:id` sets `deletedAt`, after which `baseWhere` stops
 * returning the row from every query and no endpoint brings it back.
 *
 * So archiving gets no confirmation — it is a toggle, the same reasoning that
 * keeps a prompt off assessment publish — and the button says which direction
 * it goes. The one-way operation is the one that asks.
 */
function ArchiveToggleButton({ group }: { group: z.infer<typeof groupListItemSchema> }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isArchived = group.status === "ARCHIVED";
  const next = isArchived ? "ACTIVE" : "ARCHIVED";

  const change = useMutation({
    mutationFn: () =>
      mutate(`/groups/${group.id}`, groupListItemSchema, {
        method: "PATCH",
        body: { status: next },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.adminGroups() });
      toast.success(
        next === "ARCHIVED" ? `${group.name} — архивлагдлаа.` : `${group.name} — сэргээгдлээ.`,
      );
    },
  });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="ghost" size="sm" disabled={change.isPending} onClick={() => change.mutate()}>
        {isArchived ? (
          <>
            <RotateCcw size={16} aria-hidden="true" />
            {change.isPending ? "Сэргээж байна…" : "Сэргээх"}
          </>
        ) : (
          <>
            <Archive size={16} aria-hidden="true" />
            {change.isPending ? "Архивлаж байна…" : "Архивлах"}
          </>
        )}
      </Button>

      {change.isError ? (
        <span role="alert" className="text-caption text-danger">
          {errorMessage(change.error)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Removing a group for good — `DELETE /groups/:id`.
 *
 * ★ A soft delete the UI cannot undo.
 *
 * `archiveGroup` sets `deletedAt`, and `baseWhere` filters it out of every
 * query in the product. The row survives in the database for the audit trail,
 * but nothing in this application will show it again and there is no restore
 * endpoint — so from an administrator's point of view this is permanent, and it
 * is confirmed for exactly that reason.
 *
 * ★★ The backend refuses while children are enrolled, and that rule is
 * preserved rather than pre-empted.
 *
 * `countActiveEnrollments` guards it with a 409 whose message names the number
 * of children and says what to do — "Эхлээд тэднийг өөр бүлэгт шилжүүлнэ үү".
 * That message is the instruction, so it is rendered inline and left on screen.
 * The button is disabled when the list already shows enrolments, which is a
 * courtesy rather than the check: the count in the list can be stale, and the
 * server decides.
 */
function DeleteGroupButton({
  group,
  enrolled,
}: {
  group: z.infer<typeof groupListItemSchema>;
  enrolled: number;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const remove = useMutation({
    mutationFn: () => mutate(`/groups/${group.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.adminGroups() });
      toast.success(`${group.name} — устгагдлаа.`);
    },
  });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <ConfirmDialog
        title="Бүлгийг устгах"
        description={`"${group.name}" бүлгийг бүрмөсөн устгана. Буцаах боломжгүй — түр хугацаагаар хаахыг хүсвэл "Архивлах"-ыг сонгоно уу.`}
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            disabled={remove.isPending || enrolled > 0}
            aria-label={`${group.name} — устгах`}
            title={
              enrolled > 0
                ? "Бүлэгт хүүхэд бүртгэлтэй байна. Эхлээд өөр бүлэгт шилжүүлнэ үү."
                : undefined
            }
            className="text-muted hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 size={16} aria-hidden="true" />
          </Button>
        }
      />

      {/* The 409 is the instruction — it stays put rather than passing in a toast. */}
      {remove.isError ? (
        <span role="alert" className="max-w-[260px] text-right text-caption text-danger">
          {errorMessage(remove.error)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The assignments for one group, fetched when this opens.
 *
 * ★ Loaded here rather than with the list, because `GET /groups` does not carry
 * teachers and asking per row would be an N+1 on a screen that mostly does not
 * need them. One request, when somebody actually wants to see or change them.
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
  const queryClient = useQueryClient();
  const { primaryKindergartenId } = useSession();
  const [membershipId, setMembershipId] = useState("");
  const [role, setRole] = useState("LEAD");
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
    mutationFn: () =>
      mutate(`/groups/${groupId}/teachers`, z.unknown(), {
        method: "POST",
        body: { membershipId, role },
      }),
    onSuccess: () => {
      setMembershipId("");
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => mutate(`/group-teachers/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      setRemovingId(null);
      refresh();
    },
  });

  // Only assignments that have not ended — `endedOn` is how the API retires one.
  const assigned = (group.data?.teachers ?? []).filter((t) => !t.endedOn);
  const assignedMembershipIds = new Set(assigned.map((t) => t.membership?.id));

  /*
   * The API takes a `membershipId`, not a user id — the assignment is to this
   * person's role *in this kindergarten*. Anyone already assigned is left out
   * rather than shown and rejected.
   */
  const options = (teachers.data?.items ?? []).flatMap((u) => {
    const m = u.memberships.find((x) => x.role === "TEACHER");
    return m && !assignedMembershipIds.has(m.id)
      ? [{ membershipId: m.id, label: fullName(u) }]
      : [];
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${groupName} — багш`}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[460px] rounded-card border border-border bg-surface p-5">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-title font-semibold text-ink">Багш хуваарилалт</h2>
            <p className="mt-0.5 text-body text-muted">{groupName}</p>
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

          {group.isLoading ? <LoadingState rows={1} /> : null}

          {/*
            RFP §3.2 — ангийн зураг. It lives in this dialog rather than on the
            list because the list is a roster of names and a column of class
            photographs would push the group names off a phone screen. This is
            already the place a teacher opens to change who teaches the group.
          */}
          <SingleImageUpload
            endpoint={`/groups/${groupId}/photo`}
            currentMediaId={group.data?.photoMediaFileId}
            label="Ангийн зураг нэмэх"
            alt={`${groupName} бүлгийн зураг`}
            invalidateKeys={[["admin", "groups"]]}
          />

          <div className="flex flex-wrap items-center gap-2">
            {assigned.length === 0 && !group.isLoading ? (
              <span className="text-body text-muted">Багш хуваарилаагүй байна.</span>
            ) : null}

            {assigned.map((t) => (
              <span
                key={t.id}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-pill border border-border bg-canvas py-1 pl-3 pr-1.5 text-body"
              >
                <span className="text-ink">{fullName(t.membership?.user)}</span>
                {t.role === "ASSISTANT" ? <Badge tone="sky">Туслах</Badge> : null}

                {removingId === t.id ? (
                  <>
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
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRemovingId(t.id)}
                    aria-label={`${fullName(t.membership?.user)}-г бүлгээс хасах`}
                    className="grid size-9 place-items-center rounded-pill text-muted hover:bg-surface hover:text-danger"
                  >
                    <UserMinus size={15} />
                  </button>
                )}
              </span>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (membershipId && !assign.isPending) assign.mutate();
            }}
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            {options.length === 0 && teachers.data ? (
              <p className="rounded-control bg-sun px-3 py-2 text-body text-sun-ink">
                Нэмэх багш алга. «Хэрэглэгчид» хэсгээс багш урина уу.
              </p>
            ) : (
              <>
                <Field label="Багш нэмэх">
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

                <Field label="Үүрэг">
                  {({ id }) => (
                    <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                      <option value="LEAD">Үндсэн багш</option>
                      <option value="ASSISTANT">Туслах багш</option>
                    </Select>
                  )}
                </Field>

                <Button type="submit" disabled={!membershipId || assign.isPending}>
                  <UserPlus size={16} />
                  {assign.isPending ? "Нэмж байна…" : "Нэмэх"}
                </Button>
              </>
            )}
          </form>

          <div className="border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Хаах
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateGroupDialog({
  kindergartenId,
  onClose,
}: {
  kindergartenId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [ageBand, setAgeBand] = useState<string>("JUNIOR");
  const [schoolYearId, setSchoolYearId] = useState("");

  const years = useQuery({
    queryKey: qk.adminSchoolYears(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/school-years`, yearsSchema),
  });

  // Default to the current year — the one a new group almost always belongs to.
  const current = (years.data ?? []).find((y) => y.isCurrent) ?? years.data?.[0];
  const selectedYear = schoolYearId || current?.id || "";

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/groups`, z.unknown(), {
        method: "POST",
        body: { name, ageBand, schoolYearId: selectedYear },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
      onClose();
    },
  });

  const errors = fieldErrors(create.error);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Бүлэг нэмэх"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-[420px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (selectedYear && !create.isPending) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <h2 className="text-title font-semibold text-ink">Бүлэг нэмэх</h2>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          {years.data && years.data.length === 0 ? (
            <p className="rounded-control bg-sun px-3 py-2 text-body text-sun-ink">
              Хичээлийн жил үүсгээгүй байна. «Хичээлийн жил» хэсгээс эхэлнэ үү.
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
                placeholder="Дунд бүлэг"
                autoFocus
              />
            )}
          </Field>

          <Field label="Насны ангилал" error={errors.ageBand} required>
            {({ id }) => (
              <Select id={id} value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
                {AGE_BANDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Хичээлийн жил" error={errors.schoolYearId} required>
            {({ id }) => (
              <Select
                id={id}
                value={selectedYear}
                onChange={(e) => setSchoolYearId(e.target.value)}
              >
                {(years.data ?? []).map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                    {y.isCurrent ? " (одоогийн)" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={!selectedYear || create.isPending}>
              {create.isPending ? "Үүсгэж байна…" : "Үүсгэх"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Болих
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
