"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ClipboardList,
  HeartHandshake,
  Plus,
  ShieldAlert,
  Syringe,
  Trash2,
} from "lucide-react";
import { z } from "zod";
import {
  ALLERGY_KIND_LABEL,
  ALLERGY_SEVERITY_LABEL,
  childHealthSchema,
  specialNeedsCategorySchema,
  type Allergy,
  type SpecialNeed,
  type Vaccination,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { formatDate, capitalize } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";

/** The picker's list — an array, not a page: the reference table is small and
 * the endpoint returns it whole. */
const specialNeedsCategoryListSchema = z.array(specialNeedsCategorySchema);

/**
 * A child's health record — RFP Module 2.
 *
 * ★ Each section has its author.
 *
 * An **allergy** and a **special need** are instructions other people act on,
 * so staff record them and a family reads them. A **vaccination** is the
 * kindergarten's register. The UI shows each control only to whoever may use
 * it — a button that always 404s teaches people the app is broken. (Medication
 * consent, the family's own section, was taken off this screen on 2026-10-01
 * at the client's instruction; its API is unchanged.)
 */
export function ChildHealth({
  childId,
  isStaff,
}: {
  childId: string;
  isStaff: boolean;
  /** Kept for the call sites; the tab no longer groups by school year. */
  dateOfBirth?: string;
  currentSchoolYear?: string | null;
}) {
  const health = useQuery({
    queryKey: qk.health(childId),
    queryFn: () => get(`/children/${childId}/health`, childHealthSchema),
  });

  if (health.isPending) return <LoadingState rows={4} />;
  if (health.isError) return <ErrorState description={errorMessage(health.error)} />;

  const { allergies, vaccinations, specialNeeds, healthNotes } = health.data;
  const liveAllergies = allergies.filter((allergy) => !allergy.endedOn);
  const liveNeeds = specialNeeds.filter((need) => !need.endedOn);
  const shots = [...vaccinations].sort((a, b) => b.administeredOn.localeCompare(a.administeredOn));

  /*
    ★ By kind, not by school year — 2026-10-01, at the client's request that
    this tab be tidier and take less room.

    It was a summary card whose rows only scrolled down, then the record split
    into one fold per school year, each with folds of its own. An allergy
    noted in 2024 that is still live sat in "2024–2025", a vaccination was in
    no summary at all, and reading last year took three presses. Now: what to
    watch for first, then one short section per kind, each with its own add.

    Removed with it, at the client's instruction: medication consent (the
    records stay in the API; this screen no longer shows or takes them), and
    the "Архаг өвчин" row, which always read "Бүртгэлгүй" because nothing
    stores a chronic illness — a reassurance with no data behind it.
  */
  return (
    <div className="flex flex-col gap-5">
      {liveAllergies.length > 0 || liveNeeds.length > 0 ? (
        <section
          aria-label="Анхаарах"
          className="flex flex-wrap items-center gap-2 rounded-card border border-peach bg-peach/30 px-4 py-3"
        >
          <span className="inline-flex items-center gap-1.5 text-body font-semibold text-ink">
            <AlertTriangle size={18} aria-hidden="true" className="text-peach-ink" />
            Анхаарах:
          </span>
          {liveAllergies.map((allergy) => (
            <Badge key={allergy.id} tone="sun">
              {allergy.allergen}
            </Badge>
          ))}
          {liveNeeds.map((need) => (
            <Badge key={need.id} tone="sky">
              {capitalize(need.category.name)}
            </Badge>
          ))}
        </section>
      ) : null}

      <HealthSection
        id="health-allergies"
        icon={<ShieldAlert aria-hidden="true" />}
        title="Харшил"
        count={liveAllergies.length}
        empty="Бүртгэгдсэн харшил алга"
        add={isStaff ? <AllergyForm childId={childId} /> : null}
        columns={["Харшил", "Төрөл", "Шинж тэмдэг", "Авах арга хэмжээ"]}
        actions={isStaff}
        rows={liveAllergies.length}
      >
        {liveAllergies.map((allergy) => (
          <AllergyRow key={allergy.id} childId={childId} allergy={allergy} canEdit={isStaff} />
        ))}
      </HealthSection>

      <HealthSection
        id="health-special-needs"
        icon={<HeartHandshake aria-hidden="true" />}
        title="Тусгай хэрэгцээ"
        count={liveNeeds.length}
        empty="Бүртгэгдсэн тусгай хэрэгцээ алга"
        add={isStaff ? <SpecialNeedForm childId={childId} /> : null}
        columns={["Ангилал", "Шаардлагатай дэмжлэг", "Шийдвэрийн дугаар", "Тогтоосон огноо"]}
        actions={isStaff}
        rows={liveNeeds.length}
      >
        {liveNeeds.map((need) => (
          <SpecialNeedRow key={need.id} childId={childId} need={need} canEdit={isStaff} />
        ))}
      </HealthSection>

      <HealthSection
        id="health-vaccinations"
        icon={<Syringe aria-hidden="true" />}
        title="Вакцин"
        count={shots.length}
        empty="Бүртгэгдсэн вакцин алга"
        add={isStaff ? <VaccinationForm childId={childId} /> : null}
        columns={["Вакцин", "Тун", "Хийлгэсэн огноо"]}
        actions={isStaff}
        rows={shots.length}
      >
        {shots.map((vaccination) => (
          <VaccinationRow
            key={vaccination.id}
            childId={childId}
            vaccination={vaccination}
            canDelete={isStaff}
          />
        ))}
      </HealthSection>

      {healthNotes ? (
        <section aria-labelledby="health-notes-heading" className="flex flex-col gap-2">
          <h2
            id="health-notes-heading"
            className="flex items-center gap-2 text-title font-semibold text-ink [&_svg]:size-5 [&_svg]:text-muted"
          >
            <ClipboardList aria-hidden="true" />
            Анхаарах заавар
          </h2>
          <Card pad="compact" className="border-l-4 border-l-peach">
            <p className="whitespace-pre-wrap text-body text-ink">{healthNotes}</p>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

/**
 * One kind of record, drawn like the other tabs: a heading with its count and
 * its add button, then a table — live rows first, ended ones after them,
 * greyed and marked "Дууссан". One line says when there are none.
 */
function HealthSection({
  id,
  icon,
  title,
  count,
  empty,
  add,
  columns,
  actions,
  rows,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  /** Live records — the number beside the heading. */
  count: number;
  empty: string;
  add?: ReactNode;
  columns: string[];
  /** Whether the rows carry an action cell. */
  actions: boolean;
  /** Every row, live and ended — whether to draw the table at all. */
  rows: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2
          id={`${id}-heading`}
          className="flex items-center gap-2 text-title font-semibold text-ink [&_svg]:size-5 [&_svg]:text-muted"
        >
          {icon}
          {title}
          {count > 0 ? (
            <span className="text-body font-normal tabular-nums text-muted">({count})</span>
          ) : null}
        </h2>
        {add}
      </div>
      {rows > 0 ? (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-body">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="bg-sunken text-left text-caption font-semibold text-muted">
                {columns.map((column) => (
                  <th key={column} className="px-3 py-2">
                    {column}
                  </th>
                ))}
                {actions ? (
                  <th className="px-3 py-2">
                    <span className="sr-only">Үйлдэл</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      ) : (
        <p className="text-body text-muted">{empty}</p>
      )}
    </section>
  );
}

function VaccinationRow({
  childId,
  vaccination,
  canDelete,
}: {
  childId: string;
  vaccination: Vaccination;
  canDelete: boolean;
}) {
  return (
    <tr className="border-t border-border-soft">
      <td className="px-3 py-2 font-medium text-ink">{vaccination.vaccineName}</td>
      <td className="whitespace-nowrap px-3 py-2">{vaccination.doseLabel || "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
        {formatDate(vaccination.administeredOn)}
      </td>
      {canDelete ? (
        <td className="px-2 py-1 text-right">
          <DeleteHealthRecord
            childId={childId}
            path={`/vaccinations/${vaccination.id}`}
            recordLabel={vaccination.vaccineName}
            title="Вакцины бүртгэлийг устгах"
            description={`"${vaccination.vaccineName}" — буруу бүртгэсэн бол устгана.`}
          />
        </td>
      ) : null}
    </tr>
  );
}

function localDateInputValue(date = new Date()) {
  const localTime = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTime).toISOString().slice(0, 10);
}

/**
 * Removing a health record.
 *
 * ★ The only control on a row since 2026-10-01. The screen used to offer
 * "Дуусгах" (`PATCH { endedOn }`) beside it — ended, not deleted, so a child
 * who outgrew an allergy kept it as history — and the client found the pair
 * confusing and asked for one action. The API still supports ending; records
 * ended earlier are simply not listed here. A deleted allergy also stops
 * `menu/with-warnings` warning the kitchen, which is what an outgrown one
 * needs.
 *
 * ★★ It is a soft delete, like everything in this product — the service sets
 * `deletedAt` and appends a `DELETE` audit row naming the actor (CLAUDE.md
 * §3.2). Nothing is destroyed; it stops being served.
 */
function DeleteHealthRecord({
  childId,
  path,
  recordLabel,
  title,
  description,
}: {
  childId: string;
  /** API path without `/v1` — `/allergies/:id`, `/medications/:id`, … */
  path: string;
  /** Names the row in the success toast. */
  recordLabel: string;
  title: string;
  description: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const remove = useMutation({
    mutationFn: () => mutate(path, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      // The row disappears on refetch — `qk.health` is what the whole tab
      // reads, and the child's header badge reads the same key.
      void queryClient.invalidateQueries({ queryKey: qk.health(childId) });
      toast.success(`${recordLabel} — устгагдлаа.`);
    },
  });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <ConfirmDialog
        title={title}
        description={description}
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            aria-label={`${recordLabel} — устгах`}
            className="text-muted hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 size={16} aria-hidden="true" />
          </Button>
        }
      />

      {/*
        Inline, not a toast — the same rule `archive-button.tsx` follows. The
        likely failure here is a 404 for a record somebody else already removed,
        and that message explains a row that is about to vanish anyway; it must
        not disappear on a timer before it is read.
      */}
      {remove.isError ? (
        <span role="alert" className="max-w-[260px] text-right text-caption text-danger">
          {errorMessage(remove.error)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * One allergy, as a table row. Only "Устгах": an allergy is either on the
 * record or removed from it (2026-10-01, at the client's instruction —
 * "Дуусгах" and the Төлөв column read as noise).
 */
function AllergyRow({
  childId,
  allergy,
  canEdit,
}: {
  childId: string;
  allergy: Allergy;
  canEdit: boolean;
}) {
  return (
    <tr className="border-t border-border-soft">
      <td className="px-3 py-2 font-medium text-ink">{allergy.allergen}</td>
      <td className="whitespace-nowrap px-3 py-2">{ALLERGY_KIND_LABEL[allergy.kind]}</td>
      <td className="px-3 py-2">{allergy.reaction || "—"}</td>
      <td className="px-3 py-2">{allergy.treatment || "—"}</td>
      {canEdit ? (
        <td className="px-2 py-1 text-right">
          <DeleteHealthRecord
            childId={childId}
            path={`/allergies/${allergy.id}`}
            recordLabel={allergy.allergen}
            title="Харшлын бүртгэлийг устгах"
            description={`"${allergy.allergen}" — харшлын бүртгэлийг устгах уу?`}
          />
        </td>
      ) : null}
    </tr>
  );
}

function SpecialNeedRow({
  childId,
  need,
  canEdit,
}: {
  childId: string;
  need: SpecialNeed;
  canEdit: boolean;
}) {
  return (
    <tr className="border-t border-border-soft">
      <td className="px-3 py-2 font-medium text-ink">{capitalize(need.category.name)}</td>
      <td className="whitespace-pre-wrap px-3 py-2">{need.note || "—"}</td>
      <td className="whitespace-nowrap px-3 py-2">{need.documentNo || "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDate(need.assessedOn)}</td>
      {canEdit ? (
        <td className="px-2 py-1 text-right">
          <DeleteHealthRecord
            childId={childId}
            path={`/special-needs/${need.id}`}
            recordLabel={capitalize(need.category.name)}
            title="Тусгай хэрэгцээний бүртгэлийг устгах"
            description={`"${need.category.name}" — бүртгэлийг устгах уу?`}
          />
        </td>
      ) : null}
    </tr>
  );
}

function SpecialNeedForm({ childId }: { childId: string }) {
  const queryClient = useQueryClient();
  const today = localDateInputValue();
  const formId = useId();

  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [documentNo, setDocumentNo] = useState("");
  const [assessedOn, setAssessedOn] = useState(today);

  /*
   * ★ Fetched only once the form is open.
   *
   * The categories are a picker's worth of rows behind the same 404 the rest
   * of this tab is behind, and a guardian never opens this form at all — so
   * requesting them on every health-tab render would be a request most readers
   * have no use for.
   */
  const categories = useQuery({
    queryKey: qk.specialNeedsCategories(childId),
    queryFn: () =>
      get(`/children/${childId}/health/special-needs/categories`, specialNeedsCategoryListSchema),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/health/special-needs`, z.unknown(), {
        method: "POST",
        body: {
          categoryId,
          note: note.trim() || null,
          documentNo: documentNo.trim() || null,
          assessedOn,
        },
      }),
    onSuccess: () => {
      setCategoryId("");
      setNote("");
      setDocumentNo("");
      setAssessedOn(today);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: qk.health(childId) });
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Тусгай хэрэгцээ нэмэх
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Тусгай хэрэгцээ нэмэх"
        description="Хүүхдэд хэрэгтэй дэмжлэг болон албан ёсны шийдвэрийн мэдээллийг бүртгэнэ."
        busy={save.isPending}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Болих
            </Button>
            <Button type="submit" form={formId} disabled={save.isPending || !categoryId}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending && categoryId) save.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError
            message={
              save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
            }
          />

          <Field label="Ангилал" error={errors.categoryId} required>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={categoryId}
                disabled={categories.isPending}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">
                  {categories.isPending ? "Ачаалж байна…" : "— Сонгоно уу —"}
                </option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {capitalize(category.name)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Шаардлагатай дэмжлэг" error={errors.note}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                rows={3}
                aria-describedby={describedBy}
                invalid={invalid}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>

          <Field label="Шийдвэрийн дугаар" error={errors.documentNo}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={documentNo}
                onChange={(event) => setDocumentNo(event.target.value)}
              />
            )}
          </Field>

          <Field label="Тогтоосон огноо" error={errors.assessedOn} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                max={today}
                aria-describedby={describedBy}
                invalid={invalid}
                value={assessedOn}
                onChange={(event) => setAssessedOn(event.target.value)}
              />
            )}
          </Field>
        </form>
      </FormDialog>
    </>
  );
}

function AllergyForm({ childId }: { childId: string }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const today = localDateInputValue();

  const [open, setOpen] = useState(false);
  const [allergen, setAllergen] = useState("");
  const [kind, setKind] = useState("FOOD");
  const [severity, setSeverity] = useState("MODERATE");
  const [reaction, setReaction] = useState("");
  const [treatment, setTreatment] = useState("");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/health/allergies`, z.unknown(), {
        method: "POST",
        body: {
          allergen: allergen.trim(),
          kind,
          severity,
          reaction: reaction.trim() || null,
          treatment: treatment.trim() || null,
          notedOn: today,
        },
      }),
    onSuccess: () => {
      setAllergen("");
      setReaction("");
      setTreatment("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: qk.health(childId) });
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Харшил нэмэх
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Харшил нэмэх"
        description="Хүүхдийн харшил, шинж тэмдэг, авах арга хэмжээг бүртгэнэ."
        busy={save.isPending}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Болих
            </Button>
            <Button type="submit" form={formId} disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError
            message={
              save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
            }
          />

          <Field label="Харшил" error={errors.allergen} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={allergen}
                onChange={(e) => setAllergen(e.target.value)}
              />
            )}
          </Field>

          <Field label="Төрөл" error={errors.kind}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {Object.entries(ALLERGY_KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Шинж тэмдэг" error={errors.reaction}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={2}
                value={reaction}
                onChange={(e) => setReaction(e.target.value)}
              />
            )}
          </Field>

          <Field label="Авах арга хэмжээ" error={errors.treatment}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={2}
                value={treatment}
                onChange={(e) => setTreatment(e.target.value)}
              />
            )}
          </Field>

          <Field label="Хүндрэл" error={errors.severity}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                {Object.entries(ALLERGY_SEVERITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
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

function VaccinationForm({ childId }: { childId: string }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const today = localDateInputValue();

  const [open, setOpen] = useState(false);
  const [vaccineName, setVaccineName] = useState("");
  const [administeredOn, setAdministeredOn] = useState(today);
  const [doseLabel, setDoseLabel] = useState("");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/health/vaccinations`, z.unknown(), {
        method: "POST",
        body: {
          vaccineName: vaccineName.trim(),
          administeredOn,
          doseLabel: doseLabel.trim() || null,
        },
      }),
    onSuccess: () => {
      setVaccineName("");
      setDoseLabel("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: qk.health(childId) });
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Вакцин нэмэх
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Вакцин нэмэх"
        description="Хийлгэсэн вакцин, огноо, тунг бүртгэнэ."
        busy={save.isPending}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Болих
            </Button>
            <Button type="submit" form={formId} disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError
            message={
              save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
            }
          />

          <Field label="Вакцин" error={errors.vaccineName} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={vaccineName}
                onChange={(e) => setVaccineName(e.target.value)}
              />
            )}
          </Field>

          <Field label="Тун" error={errors.doseLabel}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                placeholder="2-р тун"
                value={doseLabel}
                onChange={(e) => setDoseLabel(e.target.value)}
              />
            )}
          </Field>

          <Field label="Хийлгэсэн огноо" error={errors.administeredOn} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                max={today}
                aria-describedby={describedBy}
                invalid={invalid}
                value={administeredOn}
                onChange={(e) => setAdministeredOn(e.target.value)}
              />
            )}
          </Field>
        </form>
      </FormDialog>
    </>
  );
}
