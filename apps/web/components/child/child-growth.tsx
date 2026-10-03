"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Leaf, MessageSquare, Pencil, Plus, Sprout } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { z } from "zod";
import { ageInMonths, growthChartSchema, type GrowthPoint } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GrowthChartFigure } from "@/components/child/growth-chart";
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

  const reference = chart.data.reference ?? null;
  const latest = [...chart.data.points].sort((x, y) => y.measuredOn.localeCompare(x.measuredOn))[0];
  const rows = tableRows(years.current!, years.previous);

  /*
    ★ Reorganised 2026-10-01, at the client's request that Өсөлт be easier to
    read. The latest measurement leads, with how much it changed and whether it
    sits inside the WHO ±2 SD band for the child's age — a band, never a
    percentile, and said not to be a diagnosis. Under it, every measurement in
    one table, newest first: the current year's two seasons (an empty one asks
    to be filled), then the earlier years. It replaces a current-year card and
    a fold of folds — two presses to read last year's height.
  */
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="growth-latest-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="growth-latest-heading" className="text-title font-semibold text-ink">
            Сүүлийн хэмжилт
          </h2>
          <Button size="sm" onClick={openNewMeasurement}>
            <Plus aria-hidden="true" />
            Хэмжилт нэмэх
          </Button>
        </div>

        {latest ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricTile
                label="Өндөр"
                unit="см"
                value={latest.heightCm}
                change={latest.heightChangeCm}
                status={bandStatus(latest.heightCm, latest.ageYears, reference?.height)}
              />
              <MetricTile
                label="Жин"
                unit="кг"
                value={latest.weightKg}
                change={latest.weightChangeKg}
                status={bandStatus(latest.weightKg, latest.ageYears, reference?.weight)}
              />
            </div>
            <p className="text-caption text-muted">
              {formatDate(latest.measuredOn)} хэмжсэн · {formatAge(latest)}
              {/* The source and the "not a diagnosis" line are under the chart. */}
              {reference ? ` · ${reference.source.name}-ын ±2 SD мужтай харьцуулсан` : null}
            </p>
          </>
        ) : (
          <EmptyState
            title="Хэмжилт бүртгэгдээгүй байна"
            description="Намар, хавар хоёр удаа өндөр, жинг бүртгэнэ."
          />
        )}
      </section>

      {/*
        ★ The chart — 2026-10-01, phase 2. `GrowthChartFigure` was built for
        RFP §7.2 (the child's line over the WHO ±2 SD band, the source, its
        version and date, and the "not a diagnosis" line) and had been left
        unused when this tab was redrawn as cards. Its own number table is
        off: the table below is the full history. Nothing is drawn without a
        measurement.
      */}
      {latest ? (
        <section aria-labelledby="growth-chart-heading" className="flex flex-col gap-3">
          <h2 id="growth-chart-heading" className="text-title font-semibold text-ink">
            Өсөлтийн график
          </h2>
          <Card pad="compact">
            <GrowthChartFigure chart={chart.data} layout="grid" showTable={false} />
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="growth-history-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="growth-history-heading" className="text-title font-semibold text-ink">
            Бүх хэмжилт
          </h2>
          <p className="text-caption text-muted">Намар, хавар хоёр удаа бүртгэнэ</p>
        </div>
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[720px] border-collapse text-body">
            <caption className="sr-only">Өсөлтийн бүх хэмжилт</caption>
            <thead>
              <tr className="bg-sunken text-left text-caption font-semibold text-muted">
                <th className="px-3 py-2">Хичээлийн жил</th>
                <th className="px-3 py-2">Улирал</th>
                <th className="px-3 py-2">Огноо</th>
                <th className="px-3 py-2">Нас</th>
                <th className="px-3 py-2 text-right">Өндөр</th>
                <th className="px-3 py-2 text-right">Жин</th>
                <th className="px-3 py-2">Өөрчлөлт</th>
                <th className="w-12 px-3 py-2">
                  <span className="sr-only">Үйлдэл</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const point = row.point;
                return (
                  <tr
                    key={`${row.year.startYear}-${row.season}`}
                    aria-label={`${row.year.label} ${row.season === "AUTUMN" ? "намрын" : "хаврын"} хэмжилт`}
                    className={`border-t border-border-soft ${row.current ? "bg-primary-soft/40" : ""}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{row.year.label}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                        {row.season === "AUTUMN" ? (
                          <Leaf aria-hidden="true" className="size-4 text-mint-ink" />
                        ) : (
                          <Sprout aria-hidden="true" className="size-4 text-mint-ink" />
                        )}
                        {row.season === "AUTUMN" ? "Намар" : "Хавар"}
                      </span>
                    </td>
                    {point ? (
                      <>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
                          {formatDate(point.measuredOn)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted">
                          {formatAge(point)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-ink">
                          {isPresent(point.heightCm) ? `${point.heightCm} см` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-ink">
                          {isPresent(point.weightKg) ? `${point.weightKg} кг` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
                          {changeLabel(point)}
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-3 py-2 text-faint">
                        {row.current ? "Хүлээгдэж байна" : "Бүртгээгүй"}
                      </td>
                    )}
                    <td className="px-2 py-1 text-right">
                      {row.current ? (
                        point ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditMeasurement(point)}
                          >
                            <Pencil aria-hidden="true" />
                            Засах
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={openNewMeasurement}>
                            <Plus aria-hidden="true" />
                            Нэмэх
                          </Button>
                        )
                      ) : point?.note ? (
                        <Button variant="ghost" size="sm" onClick={() => setViewingPoint(point)}>
                          <MessageSquare aria-hidden="true" />
                          Тэмдэглэл
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

type BandStatus = "inside" | "below" | "above" | null;

/** One headline figure: the value, its change since last time, and the band. */
function MetricTile({
  label,
  unit,
  value,
  change,
  status,
}: {
  label: string;
  unit: string;
  value: number | null | undefined;
  change: number | null | undefined;
  status: BandStatus;
}) {
  return (
    <Card pad="compact" className="flex flex-col gap-1">
      <span className="text-caption font-medium text-muted">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <strong className="text-heading font-semibold tabular-nums text-ink">
          {isPresent(value) ? `${value} ${unit}` : "—"}
        </strong>
        {isPresent(change) ? (
          <span className="text-caption tabular-nums text-muted">
            {change > 0 ? "+" : ""}
            {change} {unit} өмнөхөөс
          </span>
        ) : null}
      </span>
      {status ? (
        <span
          className={`mt-1 inline-flex w-fit rounded-pill px-2 py-0.5 text-caption font-semibold ${
            status === "inside" ? "bg-mint text-mint-ink" : "bg-peach text-peach-ink"
          }`}
        >
          {status === "inside"
            ? "Насны хэвийн мужид"
            : status === "below"
              ? "Насны мужаас доогуур"
              : "Насны мужаас дээгүүр"}
        </span>
      ) : null}
    </Card>
  );
}

/**
 * Where a value sits against the reference band at the child's age.
 *
 * The band is a list of ages with −2 SD / +2 SD; the child's age falls
 * between two of them and the bounds are read off the straight line between.
 * Outside the band's own ages there is nothing honest to say, so null.
 */
function bandStatus(
  value: number | null | undefined,
  ageYears: number,
  band: { age: number; low: number; high: number }[] | undefined,
): BandStatus {
  if (!isPresent(value) || !band || band.length === 0) return null;
  const sorted = [...band].sort((a, b) => a.age - b.age);
  const upper = sorted.findIndex((entry) => entry.age >= ageYears);
  if (upper === -1 || (upper === 0 && sorted[0]!.age > ageYears)) return null;
  const hi = sorted[upper]!;
  const lo = upper === 0 ? hi : sorted[upper - 1]!;
  const t = hi.age === lo.age ? 0 : (ageYears - lo.age) / (hi.age - lo.age);
  const low = lo.low + (hi.low - lo.low) * t;
  const high = lo.high + (hi.high - lo.high) * t;
  if (value < low) return "below";
  if (value > high) return "above";
  return "inside";
}

/** "+1.8 см · +0.7 кг" — the change since the previous measurement, from the API. */
function changeLabel(point: GrowthPoint): string {
  const part = (value: number | null | undefined, unit: string) =>
    isPresent(value) ? `${value > 0 ? "+" : ""}${value} ${unit}` : null;
  return (
    [part(point.heightChangeCm, "см"), part(point.weightChangeKg, "кг")]
      .filter(Boolean)
      .join(" · ") || "—"
  );
}

interface TableRow {
  year: AcademicYearMeasurements;
  season: Season;
  point: GrowthPoint | null;
  current: boolean;
}

/** Newest first: this year's spring and autumn, then each earlier year's. */
function tableRows(
  current: AcademicYearMeasurements,
  previous: AcademicYearMeasurements[],
): TableRow[] {
  const forYear = (year: AcademicYearMeasurements, isCurrent: boolean): TableRow[] =>
    (["SPRING", "AUTUMN"] as const).map((season) => ({
      year,
      season,
      point: season === "AUTUMN" ? year.autumn : year.spring,
      current: isCurrent,
    }));
  return [...forYear(current, true), ...previous.flatMap((year) => forYear(year, false))];
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
