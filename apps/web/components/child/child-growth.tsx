"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cake, ChevronDown, ChevronUp, Eye, Leaf, Pencil, Plus, Sprout } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { ageInMonths, growthChartSchema, type GrowthPoint } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { formatDate } from "@/lib/format";
import { isPresent } from "@/lib/utils";

type Season = "AUTUMN" | "SPRING";

interface AcademicYearMeasurements {
  startYear: number;
  label: string;
  age: number | null;
  autumn: GrowthPoint | null;
  spring: GrowthPoint | null;
}

const SEASONS: readonly Season[] = ["AUTUMN", "SPRING"];

function localDateInputValue(date = new Date()) {
  const localTime = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTime).toISOString().slice(0, 10);
}

/**
 * The growth record as two intentional check-ins per academic year.
 * August–December is the autumn slot and January–July is the spring slot.
 */
export function ChildGrowth({
  childId,
  dateOfBirth,
  currentSchoolYear,
}: {
  childId: string;
  /** Kept at call sites because both staff and guardians may record growth. */
  isStaff: boolean;
  dateOfBirth?: string;
  currentSchoolYear?: string | null;
}) {
  const today = localDateInputValue();
  const currentStartYear = schoolYearStart(currentSchoolYear) ?? academicYearStartForDate(today);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<GrowthPoint | null>(null);
  const [viewingPoint, setViewingPoint] = useState<GrowthPoint | null>(null);
  const [previousOpen, setPreviousOpen] = useState(true);

  const chart = useQuery({
    queryKey: qk.growth(childId),
    queryFn: () => get(`/children/${childId}/growth`, growthChartSchema),
  });

  const years = useMemo(
    () =>
      chart.data
        ? buildAcademicYears(chart.data.points, currentStartYear, dateOfBirth)
        : { current: null, previous: [] },
    [chart.data, currentStartYear, dateOfBirth],
  );

  if (chart.isPending) return <LoadingState rows={3} />;
  if (chart.isError) return <ErrorState description={errorMessage(chart.error)} />;

  const openNewMeasurement = () => {
    setEditingPoint(null);
    setEditorOpen(true);
  };
  const openEditMeasurement = (point: GrowthPoint) => {
    setEditingPoint(point);
    setEditorOpen(true);
  };

  return (
    <div className="flex flex-col gap-7">
      <section aria-labelledby="seasonal-growth-heading">
        <SectionHeader
          id="seasonal-growth-heading"
          title="Улирлын хэмжилт"
          lede="Намар, хавар хоёр удаа бүртгэнэ"
          action={
            <Button size="sm" onClick={openNewMeasurement}>
              <Plus aria-hidden="true" />
              Хэмжилт нэмэх
            </Button>
          }
        />

        <CurrentYearCard
          year={years.current!}
          onAdd={openNewMeasurement}
          onEdit={openEditMeasurement}
        />
      </section>

      <section aria-labelledby="previous-growth-years-heading">
        <div className="mb-4 flex min-h-11 items-center justify-between gap-3">
          <h3 id="previous-growth-years-heading" className="text-lead font-semibold text-ink">
            Өмнөх хичээлийн жилүүд ({years.previous.length})
          </h3>
          <Button
            variant="ghost"
            size="icon"
            aria-label={previousOpen ? "Өмнөх жилүүдийг хураах" : "Өмнөх жилүүдийг дэлгэх"}
            aria-expanded={previousOpen}
            aria-controls="previous-growth-years"
            onClick={() => setPreviousOpen((value) => !value)}
          >
            {previousOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </Button>
        </div>

        {previousOpen ? (
          <div id="previous-growth-years" className="flex flex-col gap-3">
            {years.previous.length > 0 ? (
              years.previous.map((year, index) => (
                <PreviousYearCard
                  key={year.startYear}
                  year={year}
                  defaultOpen={index === 0}
                  onView={setViewingPoint}
                />
              ))
            ) : (
              <EmptyState
                title="Өмнөх хичээлийн жилийн хэмжилт алга"
                description="Хэмжилтүүд бүртгэгдэхэд хичээлийн жилээрээ энд автоматаар бүлэглэгдэнэ."
              />
            )}
          </div>
        ) : null}
      </section>

      <MeasurementDialog
        childId={childId}
        open={editorOpen}
        editingPoint={editingPoint}
        onOpenChange={setEditorOpen}
      />
      <MeasurementViewDialog point={viewingPoint} onClose={() => setViewingPoint(null)} />
    </div>
  );
}

function CurrentYearCard({
  year,
  onAdd,
  onEdit,
}: {
  year: AcademicYearMeasurements;
  onAdd: () => void;
  onEdit: (point: GrowthPoint) => void;
}) {
  return (
    <Card className="overflow-hidden border-sky">
      <YearHeader year={year} current />
      <div className="divide-y divide-border">
        {SEASONS.map((season) => {
          const point = season === "AUTUMN" ? year.autumn : year.spring;
          return (
            <SeasonRow
              key={season}
              season={season}
              point={point}
              action={
                point ? (
                  <Button variant="ghost" size="sm" onClick={() => onEdit(point)}>
                    <Pencil aria-hidden="true" />
                    Засах
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={onAdd}>
                    <Plus aria-hidden="true" />
                    Нэмэх
                  </Button>
                )
              }
            />
          );
        })}
      </div>
    </Card>
  );
}

function PreviousYearCard({
  year,
  defaultOpen,
  onView,
}: {
  year: AcademicYearMeasurements;
  defaultOpen: boolean;
  onView: (point: GrowthPoint) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className="group overflow-hidden rounded-card border border-border bg-surface shadow-sm"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-[72px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 marker:content-none md:px-5 [&::-webkit-details-marker]:hidden">
        <h4 className="truncate text-lead font-semibold text-ink">{year.label} хичээлийн жил</h4>
        <div className="flex shrink-0 items-center gap-2">
          {year.age !== null ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-primary-soft px-3 py-1.5 text-caption font-semibold text-primary">
              <Cake aria-hidden="true" className="size-4" />
              {year.age} нас
            </span>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className="text-muted transition-transform group-open:rotate-180"
          />
        </div>
      </summary>

      <div className="divide-y divide-border border-t border-border">
        {SEASONS.map((season) => {
          const point = season === "AUTUMN" ? year.autumn : year.spring;
          return (
            <SeasonRow
              key={season}
              season={season}
              point={point}
              action={
                point ? (
                  <Button variant="ghost" size="sm" onClick={() => onView(point)}>
                    <Eye aria-hidden="true" />
                    Харах
                  </Button>
                ) : null
              }
            />
          );
        })}
        <p className="bg-sunken px-4 py-3 text-center text-caption font-medium text-muted">
          Жилийн өөрчлөлт: {yearChange(year)}
        </p>
      </div>
    </details>
  );
}

function YearHeader({ year, current }: { year: AcademicYearMeasurements; current?: boolean }) {
  const completed = Number(Boolean(year.autumn)) + Number(Boolean(year.spring));

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 md:px-5 ${
        current ? "border-sky bg-primary-soft" : "border-border"
      }`}
    >
      <div>
        <h3 className="text-lead font-semibold text-ink">{year.label} хичээлийн жил</h3>
        {year.age !== null ? (
          <p className="mt-0.5 text-caption text-muted">{year.age} нас</p>
        ) : null}
      </div>
      <span className="text-body font-semibold text-primary">{completed}/2 бүртгэсэн</span>
    </div>
  );
}

function SeasonRow({
  season,
  point,
  action,
}: {
  season: Season;
  point: GrowthPoint | null;
  action: ReactNode;
}) {
  const autumn = season === "AUTUMN";

  return (
    <div
      aria-label={autumn ? "Намрын хэмжилт" : "Хаврын хэмжилт"}
      className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(120px,1.15fr)_minmax(130px,1fr)_minmax(90px,.75fr)_minmax(90px,.75fr)_auto] md:items-center md:px-5"
    >
      <div className="flex items-center gap-2.5 font-semibold text-ink">
        {autumn ? (
          <Leaf aria-hidden="true" className="size-5 text-mint-ink" />
        ) : (
          <Sprout aria-hidden="true" className="size-5 text-mint-ink" />
        )}
        {autumn ? "Намар" : "Хавар"}
      </div>
      <time className={point ? "text-body text-muted" : "text-body text-faint"}>
        {point ? formatDate(point.measuredOn) : "Хүлээгдэж байна"}
      </time>
      <MeasurementValue value={point?.heightCm} unit="см" />
      <MeasurementValue value={point?.weightKg} unit="кг" />
      <div className="flex min-h-11 items-center justify-end">{action}</div>
    </div>
  );
}

function MeasurementValue({ value, unit }: { value: number | null | undefined; unit: string }) {
  return (
    <span className={isPresent(value) ? "font-semibold tabular-nums text-ink" : "text-faint"}>
      {isPresent(value) ? value : "—"} {unit}
    </span>
  );
}

function MeasurementDialog({
  childId,
  open,
  editingPoint,
  onOpenChange,
}: {
  childId: string;
  open: boolean;
  editingPoint: GrowthPoint | null;
  onOpenChange: (open: boolean) => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const today = localDateInputValue();
  const [measuredOn, setMeasuredOn] = useState(today);
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setMeasuredOn(editingPoint?.measuredOn ?? today);
    setHeightCm(isPresent(editingPoint?.heightCm) ? String(editingPoint.heightCm) : "");
    setWeightKg(isPresent(editingPoint?.weightKg) ? String(editingPoint.weightKg) : "");
    setNote(editingPoint?.note ?? "");
  }, [editingPoint, open, today]);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/growth/${measuredOn}`, z.unknown(), {
        method: "PUT",
        body: {
          heightCm: heightCm.trim() ? Number(heightCm) : null,
          weightKg: weightKg.trim() ? Number(weightKg) : null,
          note: note.trim() || null,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.growth(childId) });
      toast.success(editingPoint ? "Хэмжилт шинэчлэгдлээ." : "Хэмжилт нэмэгдлээ.");
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const errors = fieldErrors(save.error);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editingPoint ? "Хэмжилт засах" : "Хэмжилт нэмэх"}
      description="Хэмжсэн огноо, өндөр болон жинг оруулна уу."
      busy={save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Цуцлах
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending) save.mutate();
        }}
        noValidate
      >
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
          }
        />

        <Field label="Хэмжсэн огноо" error={errors.measuredOn} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              max={today}
              disabled={Boolean(editingPoint)}
              aria-describedby={describedBy}
              invalid={invalid}
              value={measuredOn}
              onChange={(event) => setMeasuredOn(event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Өндөр (см)" error={errors.heightCm}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                step="0.1"
                aria-describedby={describedBy}
                invalid={invalid}
                value={heightCm}
                onChange={(event) => setHeightCm(event.target.value)}
              />
            )}
          </Field>

          <Field label="Жин (кг)" error={errors.weightKg}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                step="0.1"
                aria-describedby={describedBy}
                invalid={invalid}
                value={weightKg}
                onChange={(event) => setWeightKg(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Тэмдэглэл" error={errors.note}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}

function MeasurementViewDialog({
  point,
  onClose,
}: {
  point: GrowthPoint | null;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={Boolean(point)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Хэмжилтийн дэлгэрэнгүй"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      {point ? (
        <dl className="divide-y divide-border">
          <ViewFact label="Огноо" value={formatDate(point.measuredOn)} />
          <ViewFact label="Нас" value={formatAge(point)} />
          <ViewFact
            label="Өндөр"
            value={isPresent(point.heightCm) ? `${point.heightCm} см` : "—"}
          />
          <ViewFact label="Жин" value={isPresent(point.weightKg) ? `${point.weightKg} кг` : "—"} />
          <ViewFact label="Тэмдэглэл" value={point.note || "—"} />
        </dl>
      ) : null}
    </FormDialog>
  );
}

function ViewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
      <dt className="text-body text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function buildAcademicYears(
  points: GrowthPoint[],
  currentStartYear: number,
  dateOfBirth?: string,
): { current: AcademicYearMeasurements; previous: AcademicYearMeasurements[] } {
  const grouped = new Map<number, GrowthPoint[]>();
  for (const point of points) {
    const startYear = academicYearStartForDate(point.measuredOn);
    const group = grouped.get(startYear) ?? [];
    group.push(point);
    grouped.set(startYear, group);
  }

  const createYear = (startYear: number): AcademicYearMeasurements => {
    const yearPoints = [...(grouped.get(startYear) ?? [])].sort((a, b) =>
      a.measuredOn.localeCompare(b.measuredOn),
    );
    const latest = (season: Season) =>
      [...yearPoints].reverse().find((point) => seasonForDate(point.measuredOn) === season) ?? null;
    const agePoint = yearPoints[0];
    const age = agePoint
      ? Math.floor(pointAgeMonths(agePoint) / 12)
      : dateOfBirth
        ? Math.max(0, Math.floor(ageInMonths(dateOfBirth, `${startYear}-09-01`) / 12))
        : null;

    return {
      startYear,
      label: `${startYear}–${startYear + 1}`,
      age,
      autumn: latest("AUTUMN"),
      spring: latest("SPRING"),
    };
  };

  const previous = [...grouped.keys()]
    .filter((startYear) => startYear < currentStartYear)
    .sort((a, b) => b - a)
    .map(createYear);

  return { current: createYear(currentStartYear), previous };
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

function seasonForDate(iso: string): Season {
  return Number(iso.slice(5, 7)) >= 8 ? "AUTUMN" : "SPRING";
}

function pointAgeMonths(point: GrowthPoint): number {
  return point.ageMonths ?? Math.round(point.ageYears * 12);
}

function formatAge(point: GrowthPoint): string {
  const months = pointAgeMonths(point);
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  return remaining > 0 ? `${years} нас ${remaining} сар` : `${years} нас`;
}

function yearChange(year: AcademicYearMeasurements): string {
  if (!year.autumn || !year.spring) return "—";

  const height = difference(year.autumn.heightCm, year.spring.heightCm, "см");
  const weight = difference(year.autumn.weightKg, year.spring.weightKg, "кг");
  return [height, weight].filter(Boolean).join(" · ") || "—";
}

function difference(
  from: number | null | undefined,
  to: number | null | undefined,
  unit: string,
): string | null {
  if (!isPresent(from) || !isPresent(to)) return null;
  const value = Math.round((to - from) * 10) / 10;
  return `${value > 0 ? "+" : ""}${value} ${unit}`;
}
