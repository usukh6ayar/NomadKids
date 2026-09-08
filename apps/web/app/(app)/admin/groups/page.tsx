"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { z } from "zod";
import {
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
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

/** The promote dialog's roster — the group's own children, to pick from. */
const yearsSchema = z.array(schoolYearSchema);

const AGE_BANDS = [
  { value: "NURSERY", label: "Бага бүлэг" },
  { value: "JUNIOR", label: "Дунд бүлэг" },
  { value: "MIDDLE", label: "Ахлах бүлэг" },
  { value: "SENIOR", label: "Бэлтгэл бүлэг" },
] as const;

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

      {/*
        ★ The groups, from ESIS — 2026-09-08, at the client's instruction,
        given twice with the consequence written out first.

        The local list and its summary are gone, and with them every row
        control that had no other home: assigning a teacher, promoting to the
        next year, editing, archiving. Their endpoints still exist and still
        work; nothing in this product calls them any more. "Бүлэг нэмэх" still
        creates a local group, and the rest of the product still reads it.

        ESIS carries the teacher assignment too — `instructorId` and
        `instructorName` — so the column the "Багш" dialog used to set is still
        on the screen, as the ministry's answer rather than as ours.
      */}
      <EsisDataPanel
        resource="groups"
        title="Бүлгүүд"
        description="Бүлэг, түвшин, хөтөлбөр, бүлгийн багш"
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
