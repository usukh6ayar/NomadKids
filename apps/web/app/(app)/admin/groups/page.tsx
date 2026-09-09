"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, UserMinus, UserPlus } from "lucide-react";
import { z } from "zod";
import {
  adminUserSchema,
  groupListItemSchema,
  groupWithTeachersSchema,
  paginated,
  schoolYearSchema,
  programKindSchema,
  attendanceFormSchema,
  PROGRAM_KIND_LABEL,
  ATTENDANCE_FORM_LABEL,
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
import { useToast } from "@/components/ui/toast";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { SingleImageUpload } from "@/components/media/single-image-upload";
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
const ATTENDANCE_FORMS = attendanceFormSchema.options;

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
  const [creating, setCreating] = useState(false);

  const groups = useQuery({
    queryKey: qk.adminGroups(),
    /*
     * ★ `pageSize=100`, the API's maximum, and this screen has no pager.
     *
     * A director assigning teachers works down the whole list, so a default
     * page of 25 would silently hide the groups at the bottom — and a group
     * that is not on screen is a group nobody notices has no teacher. A
     * kindergarten does not have a hundred groups; if one ever does, this
     * needs a pager, and it should be built then rather than guessed at now.
     */
    queryFn: () => get("/groups?pageSize=100", groupsSchema),
  });

  const items = groups.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Бүлгүүд"
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
        <DataList columns={GROUP_COLUMNS} leadWidth={null} actionsWidth="w-[104px]">
          {items.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </DataList>
      ) : null}

      {/*
        ★ ESIS's group list, including the teacher it has assigned to each.

        `instructorId` and `instructorName` are the reason this panel sits
        directly under the list rather than only on the integration screen:
        assigning a teacher to a group is a decision the ministry also records,
        and the director's question is whether the two agree. The local
        assignment is the "Багш" dialog on each row above; ESIS's answer is the
        `Багшийн код` and `Багшийн нэр` columns below, in one downward read.
      */}
      <EsisDataPanel
        resource="groups"
        title="Бүлгүүд"
        description="Бүлэг, түвшин, хөтөлбөр — мөн ESIS-д бүртгэлтэй бүлгийн багш"
      />

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

  return (
    <>
      <DataRow
        title={
          <span className="flex flex-wrap items-center gap-2">
            {/*
              ★ The name is the way in — 2026-09-06, at the client's request:
              "нэр гэдэг хэсэгт дэлгэрэнгүй харуулдаг хэсэг байх, дараад орохоор
              дотор нь ирц гэх мэтийг нь засаж болдог".

              It has to *look* like a way in at rest. A link that is black text
              and underlined on hover is indistinguishable from plain text on a
              touch screen, where the pointer never arrives — so the name
              carries the product's link colour and a chevron, the same mark
              `StatCard` and `ChildTableRow` use for the same promise.
            */}
            <Link
              href={`/groups/${group.id}`}
              className="group/name inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
            >
              <span className="min-w-0 truncate">{group.name}</span>
              <ChevronRight
                size={16}
                aria-hidden="true"
                className="shrink-0 text-primary/60 transition-transform group-hover/name:translate-x-0.5"
              />
            </Link>
            {group.status === "ARCHIVED" ? <Badge tone="neutral">Архивласан</Badge> : null}
            {/*
              ★ Drawn only when it differs from the ordinary case.

              Most groups are main-programme and standard-hours, so badging
              every row with "Үндсэн сургалт · Энгийн" would put two constant
              chips on every line and teach the eye to skip the strip that the
              exceptions live in. The default is the absence of a badge.
            */}
            {group.programKind === "ALTERNATIVE" ? (
              <Badge tone="sky">{PROGRAM_KIND_LABEL.ALTERNATIVE}</Badge>
            ) : null}
            {group.attendanceForm && group.attendanceForm !== "STANDARD" ? (
              <Badge tone="sun">{ATTENDANCE_FORM_LABEL[group.attendanceForm]}</Badge>
            ) : null}
          </span>
        }
        cells={{
          /*
            ★ A band that only repeats the name is written quietly.

            A kindergarten may name a group after its age band — the demo data
            does, so "Дунд бүлэг" is the group's name *and* the label of its
            JUNIOR band, and the row printed the same two words twice at the
            same weight, one column apart. It read as a rendering fault.

            The cell keeps the value, because the column has to mean the same
            thing on every row for a reader scanning down it — a blank here
            would say "no age band set", which is a different and false claim.
            What changes is the weight.
          */
          band: group.ageBand ? (
            <span
              className={
                BAND_LABEL[group.ageBand] === group.name
                  ? "text-body text-muted"
                  : "text-body text-ink"
              }
            >
              {BAND_LABEL[group.ageBand] ?? group.ageBand}
            </span>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setManaging(true)}
            aria-label={`${group.name} — багш хуваарилах`}
          >
            <UserPlus size={16} aria-hidden />
            Багш
          </Button>
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
  const [membershipId, setMembershipId] = useState("");
  const [role, setRole] = useState("LEAD");
  const [removingId, setRemovingId] = useState<string | null>(null);

  /*
   * ★ `GET /groups/:id` is the assignment list — there is no `/teachers` route.
   *
   * The detail endpoint includes the group's active `GroupTeacher` rows with
   * the teacher's name on each, which is exactly what this dialog draws. A
   * second endpoint returning the same rows would be a second thing to keep in
   * step with `findGroup`'s include.
   */
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
      toast.success("Багш хуваарилагдлаа.");
      setMembershipId("");
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

  // Only assignments that have not ended — `endedOn` is how the API retires one.
  const assigned = (group.data?.teachers ?? []).filter((t) => !t.endedOn);
  const assignedMembershipIds = new Set(assigned.map((t) => t.membership?.id));

  /*
   * The API takes a `membershipId`, not a user id — the assignment is to this
   * person's role *in this kindergarten*. Anyone already assigned is left out
   * rather than shown and rejected with a 409.
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
            already the place a director opens to change who teaches the group.
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
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-pill border border-border bg-canvas py-1 pl-3 pr-1.5 text-body"
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
                    className="grid size-11 place-items-center rounded-pill text-muted hover:bg-surface hover:text-danger"
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
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [ageBand, setAgeBand] = useState<string>("JUNIOR");
  const [programKind, setProgramKind] = useState<string>("MAIN");
  const [attendanceForm, setAttendanceForm] = useState<string>("STANDARD");
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
        body: { name, ageBand, schoolYearId: selectedYear, programKind, attendanceForm },
      }),
    onSuccess: () => {
      toast.success("Бүлэг үүслээ.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
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

          <Field label="Сургалтын төрөл" error={errors.programKind} required>
            {({ id }) => (
              <Select id={id} value={programKind} onChange={(e) => setProgramKind(e.target.value)}>
                {PROGRAM_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {PROGRAM_KIND_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Сургалтын хэлбэр" error={errors.attendanceForm} required>
            {({ id }) => (
              <Select
                id={id}
                value={attendanceForm}
                onChange={(e) => setAttendanceForm(e.target.value)}
              >
                {ATTENDANCE_FORMS.map((value) => (
                  <option key={value} value={value}>
                    {ATTENDANCE_FORM_LABEL[value]}
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
