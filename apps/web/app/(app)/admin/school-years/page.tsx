"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Plus, Star } from "lucide-react";
import { z } from "zod";
import { schoolYearSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

const listSchema = z.array(schoolYearSchema);

/** Every mutation on this screen refetches the same list. */
const YEARS_KEY = ["admin", "school-years"] as const;

/**
 * School years.
 *
 * ★ The first thing that has to exist.
 *
 * A group belongs to a school year and an enrolment belongs to both, so nothing
 * else in the product can be created until one is here — which is why this
 * screen is at the top of the admin list even though it is used twice a year.
 *
 * ★★ What "Одоогийн" actually is, since the UI must not invent a second one.
 *
 * `SchoolYear.isCurrent` is a flag on the row, held to one `true` per
 * kindergarten by a partial unique index
 * (`school_years_one_current_per_kindergarten`). What reads it is narrower than
 * this file used to claim: `/admin/terms` picks it as the year whose terms it
 * shows, and `/admin/groups` defaults a new group to it. The dashboard does
 * *not* — it resolves "this term" from `Term.startsOn`/`endsOn` against today's
 * date, so it is unaffected by which year carries the flag.
 *
 * So the flag is the administrator's default selection, and moving it is
 * reversible by moving it back. It is promoted from the row rather than edited
 * in the form for two reasons: the API demotes the previous holder in the same
 * transaction, which is a change to a *different* row than the one being
 * edited; and `PATCH { isCurrent: false }` is accepted by the DTO and would
 * leave the kindergarten with no current year at all, which no screen here has
 * a use for. The UI only ever sends `true`.
 */
export default function AdminSchoolYearsPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminSchoolYears />
    </RequireRole>
  );
}

