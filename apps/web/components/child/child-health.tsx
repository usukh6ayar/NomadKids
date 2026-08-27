"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Pill, Syringe } from "lucide-react";
import { z } from "zod";
import {
  ALLERGY_KIND_LABEL,
  ALLERGY_SEVERITY_LABEL,
  childHealthSchema,
  type Allergy,
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
export function ChildHealth({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  const health = useQuery({
    queryKey: qk.health(childId),
    queryFn: () => get(`/children/${childId}/health`, childHealthSchema),
  });

  if (health.isPending) return <LoadingState rows={4} />;
  if (health.isError) return <ErrorState description={errorMessage(health.error)} />;

  const { allergies, medications, vaccinations, healthNotes } = health.data;
  const live = allergies.filter((allergy) => !allergy.endedOn);

  return (
    <div className="flex flex-col gap-6">
      {healthNotes ? (
        <Card pad="roomy">
          <SectionHeader title="Эрүүл мэндийн тэмдэглэл" />
          <p className="whitespace-pre-wrap text-body text-ink">{healthNotes}</p>
        </Card>
      ) : null}

      <section aria-labelledby="allergies-heading" className="flex flex-col gap-3">
        <SectionHeader id="allergies-heading" title="Харшил" />

        {isStaff ? <AllergyForm childId={childId} /> : null}

        {live.length === 0 ? (
          <EmptyState
            title="Бүртгэгдсэн харшил алга"
            description={
              isStaff
                ? "Эцэг эхээс мэдээлэл авсан бол энд бүртгэнэ үү."
                : "Харшилтай бол багшдаа мэдэгдэнэ үү."
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {live.map((allergy) => (
              <AllergyRow key={allergy.id} childId={childId} allergy={allergy} canEdit={isStaff} />
            ))}
          </ul>
        )}

        {/*
          Ended allergies are kept and shown separately: a child who outgrew a
          milk allergy still had one, and a teacher reading the history needs to
          know it was considered rather than never recorded.
        */}
        {allergies.length > live.length ? (
          <details className="group">
            <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-caption font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
              Дууссан харшил ({allergies.length - live.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {allergies
                .filter((allergy) => allergy.endedOn)
                .map((allergy) => (
                  <AllergyRow
                    key={allergy.id}
                    childId={childId}
                    allergy={allergy}
                    canEdit={false}
                  />
                ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section aria-labelledby="medications-heading" className="flex flex-col gap-3">
        <SectionHeader id="medications-heading" title="Эмийн зөвшөөрөл" />

        {/*
          Not gated on `isStaff`: RFP Module 2 has the family leaving this form
          ("Эцэг эхчүүд өглөө хүүхдээ өгөхдөө … баталгаажуулан үлдээх"). Staff
          may also record one a family phoned in.
        */}
        <MedicationForm childId={childId} />

        {medications.length === 0 ? (
          <EmptyState
            title="Идэвхтэй зөвшөөрөл алга"
            description="Эм уулгах шаардлагатай бол цаг, тунг бүртгэнэ үү."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {medications.map((medication) => (
              <li key={medication.id}>
                <Card pad="compact" className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill size={16} aria-hidden="true" className="shrink-0 text-muted" />
                    <span className="text-body font-medium text-ink">
                      {medication.medicineName}
                    </span>
                    <span className="text-body text-muted">{medication.dosage}</span>
                    {/*
                      "Is it live today" comes from the API, not from comparing
                      dates here: it decides whether a teacher gives a child
                      medicine, and two clients deriving it is two chances to
                      get the boundary wrong.
                    */}
                    {medication.isActive ? (
                      <Badge tone="mint">Идэвхтэй</Badge>
                    ) : (
                      <Badge tone="neutral">Идэвхгүй</Badge>
                    )}
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
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="vaccinations-heading" className="flex flex-col gap-3">
        <SectionHeader id="vaccinations-heading" title="Вакцин, амин дэм" />

        {isStaff ? <VaccinationForm childId={childId} /> : null}

        {vaccinations.length === 0 ? (
          <EmptyState title="Бүртгэл алга" description="Хийлгэсэн вакциныг энд бүртгэнэ." />
        ) : (
          <ul className="flex flex-col gap-2">
            {vaccinations.map((vaccination) => (
              <li key={vaccination.id}>
                <Card pad="compact" className="flex flex-wrap items-center gap-2">
                  <Syringe size={16} aria-hidden="true" className="shrink-0 text-muted" />
                  <span className="text-body text-ink">{vaccination.vaccineName}</span>
                  {vaccination.doseLabel ? <Badge tone="sky">{vaccination.doseLabel}</Badge> : null}
                  <span className="text-caption text-muted">
                    {formatDate(vaccination.administeredOn)}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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
        body: { endedOn: new Date().toISOString().slice(0, 10) },
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
          <span className="text-body font-medium text-ink">{allergy.allergen}</span>
          <Badge tone={severityTone(allergy.severity)}>
            {ALLERGY_SEVERITY_LABEL[allergy.severity]}
          </Badge>
          <Badge tone="neutral">{ALLERGY_KIND_LABEL[allergy.kind]}</Badge>

          {allergy.endedOn ? (
            <span className="text-caption text-muted">Дууссан: {formatDate(allergy.endedOn)}</span>
          ) : canEdit ? (
            <span className="ml-auto">
              {confirming ? (
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
              )}
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

function AllergyForm({ childId }: { childId: string }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

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
  const today = new Date().toISOString().slice(0, 10);

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
  const today = new Date().toISOString().slice(0, 10);

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
