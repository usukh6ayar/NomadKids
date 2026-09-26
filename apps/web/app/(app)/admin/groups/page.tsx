"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { z } from "zod";
import {
  ATTENDANCE_FORM_LABEL,
  PROGRAM_KIND_LABEL,
  attendanceFormSchema,
  groupListItemSchema,
  paginated,
  programKindSchema,
  schoolYearSchema,
  type GroupListItem,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { Tabs, TabButton } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { EsisRosterImportButton } from "@/components/esis/esis-roster-import";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";
import { GroupGrid } from "@/components/admin/groups/group-grid";
import { ManageTeachersDialog } from "@/components/admin/groups/manage-teachers-dialog";
import { groupLabel } from "@/lib/format";

const groupsSchema = paginated(groupListItemSchema);
const yearsSchema = z.array(schoolYearSchema);

const AGE_BANDS = [
  { value: "NURSERY", label: "Бага бүлэг" },
  { value: "JUNIOR", label: "Дунд бүлэг" },
  { value: "MIDDLE", label: "Ахлах бүлэг" },
  { value: "SENIOR", label: "Бэлтгэл бүлэг" },
] as const;

/**
 * Programme and hours — Order А/261, Annex 2 §1 items 6, 14 and 16, all
 * mandatory. Derived from the schemas rather than retyped: a hand-written list
 * is one that disagrees with the API the day somebody adds a third programme.
 */
const PROGRAM_KINDS = programKindSchema.options;
const ATTENDANCE_FORMS = attendanceFormSchema.options;

/**
 * Бүлгүүд — the kindergarten's classes.
 *
 * ★ **Rebuilt as a grid of cards, 2026-09-23.** The list it replaced put the
 * name, the band, the year, the count and one button on a row, and the
 * question a director actually arrives with — which class has nobody teaching
 * it — was not on the screen at all. It could not be: `GET /groups` did not
 * carry its assignments, and asking per row would have been the N+1 §3.4
 * forbids. The API carries them now, so the card can lead with the teacher and
 * the tiles can count the gaps.
 *
 * ★★ **The card opens `/groups/{local id}`.** `esisGroupId` is the ministry's
 * key for the same class and stays out of every URL: attendance, meals,
 * assessment and the roster all resolve children through `Enrollment`, which
 * hangs off our own id.
 *
 * ★★★ Four controls stay deleted. `f265b03` removed Дэвшүүлэх, Засах,
 * Архивлах and Устгах on 2026-09-08 at the client's instruction and only Багш
 * оноох was asked back for. Their endpoints still exist and still work; nothing
 * here calls them, and this refactor did not quietly restore them.
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
  const [managing, setManaging] = useState<GroupListItem | null>(null);
  const [tab, setTab] = useState<"groups" | "esis">("groups");

  const groups = useQuery({
    queryKey: qk.adminGroups(),
    /*
     * `pageSize=100`, the API's maximum, and this screen has no pager. A
     * director works down the whole list, so a default page of 25 would hide
     * the groups at the bottom — and a group that is not on screen is a group
     * nobody notices has no teacher. A kindergarten does not have a hundred
     * groups; if one ever does, this needs a pager and the grid's filtering
     * moves to the API with it.
     */
    queryFn: () => get("/groups?pageSize=100", groupsSchema),
  });

  const items = groups.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Бүлгүүд"
        actions={
          <>
            {/*
              The import is how a kindergarten that keeps its register in ESIS
              fills this screen in one press; creating a group by hand is still
              how a kindergarten that does not — or a class the ministry has not
              got round to — gets one.
            */}
            {primaryKindergartenId ? (
              <EsisRosterImportButton kindergartenId={primaryKindergartenId} />
            ) : null}
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={18} />
              Бүлэг нэмэх
            </Button>
          </>
        }
      />

      <Tabs label="Харагдац">
        <TabButton active={tab === "groups"} onClick={() => setTab("groups")}>
          Бүлгүүд
        </TabButton>
        <TabButton active={tab === "esis"} onClick={() => setTab("esis")}>
          ЭСИС мэдээлэл
        </TabButton>
      </Tabs>

      {tab === "esis" ? (
        <EsisReference />
      ) : (
        <>
          {groups.isLoading ? <LoadingState rows={3} /> : null}
          {groups.isError ? <ErrorState description={errorMessage(groups.error)} /> : null}

          {groups.data && items.length === 0 ? (
            <EmptyState
              title="Бүлэг байхгүй байна"
              description="Хүүхэд бүртгэхийн өмнө бүлэг үүсгэх шаардлагатай. ЭСИС-ээс татах эсвэл гараар үүсгэнэ үү."
            />
          ) : null}

          {items.length > 0 ? <GroupGrid groups={items} onManageTeachers={setManaging} /> : null}
        </>
      )}

      {managing ? (
        <ManageTeachersDialog
          groupId={managing.id}
          groupName={groupLabel(managing.name)}
          onClose={() => setManaging(null)}
        />
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

/**
 * The ministry's own group tables, for reconciliation.
 *
 * ★ `instructorId` and `instructorName` are why these are on this screen at
 * all: assigning a teacher to a group is a decision ESIS records too, and
 * whether the two registers agree is a director's question. The local answer
 * is the card's teacher block; the ministry's is these columns.
 *
 * ★★ `groupsNextYear` (API-000113) is the read the ahead-of-time question
 * needs. There is no group *write* service in the ministry's catalog for it,
 * so nothing was invented to pair with it.
 */
function EsisReference() {
  return (
    <div className="flex flex-col gap-6">
      <EsisDataPanel
        resource="groups"
        title="Бүлгүүд"
        description="Бүлэг, түвшин, хөтөлбөр — мөн ЭСИС-д бүртгэлтэй бүлгийн багш"
      />
      <EsisDataPanel
        resource="groupsNextYear"
        title="Дараа жилийн бүлэг"
        description="Дараагийн хичээлийн жилд бүлэг хэрхэн бүрэлдэхийг ЭСИС-ээс харах"
      />
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
  const current = (years.data ?? []).find((year) => year.isCurrent) ?? years.data?.[0];
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
  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Бүлэг нэмэх"
      {...backdrop}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-[420px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
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
                onChange={(event) => setName(event.target.value)}
                placeholder="Дунд бүлэг"
                autoFocus
              />
            )}
          </Field>

          <Field label="Насны ангилал" error={errors.ageBand} required>
            {({ id }) => (
              <Select id={id} value={ageBand} onChange={(event) => setAgeBand(event.target.value)}>
                {AGE_BANDS.map((band) => (
                  <option key={band.value} value={band.value}>
                    {band.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Сургалтын төрөл" error={errors.programKind} required>
            {({ id }) => (
              <Select
                id={id}
                value={programKind}
                onChange={(event) => setProgramKind(event.target.value)}
              >
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
                onChange={(event) => setAttendanceForm(event.target.value)}
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
                onChange={(event) => setSchoolYearId(event.target.value)}
              >
                {(years.data ?? []).map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                    {year.isCurrent ? " (одоогийн)" : ""}
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
