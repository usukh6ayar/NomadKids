"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import {
  Accessibility,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  HeartHandshake,
  Pill,
  Plus,
  ShieldAlert,
  Stethoscope,
  Syringe,
  Trash2,
} from "lucide-react";
import { z } from "zod";
import {
  ALLERGY_KIND_LABEL,
  ALLERGY_SEVERITY_LABEL,
  ageInMonths,
  childHealthSchema,
  specialNeedsCategorySchema,
  type Allergy,
  type ChildHealth as ChildHealthData,
  type Medication,
  type SpecialNeed,
  type Vaccination,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/auth/session";

/** The picker's list — an array, not a page: the reference table is small and
 * the endpoint returns it whole. */
const specialNeedsCategoryListSchema = z.array(specialNeedsCategorySchema);

type HealthHistoryRecord =
  | { kind: "ALLERGY"; date: string; allergy: Allergy }
  | { kind: "SPECIAL_NEED"; date: string; need: SpecialNeed }
  | { kind: "MEDICATION"; date: string; medication: Medication }
  | { kind: "VACCINATION"; date: string; vaccination: Vaccination };

interface HealthHistoryYear {
  startYear: number;
  label: string;
  age: number | null;
  records: HealthHistoryRecord[];
}

/**
 * A child's health record — RFP Module 2.
 *
 * ★ Three sections, three different authors.
 *
 * An **allergy** is an instruction other people act on, so staff record it and
 * a family reads it. A **medication authorisation** is the family's consent, so
 * the form is theirs. A **vaccination** is the kindergarten's register. The UI
 * shows each control only to whoever may use it — a button that always 404s
 * teaches people the app is broken.
 */
export function ChildHealth({
  childId,
  isStaff,
  dateOfBirth,
  currentSchoolYear,
}: {
  childId: string;
  isStaff: boolean;
  dateOfBirth?: string;
  currentSchoolYear?: string | null;
}) {
  /*
   * ★ Only for the medication rule.
   *
   * `removeMedication` 404s a guardian who did not authorise the row, so the
   * screen needs to know which parent is looking in order not to offer a
   * control that always fails. Nothing else here branches on identity — the
   * other two sections branch on `isStaff`.
   */
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);

  const health = useQuery({
    queryKey: qk.health(childId),
    queryFn: () => get(`/children/${childId}/health`, childHealthSchema),
  });

  if (health.isPending) return <LoadingState rows={4} />;
  if (health.isError) return <ErrorState description={errorMessage(health.error)} />;

  const { allergies, medications, specialNeeds, healthNotes } = health.data;
  const live = allergies.filter((allergy) => !allergy.endedOn);
  const liveNeeds = specialNeeds.filter((need) => !need.endedOn);
  const activeMedications = medications.filter((medication) => medication.isActive);
  const currentStartYear =
    schoolYearStart(currentSchoolYear) ?? academicYearStartForDate(localDateInputValue());
  const years = buildHealthHistoryYears(health.data, currentStartYear, dateOfBirth);

  const allergySummary = live.length > 0 ? live.map((item) => item.allergen).join(", ") : null;
  const medicationSummary = activeMedications.length
    ? `${activeMedications.length} идэвхтэй · ${shortDate(
        [...activeMedications].sort((a, b) => a.endsOn.localeCompare(b.endsOn))[0]!.endsOn,
      )} хүртэл`
    : null;

  return (
    <div className="flex flex-col gap-7">
      <section aria-labelledby="health-heading">
        <SectionHeader
          id="health-heading"
          title="Эрүүл мэнд"
          lede="Одоогийн идэвхтэй мэдээлэл"
          action={
            <Button
              size="sm"
              aria-expanded={quickAddOpen}
              aria-controls="health-quick-add"
              onClick={() => setQuickAddOpen((value) => !value)}
            >
              <Plus aria-hidden="true" />
              Мэдээлэл нэмэх
            </Button>
          }
        />

        {quickAddOpen ? (
          <Card id="health-quick-add" pad="roomy" className="mb-4 flex flex-col gap-4">
            <div>
              <h3 className="font-semibold text-ink">Шинэ бүртгэлийн төрөл</h3>
              <p className="mt-1 text-body text-muted">
                Нэмэх мэдээллийн төрлийг сонгоод маягтыг бөглөнө үү.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isStaff ? <AllergyForm childId={childId} /> : null}
              <MedicationForm childId={childId} />
              {isStaff ? <VaccinationForm childId={childId} /> : null}
            </div>
          </Card>
        ) : null}

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-primary-soft px-4 py-4 md:px-6">
            <h3 className="text-lead font-semibold text-ink">Одоогийн мэдээлэл</h3>
            {years.current.age !== null ? <Badge tone="sky">{years.current.age} нас</Badge> : null}
          </div>
          <div className="divide-y divide-border">
            <HealthStatusRow
              icon={<ShieldAlert aria-hidden="true" />}
              label="Харшил"
              value={allergySummary ?? "Бүртгэлгүй"}
              active={Boolean(allergySummary)}
              action={
                <StatusAction
                  label={allergySummary ? "Харшлын түүх рүү очих" : "Харшил нэмэх"}
                  hasValue={Boolean(allergySummary)}
                  canAdd={isStaff}
                  onClick={() =>
                    allergySummary
                      ? scrollToHealthHistory()
                      : isStaff
                        ? setQuickAddOpen(true)
                        : undefined
                  }
                />
              }
            />
            <HealthStatusRow
              icon={<HeartHandshake aria-hidden="true" />}
              label="Тусгай хэрэгцээ"
              value={liveNeeds.length > 0 ? `${liveNeeds.length} бүртгэл` : "Бүртгэлгүй"}
              active={liveNeeds.length > 0}
              action={
                isStaff ? (
                  <SpecialNeedForm childId={childId} compact />
                ) : liveNeeds.length > 0 ? (
                  <StatusAction
                    label="Тусгай хэрэгцээний түүх рүү очих"
                    hasValue
                    onClick={scrollToHealthHistory}
                  />
                ) : null
              }
            />
            <HealthStatusRow
              icon={<Stethoscope aria-hidden="true" />}
              label="Архаг өвчин"
              value="Бүртгэлгүй"
              active={false}
            />
            <HealthStatusRow
              icon={<Pill aria-hidden="true" />}
              label="Эмийн зөвшөөрөл"
              value={medicationSummary ?? "Бүртгэлгүй"}
              active={Boolean(medicationSummary)}
              action={
                <StatusAction
                  label={
                    medicationSummary ? "Эмийн зөвшөөрлийн түүх рүү очих" : "Эмийн зөвшөөрөл нэмэх"
                  }
                  hasValue={Boolean(medicationSummary)}
                  canAdd
                  onClick={() =>
                    medicationSummary ? scrollToHealthHistory() : setQuickAddOpen(true)
                  }
                />
              }
            />
            <HealthStatusRow
              icon={<ClipboardList aria-hidden="true" />}
              label="Анхаарах заавар"
              value={healthNotes ? "1 мэдээлэл" : "Бүртгэлгүй"}
              active={Boolean(healthNotes)}
              action={
                healthNotes ? (
                  <StatusAction
                    label="Анхаарах зааврыг харах"
                    hasValue
                    onClick={scrollToHealthHistory}
                  />
                ) : null
              }
            />
          </div>
        </Card>

        {liveNeeds.length === 0 ? (
          <span className="sr-only">Бүртгэгдсэн тусгай хэрэгцээ алга</span>
        ) : null}
      </section>

      <section id="health-history" aria-labelledby="health-history-heading">
        <div className="mb-4 flex min-h-11 items-center justify-between gap-3 border-t border-border pt-5">
          <h3 id="health-history-heading" className="text-lead font-semibold text-ink">
            Эрүүл мэндийн түүх{" "}
            <span className="text-body font-normal text-muted">· нас, жилээр</span>
          </h3>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              historyOpen ? "Эрүүл мэндийн түүхийг хураах" : "Эрүүл мэндийн түүхийг дэлгэх"
            }
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            {historyOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </Button>
        </div>

        {historyOpen ? (
          <div className="flex flex-col gap-3">
            {[years.current, ...years.previous].map((year, index) => (
              <HealthHistoryYearCard
                key={year.startYear}
                year={year}
                childId={childId}
                isStaff={isStaff}
                userId={userId}
                healthNotes={index === 0 ? healthNotes : null}
                defaultOpen={index < 2}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function HealthStatusRow({
  icon,
  label,
  value,
  active,
  action,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  active: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-[72px] gap-3 px-4 py-4 sm:grid-cols-[minmax(170px,.9fr)_minmax(180px,1fr)_auto] sm:items-center md:px-6">
      <div className="flex items-center gap-3 font-semibold text-ink [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <span className={active ? "font-medium text-primary" : "text-muted"}>{value}</span>
      <div className="flex min-h-11 items-center justify-end">{action}</div>
    </div>
  );
}

function StatusAction({
  label,
  hasValue,
  canAdd = false,
  onClick,
}: {
  label: string;
  hasValue: boolean;
  canAdd?: boolean;
  onClick: () => void;
}) {
  if (!hasValue && !canAdd) return null;

  return (
    <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
      {hasValue ? <ChevronRight aria-hidden="true" /> : <Plus aria-hidden="true" />}
    </Button>
  );
}

function HealthHistoryYearCard({
  childId,
  isStaff,
  userId,
  year,
  defaultOpen,
  healthNotes,
}: {
  childId: string;
  isStaff: boolean;
  userId: string | null;
  year: HealthHistoryYear;
  defaultOpen: boolean;
  healthNotes?: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const endedAllergies = year.records.filter(
    (record): record is Extract<HealthHistoryRecord, { kind: "ALLERGY" }> =>
      record.kind === "ALLERGY" && Boolean(record.allergy.endedOn),
  );
  const endedNeeds = year.records.filter(
    (record): record is Extract<HealthHistoryRecord, { kind: "SPECIAL_NEED" }> =>
      record.kind === "SPECIAL_NEED" && Boolean(record.need.endedOn),
  );
  const visible = year.records.filter((record) => {
    if (record.kind === "ALLERGY") return !record.allergy.endedOn;
    if (record.kind === "SPECIAL_NEED") return !record.need.endedOn;
    return true;
  });
  const count = year.records.length + Number(Boolean(healthNotes));

  return (
    <details
      className="group overflow-hidden rounded-card border border-border bg-surface shadow-sm"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-[72px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 marker:content-none md:px-5 [&::-webkit-details-marker]:hidden">
        <div>
          <h4 className="text-lead font-semibold text-ink">{year.label} хичээлийн жил</h4>
          {year.age !== null ? (
            <p className="mt-0.5 text-caption text-muted">{year.age} нас</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 font-semibold text-primary">
          <span>{count} бүртгэл</span>
          <ChevronDown
            aria-hidden="true"
            className="text-muted transition-transform group-open:rotate-180"
          />
        </div>
      </summary>

      <div className="border-t border-border bg-canvas/40 p-3 md:p-4">
        {healthNotes ? (
          <div className="mb-3 flex gap-3 rounded-row border border-border bg-surface p-4">
            <ClipboardList aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />
            <div>
              <p className="font-semibold text-ink">Анхаарах заавар</p>
              <p className="mt-1 whitespace-pre-wrap text-body text-muted">{healthNotes}</p>
            </div>
          </div>
        ) : null}

        {visible.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {visible.map((record) => (
              <HealthHistoryRecordRow
                key={`${record.kind}-${historyRecordId(record)}`}
                childId={childId}
                isStaff={isStaff}
                userId={userId}
                record={record}
              />
            ))}
          </ul>
        ) : !healthNotes && endedAllergies.length === 0 && endedNeeds.length === 0 ? (
          <EmptyState
            title="Энэ хичээлийн жилд бүртгэл алга"
            description="Эрүүл мэндийн мэдээлэл нэмэгдэхэд энд автоматаар харагдана."
          />
        ) : null}

        {endedAllergies.length > 0 ? (
          <details className="mt-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-caption font-medium text-primary">
              Дууссан харшил ({endedAllergies.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {endedAllergies.map((record) => (
                <AllergyRow
                  key={record.allergy.id}
                  childId={childId}
                  allergy={record.allergy}
                  canEdit={isStaff}
                />
              ))}
            </ul>
          </details>
        ) : null}

        {endedNeeds.length > 0 ? (
          <details className="mt-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-caption font-medium text-primary">
              Дууссан бүртгэл ({endedNeeds.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {endedNeeds.map((record) => (
                <SpecialNeedRow
                  key={record.need.id}
                  childId={childId}
                  need={record.need}
                  canEdit={isStaff}
                />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </details>
  );
}

function HealthHistoryRecordRow({
  childId,
  isStaff,
  userId,
  record,
}: {
  childId: string;
  isStaff: boolean;
  userId: string | null;
  record: HealthHistoryRecord;
}) {
  if (record.kind === "ALLERGY") {
    return <AllergyRow childId={childId} allergy={record.allergy} canEdit={isStaff} />;
  }

  if (record.kind === "SPECIAL_NEED") {
    return <SpecialNeedRow childId={childId} need={record.need} canEdit={isStaff} />;
  }

  if (record.kind === "MEDICATION") {
    const medication = record.medication;
    const canDelete = isStaff || Boolean(userId && medication.authorisedBy?.id === userId);
    return (
      <li>
        <Card pad="compact" className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill size={16} aria-hidden="true" className="shrink-0 text-muted" />
            <span className="text-body font-medium text-ink">{medication.medicineName}</span>
            <span className="text-body text-muted">{medication.dosage}</span>
            <Badge tone={medication.isActive ? "mint" : "neutral"}>
              {medication.isActive ? "Идэвхтэй" : "Идэвхгүй"}
            </Badge>
            {canDelete ? (
              <span className="ml-auto">
                <DeleteHealthRecord
                  childId={childId}
                  path={`/medications/${medication.id}`}
                  recordLabel={medication.medicineName}
                  title="Эмийн зөвшөөрлийг устгах"
                  description={`"${medication.medicineName}" — зөвшөөрлийг устгаснаар багш энэ эмийг уулгахаа болино.`}
                />
              </span>
            ) : null}
          </div>
          <p className="text-caption text-muted">
            {medication.timesOfDay.join(", ")} · {formatDate(medication.startsOn)} –{" "}
            {formatDate(medication.endsOn)}
          </p>
          {medication.instructions ? (
            <p className="text-body text-ink">{medication.instructions}</p>
          ) : null}
        </Card>
      </li>
    );
  }

  const vaccination = record.vaccination;
  return (
    <li>
      <Card pad="compact" className="flex flex-wrap items-center gap-2">
        <Syringe size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="text-body text-ink">{vaccination.vaccineName}</span>
        {vaccination.doseLabel ? <Badge tone="sky">{vaccination.doseLabel}</Badge> : null}
        <span className="text-caption text-muted">{formatDate(vaccination.administeredOn)}</span>
        {isStaff ? (
          <span className="ml-auto">
            <DeleteHealthRecord
              childId={childId}
              path={`/vaccinations/${vaccination.id}`}
              recordLabel={vaccination.vaccineName}
              title="Вакцины бүртгэлийг устгах"
              description={`"${vaccination.vaccineName}" — буруу бүртгэсэн бол устгана.`}
            />
          </span>
        ) : null}
      </Card>
    </li>
  );
}

function buildHealthHistoryYears(
  health: ChildHealthData,
  currentStartYear: number,
  dateOfBirth?: string,
): { current: HealthHistoryYear; previous: HealthHistoryYear[] } {
  const records: HealthHistoryRecord[] = [
    ...health.allergies.map((allergy) => ({
      kind: "ALLERGY" as const,
      date: allergy.notedOn,
      allergy,
    })),
    ...health.specialNeeds.map((need) => ({
      kind: "SPECIAL_NEED" as const,
      date: need.assessedOn,
      need,
    })),
    ...health.medications.map((medication) => ({
      kind: "MEDICATION" as const,
      date: medication.startsOn,
      medication,
    })),
    ...health.vaccinations.map((vaccination) => ({
      kind: "VACCINATION" as const,
      date: vaccination.administeredOn,
      vaccination,
    })),
  ];
  const grouped = new Map<number, HealthHistoryRecord[]>();

  for (const record of records) {
    const startYear = academicYearStartForDate(record.date);
    const group = grouped.get(startYear) ?? [];
    group.push(record);
    grouped.set(startYear, group);
  }

  const createYear = (startYear: number): HealthHistoryYear => ({
    startYear,
    label: `${startYear}–${startYear + 1}`,
    age: dateOfBirth
      ? Math.max(0, Math.floor(ageInMonths(dateOfBirth, `${startYear}-09-01`) / 12))
      : null,
    records: [...(grouped.get(startYear) ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
  });

  const previous = [...grouped.keys()]
    .filter((startYear) => startYear < currentStartYear)
    .sort((a, b) => b - a)
    .map(createYear);

  return { current: createYear(currentStartYear), previous };
}

function historyRecordId(record: HealthHistoryRecord) {
  if (record.kind === "ALLERGY") return record.allergy.id;
  if (record.kind === "SPECIAL_NEED") return record.need.id;
  if (record.kind === "MEDICATION") return record.medication.id;
  return record.vaccination.id;
}

function scrollToHealthHistory() {
  document.getElementById("health-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function localDateInputValue(date = new Date()) {
  const localTime = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTime).toISOString().slice(0, 10);
}

function schoolYearStart(value: string | null | undefined): number | null {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function academicYearStartForDate(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return month >= 8 ? year : year - 1;
}

function shortDate(iso: string) {
  return iso.slice(5, 10).replace("-", ".");
}

/**
 * Removing a health record that should never have existed.
 *
 * ★ Deleting is not the same as ending, and on this screen both exist.
 *
 * An allergy already has "Дуусгах" — `PATCH { endedOn }` — for a child who
 * outgrew one. The API test that guards it says why: *"Ended, not deleted — a
 * child who outgrows one still had it."* That record is true history and the
 * menu cross-check stops firing on it.
 *
 * This is the other case: the record is **wrong**. Somebody typed the wrong
 * child, the wrong allergen, or a duplicate — and a wrong allergy is the one
 * that matters, because `menu/with-warnings` turns it into an instruction a
 * kitchen acts on. Ending it would assert the child once had an allergy they
 * never had; only a delete says it was never true.
 *
 * The copy passed in at each call site keeps those two apart, because a teacher
 * choosing between them from the button labels alone is the failure mode.
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

/** Severe is red, and it is the one thing on this screen that must be loud. */
function severityTone(severity: string): "danger" | "sun" | "neutral" {
  if (severity === "SEVERE") return "danger";
  if (severity === "MODERATE") return "sun";
  return "neutral";
}

function AllergyRow({
  childId,
  allergy,
  canEdit,
}: {
  childId: string;
  allergy: Allergy;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const end = useMutation({
    mutationFn: () =>
      mutate(`/allergies/${allergy.id}`, z.unknown(), {
        method: "PATCH",
        body: { endedOn: localDateInputValue() },
      }),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: qk.health(childId) });
    },
  });

  return (
    <li>
      <Card pad="compact" className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle
            size={16}
            aria-hidden="true"
            className={
              allergy.severity === "SEVERE" ? "shrink-0 text-danger" : "shrink-0 text-muted"
            }
          />
          <span className="text-body font-medium text-ink">Харшил: {allergy.allergen}</span>
          <Badge tone={severityTone(allergy.severity)}>
            {ALLERGY_SEVERITY_LABEL[allergy.severity]}
          </Badge>
          <Badge tone="neutral">{ALLERGY_KIND_LABEL[allergy.kind]}</Badge>

          {allergy.endedOn ? (
            <span className="text-caption text-muted">Дууссан: {formatDate(allergy.endedOn)}</span>
          ) : null}

          {/*
            ★ "Дуусгах" and "Устгах" sit side by side, and the delete stays
            available after an allergy has ended.

            A record entered by mistake can be ended before anyone notices it
            was wrong, and at that point ending it again is not the repair. The
            end control hides once `endedOn` is set; the delete does not.
          */}
          {canEdit ? (
            <span className="ml-auto flex items-center gap-1">
              {!allergy.endedOn ? (
                confirming ? (
                  <span className="flex items-center gap-2">
                    <span className="text-caption text-muted">Дуусгах уу?</span>
                    <Button size="sm" disabled={end.isPending} onClick={() => end.mutate()}>
                      Тийм
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                      Үгүй
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                    Дуусгах
                  </Button>
                )
              ) : null}

              <DeleteHealthRecord
                childId={childId}
                path={`/allergies/${allergy.id}`}
                recordLabel={allergy.allergen}
                title="Харшлын бүртгэлийг устгах"
                description={`"${allergy.allergen}" — буруу бүртгэсэн бол устгана. Хүүхэд энэ харшилтай байгаад эдгэрсэн бол устгахын оронд "Дуусгах"-ыг сонгоно уу.`}
              />
            </span>
          ) : null}
        </div>

        {allergy.reaction ? (
          <p className="text-body text-ink">
            <span className="text-muted">Шинж тэмдэг: </span>
            {allergy.reaction}
          </p>
        ) : null}
        {allergy.treatment ? (
          <p className="text-body text-ink">
            <span className="text-muted">Авах арга хэмжээ: </span>
            {allergy.treatment}
          </p>
        ) : null}
      </Card>
    </li>
  );
}

/**
 * One recorded special need — А/261, шалгуур 11.
 *
 * ★ The note is the load-bearing half, not the category.
 *
 * "Хэл яриа" tells a teacher which box the state counts this child in; "Долоо
 * хоногт 2 удаа ганцаарчилсан хичээл" tells them what to do on Monday. The
 * category is what makes the national aggregate possible, so it is a closed
 * list — but the row is rendered so the note is read, not buried.
 */
function SpecialNeedRow({
  childId,
  need,
  canEdit,
}: {
  childId: string;
  need: SpecialNeed;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const end = useMutation({
    mutationFn: () =>
      mutate(`/special-needs/${need.id}`, z.unknown(), {
        method: "PATCH",
        body: { endedOn: localDateInputValue() },
      }),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: qk.health(childId) });
    },
  });

  return (
    <li>
      <Card pad="compact" className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Accessibility size={16} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="text-body font-medium text-ink">{need.category.name}</span>
          {need.documentNo ? <Badge tone="neutral">{need.documentNo}</Badge> : null}

          {need.endedOn ? (
            <span className="text-caption text-muted">Дууссан: {formatDate(need.endedOn)}</span>
          ) : null}

          {/* "Дуусгах" hides once ended; the delete stays, for `AllergyRow`'s reason. */}
          {canEdit ? (
            <span className="ml-auto flex items-center gap-1">
              {!need.endedOn ? (
                confirming ? (
                  <span className="flex items-center gap-2">
                    <span className="text-caption text-muted">Дуусгах уу?</span>
                    <Button size="sm" disabled={end.isPending} onClick={() => end.mutate()}>
                      Тийм
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                      Үгүй
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                    Дуусгах
                  </Button>
                )
              ) : null}
              <DeleteHealthRecord
                childId={childId}
                path={`/special-needs/${need.id}`}
                recordLabel={need.category.name}
                title="Тусгай хэрэгцээний бүртгэлийг устгах"
                description={`"${need.category.name}" — бүртгэлийг бүрмөсөн устгах уу? Дэмжлэг зогссон бол устгахын оронд "Дуусгах"-ыг сонговол түүх хадгалагдана.`}
              />
            </span>
          ) : null}
        </div>

        {need.note ? <p className="whitespace-pre-wrap text-body text-muted">{need.note}</p> : null}
        <p className="text-caption text-muted">Тогтоосон: {formatDate(need.assessedOn)}</p>
      </Card>
    </li>
  );
}

function SpecialNeedForm({ childId, compact = false }: { childId: string; compact?: boolean }) {
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
      <Button
        variant={compact ? "ghost" : "secondary"}
        size={compact ? "icon" : "sm"}
        className={compact ? undefined : "self-start"}
        aria-label={compact ? "Тусгай хэрэгцээ нэмэх" : undefined}
        onClick={() => setOpen(true)}
      >
        {compact ? <Plus aria-hidden="true" /> : "Тусгай хэрэгцээ нэмэх"}
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
                    {category.name}
                  </option>
                ))}
              </Select>
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
        </form>
      </FormDialog>
    </>
  );
}

function AllergyForm({ childId }: { childId: string }) {
  const queryClient = useQueryClient();
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

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Харшил нэмэх
      </Button>
    );
  }

  return (
    <Card pad="roomy">
      <form
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Юунд харшилтай вэ?" error={errors.allergen} required>
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
        </div>

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

        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Цуцлах
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MedicationForm({ childId }: { childId: string }) {
  const queryClient = useQueryClient();
  const today = localDateInputValue();

  const [open, setOpen] = useState(false);
  const [medicineName, setMedicineName] = useState("");
  const [dosage, setDosage] = useState("");
  const [times, setTimes] = useState("12:00");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [instructions, setInstructions] = useState("");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/health/medications`, z.unknown(), {
        method: "POST",
        body: {
          medicineName: medicineName.trim(),
          dosage: dosage.trim(),
          // Comma-separated because a parent typing "12:00, 16:30" is faster
          // than adding rows, and the API validates each one as HH:MM.
          timesOfDay: times
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          startsOn,
          endsOn,
          instructions: instructions.trim() || null,
        },
      }),
    onSuccess: () => {
      setMedicineName("");
      setDosage("");
      setInstructions("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: qk.health(childId) });
    },
  });

  const errors = fieldErrors(save.error);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Эмийн зөвшөөрөл нэмэх
      </Button>
    );
  }

  return (
    <Card pad="roomy">
      <form
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Эмийн нэр" error={errors.medicineName} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={medicineName}
                onChange={(e) => setMedicineName(e.target.value)}
              />
            )}
          </Field>

          <Field label="Тун" error={errors.dosage} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                placeholder="1 шахмал"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Хэдэн цагт"
          error={errors.timesOfDay}
          hint="Таслалаар тусгаарлана. Жишээ: 12:00, 16:30"
          required
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={times}
              onChange={(e) => setTimes(e.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Эхлэх" error={errors.startsOn} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                aria-describedby={describedBy}
                invalid={invalid}
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            )}
          </Field>

          <Field label="Дуусах" error={errors.endsOn} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                min={startsOn}
                aria-describedby={describedBy}
                invalid={invalid}
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Нэмэлт заавар" error={errors.instructions}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          )}
        </Field>

        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Цуцлах
          </Button>
        </div>
      </form>
    </Card>
  );
}

function VaccinationForm({ childId }: { childId: string }) {
  const queryClient = useQueryClient();
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

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Вакцин нэмэх
      </Button>
    );
  }

  return (
    <Card pad="roomy">
      <form
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Вакцины нэр" error={errors.vaccineName} required>
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
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Цуцлах
          </Button>
        </div>
      </form>
    </Card>
  );
}
