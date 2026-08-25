"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { growthChartSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { GrowthChartFigure } from "@/components/child/growth-chart";
import { z } from "zod";
import { isPresent } from "@/lib/utils";

/**
 * Growth — RFP §7.
 *
 * ★ A guardian may record here, and the form is not gated on `isStaff`.
 *
 * RFP §2.3 lists "Өсөлтийн мэдээлэл оруулах" among what a parent does, and the
 * API agrees — `GrowthService.record` uses the same predicate as the photo
 * album rather than the staff-only check. A UI that hid the form from families
 * would hide a feature they were promised.
 *
 * What a guardian may *not* do is delete, which is why the remove button below
 * is the one thing that checks the role. Adding contributes a fact; deleting
 * edits the record the kindergarten keeps, and a wrong value is corrected by
 * writing the same day again.
 */
export function ChildGrowth({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  const chart = useQuery({
    queryKey: qk.growth(childId),
    queryFn: () => get(`/children/${childId}/growth`, growthChartSchema),
  });

  if (chart.isPending) return <LoadingState rows={3} />;
  if (chart.isError) return <ErrorState description={errorMessage(chart.error)} />;

  return (
    <div className="flex flex-col gap-6">
      <MeasurementForm childId={childId} />

      <section aria-labelledby="growth-chart-heading">
        <SectionHeader id="growth-chart-heading" title="Өсөлтийн график" />

        {chart.data.points.length === 0 ? (
          <EmptyState
            title="Хэмжилт бүртгэгдээгүй байна"
            description="Дээрх маягтаар өндөр, жинг бүртгэснээр график үүснэ."
          />
        ) : (
          <Card pad="roomy">
            <GrowthChartFigure chart={chart.data} />
          </Card>
        )}
      </section>

      {isStaff && chart.data.points.length > 0 ? (
        <RecentMeasurements childId={childId} chart={chart.data} />
      ) : null}
    </div>
  );
}

/** `PUT :date` — the day is the record's identity, so this is not a "create". */
function MeasurementForm({ childId }: { childId: string }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [measuredOn, setMeasuredOn] = useState(today);
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/growth/${measuredOn}`, z.unknown(), {
        method: "PUT",
        body: {
          // Empty means "not measured", not zero — the API refuses a record
          // carrying no measurement at all, so an empty form fails loudly.
          heightCm: heightCm.trim() ? Number(heightCm) : null,
          weightKg: weightKg.trim() ? Number(weightKg) : null,
          note: note.trim() || null,
        },
      }),
    onSuccess: () => {
      setHeightCm("");
      setWeightKg("");
      setNote("");
      void queryClient.invalidateQueries({ queryKey: qk.growth(childId) });
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <section aria-labelledby="growth-form-heading">
      <SectionHeader id="growth-form-heading" title="Хэмжилт бүртгэх" />

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

          {save.isSuccess ? (
            <p
              role="status"
              className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink"
            >
              Хадгалагдлаа.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Хэмжсэн огноо" error={errors.measuredOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="date"
                  max={today}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={measuredOn}
                  onChange={(e) => setMeasuredOn(e.target.value)}
                />
              )}
            </Field>

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
                  onChange={(e) => setHeightCm(e.target.value)}
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
                  onChange={(e) => setWeightKg(e.target.value)}
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
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>

          <Button type="submit" disabled={save.isPending} className="self-start">
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </form>
      </Card>
    </section>
  );
}

/**
 * The delete path — staff only, and behind a confirmation.
 *
 * A guardian never sees this list, because the one action in it is one they may
 * not take: rendering a button that always 404s teaches people the app is
 * broken.
 */
function RecentMeasurements({
  childId,
  chart,
}: {
  childId: string;
  chart: z.infer<typeof growthChartSchema>;
}) {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) =>
      mutate(`/growth-measurements/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      setConfirmingId(null);
      void queryClient.invalidateQueries({ queryKey: qk.growth(childId) });
    },
  });

  // Newest first here, unlike the chart: this is a log to correct, not a line
  // to read left to right.
  const recent = [...chart.points].reverse().slice(0, 8);

  return (
    <section aria-labelledby="growth-log-heading">
      <SectionHeader id="growth-log-heading" title="Сүүлийн хэмжилтүүд" />
      <FormError message={remove.isError ? errorMessage(remove.error) : null} />

      <ul className="flex flex-col gap-2">
        {recent.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border bg-surface px-3.5 py-2.5"
          >
            <span className="text-body text-ink">
              {p.measuredOn} · {isPresent(p.heightCm) ? `${p.heightCm} см` : "—"} ·{" "}
              {isPresent(p.weightKg) ? `${p.weightKg} кг` : "—"}
            </span>

            {confirmingId === p.id ? (
              <span className="flex items-center gap-2">
                <span className="text-caption text-muted">Устгах уу?</span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(p.id)}
                >
                  Тийм
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirmingId(null)}>
                  Үгүй
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmingId(p.id)}>
                Устгах
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