function AdminSchoolYears() {
  const { primaryKindergartenId } = useSession();
  const [creating, setCreating] = useState(false);

  const years = useQuery({
    queryKey: qk.adminSchoolYears(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/school-years`, listSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const items = years.data ?? [];

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Хичээлийн жил"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={18} />
            Жил нэмэх
          </Button>
        }
      />

      {years.isLoading ? <LoadingState rows={2} /> : null}
      {years.isError ? <ErrorState description={errorMessage(years.error)} /> : null}

      {years.data && items.length === 0 ? (
        <EmptyState
          title="Хичээлийн жил байхгүй"
          description="Эндээс эхэлнэ — үүнгүйгээр бүлэг үүсгэх боломжгүй."
        />
      ) : null}

      {items.length > 0 ? (
        <DataList columns={YEAR_COLUMNS} leadWidth={null} actionsWidth="w-[280px]">
          {items.map((year) => (
            <YearRow key={year.id} year={year} />
          ))}
        </DataList>
      ) : null}

      {/*
        ★ The ministry's own academic years, beside the local ones.

        "Жил нэмэх" writes a local year, and the value that matters about it is
        whether its dates match ESIS's — a year opened a week early puts every
        enrolment in it out of step with the register the ministry keeps. So
        the panel names the ESIS year, its open and close dates and which one
        is current, on the screen where the local year is created.
      */}
      <EsisDataPanel
        resource="academicYearStatuses"
        description="ESIS-ийн хичээлийн жил, нээсэн ба хаасан огноо"
      />

      {creating && primaryKindergartenId ? (
        <CreateYearDialog
          kindergartenId={primaryKindergartenId}
          onClose={() => setCreating(false)}
          hasAny={items.length > 0}
        />
      ) : null}
    </div>
  );
}

type SchoolYear = z.infer<typeof schoolYearSchema>;

/**
 * The list's columns. `Одоогийн болгох` is the widest action and only appears
 * on years that are not current, so the gutter is sized for the row that has
 * both controls rather than for the one that has one.
 */
const YEAR_COLUMNS = [
  { key: "startsOn", label: "Эхлэх", className: "md:w-[112px]" },
  { key: "endsOn", label: "Дуусах", className: "md:w-[112px]" },
];

/** `2026-09-01T00:00:00.000Z` → `2026-09-01`, which is all `<input type="date">` takes. */
function dateValue(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

function YearRow({ year }: { year: SchoolYear }) {
  return (
    <DataRow
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate">{year.name}</span>
          {year.isCurrent ? <Badge tone="mint">Одоогийн</Badge> : null}
        </span>
      }
      cells={{
        /*
          ★ `formatDate`, and one column each.

          The two dates were joined with an em dash into a caption under the
          name, in `dateValue`'s output — which is `2026-09-01`, the format
          `<input type="date">` requires and nothing a person reads. That
          helper exists to feed the edit form's inputs; it had been borrowed to
          render display text, so the product's own `2026.09.01` never reached
          this screen. Two columns also let a director compare the start of one
          year with the start of the next by looking down rather than across.
        */
        startsOn: (
          <span className="text-body tabular-nums text-ink">{formatDate(year.startsOn)}</span>
        ),
        endsOn: (
          <span className="text-body tabular-nums text-muted">{formatDate(year.endsOn)}</span>
        ),
      }}
      actions={
        <>
          {year.isCurrent ? null : <MakeCurrentButton year={year} />}
          <EditYearButton year={year} />
        </>
      }
    />
  );
}

/**
 * Editing a school year — `PATCH /school-years/:id`.
 *
 * ★ The fields are what `updateSchoolYearSchema` accepts, minus `isCurrent`.
 *
 * The DTO takes `name`, `startsOn`, `endsOn` and `isCurrent`, all optional. The
 * flag is left out here and promoted from the row instead — see the note at the
 * top of the file. Nothing else about a year is editable: `kindergartenId` is
 * absent from the DTO, so a year cannot be moved between kindergartens, and
 * that is a backend constraint rather than an omission on this screen.
 *
 * ★★ `endsOn > startsOn` is NOT re-checked here.
 *
 * `updateSchoolYearSchema` refines it with a Mongolian message at
 * `path: ["endsOn"]`, so it arrives as a field error and lands under the right
 * input. Restating the rule in the browser is the drift `ZodValidationPipe`
 * exists to prevent. What is checked locally is only the empty case — zod's
 * `coerce.date()` rejects `""` with its own English "Invalid date", and the
 * product does not show English to an administrator.
 */
function EditYearButton({ year }: { year: SchoolYear }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(year.name);
  const [startsOn, setStartsOn] = useState(dateValue(year.startsOn));
  const [endsOn, setEndsOn] = useState(dateValue(year.endsOn));
  const [local, setLocal] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      mutate(`/school-years/${year.id}`, schoolYearSchema, {
        method: "PATCH",
        body: { name: name.trim(), startsOn, endsOn },
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: YEARS_KEY });
      toast.success(`${updated.name} — хадгалагдлаа.`);
      // Only now: a failed save has to leave the form up with what was typed.
      setOpen(false);
    },
  });

  /*
    One source at a time, not a merge of both.
    ★ Merged, the previous attempt's server errors outlive the request that
    produced them: a 400 on `endsOn`, then the user empties the name and
    submits, and the dialog shows a stale date complaint beside the new one
    about a date nobody touched. The local check runs first and, while it has
    anything to say, it is all the form says.
  */
  const errors = Object.keys(local).length > 0 ? local : fieldErrors(save.error);

  function submit() {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Хичээлийн жилийн нэрийг оруулна уу";
    if (!startsOn) next.startsOn = "Эхлэх огноог сонгоно уу";
    if (!endsOn) next.endsOn = "Дуусах огноог сонгоно уу";

    // Clears the last response too, so its whole-form banner goes with it.
    save.reset();
    setLocal(next);
    if (Object.keys(next).length > 0) return;
    save.mutate();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${year.name} — засах`}
        onClick={() => {
          // Re-seeded on open: the list refetches while this is closed, and a
          // form still holding its mount-time values would write them back.
          setName(year.name);
          setStartsOn(dateValue(year.startsOn));
          setEndsOn(dateValue(year.endsOn));
          setLocal({});
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
        title="Хичээлийн жил засах"
        description={year.isCurrent ? "Одоогийн хичээлийн жил." : undefined}
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
            <Button type="submit" form="edit-year-form" size="sm" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id="edit-year-form"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) submit();
          }}
        >
          {/*
            The whole-form message only when the failure has no field of its
            own — the 409 for a duplicate name, a 404, a 500. A 400 with
            `errors` is already shown under the input it belongs to.
          */}
          <FormError
            message={
              save.isError && Object.keys(fieldErrors(save.error)).length === 0
                ? errorMessage(save.error)
                : null
            }
          />

          <Field label="Нэр" error={errors.name} hint="Жишээ: 2026-2027" required>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Эхлэх" error={errors.startsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              )}
            </Field>
            <Field label="Дуусах" error={errors.endsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              )}
            </Field>
          </div>
        </form>
      </FormDialog>
    </>
  );
}

/**
 * Moving the "Одоогийн" flag — `PATCH /school-years/:id { isCurrent: true }`.
 *
 * ★ One press, no confirmation, and it only ever appears on a year that is not
 * already current.
 *
 * The server does the exclusion: `updateSchoolYear` clears the previous holder
 * and sets this one inside a single transaction, because the partial unique
 * index would reject two `true` rows. So this sends one field and re-reads the
 * list rather than moving a badge locally — the row that stops being current is
 * a different row, and only the refetch knows which.
 *
 * No prompt, for the reason `/admin/groups` gives for archiving: it is a
 * reversible flag, and the way back is to promote the other year. A failure
 * stays on the row instead of passing in a toast.
 */
function MakeCurrentButton({ year }: { year: SchoolYear }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const promote = useMutation({
    mutationFn: () =>
      mutate(`/school-years/${year.id}`, schoolYearSchema, {
        method: "PATCH",
        body: { isCurrent: true },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: YEARS_KEY });
      toast.success(`${year.name} — одоогийн хичээлийн жил боллоо.`);
    },
  });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={promote.isPending}
        aria-label={`${year.name} — одоогийн болгох`}
        onClick={() => promote.mutate()}
      >
        <Star size={16} aria-hidden="true" />
        {promote.isPending ? "Тохируулж байна…" : "Одоогийн болгох"}
      </Button>

      {promote.isError ? (
        <span role="alert" className="max-w-[260px] text-right text-caption text-danger">
          {errorMessage(promote.error)}
        </span>
      ) : null}
    </span>
  );
}

function CreateYearDialog({
  kindergartenId,
  onClose,
  hasAny,
}: {
  kindergartenId: string;
  onClose: () => void;
  hasAny: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  // The first year a kindergarten creates is almost certainly the one it is in.
  const [isCurrent, setIsCurrent] = useState(!hasAny);

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/school-years`, z.unknown(), {
        method: "POST",
        body: { name, startsOn, endsOn, isCurrent },
      }),
    onSuccess: () => {
      toast.success("Хичээлийн жил үүслээ.");
      void queryClient.invalidateQueries({ queryKey: YEARS_KEY });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(create.error);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Хичээлийн жил нэмэх"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-[420px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <h2 className="text-title font-semibold text-ink">Хичээлийн жил нэмэх</h2>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <Field label="Нэр" error={errors.name} hint="Жишээ: 2026-2027" required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="2026-2027"
                autoFocus
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Эхлэх" error={errors.startsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              )}
            </Field>
            <Field label="Дуусах" error={errors.endsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Checkbox
            label="Одоогийн жил болгох"
            description="Самбар, үнэлгээ, тайлан энэ жилийг уншина."
            checked={isCurrent}
            onChange={(e) => setIsCurrent(e.target.checked)}
          />

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={create.isPending}>
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
