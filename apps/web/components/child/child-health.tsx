"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Accessibility, AlertTriangle, Pill, Syringe, Trash2 } from "lucide-react";
import { z } from "zod";
import {
  ALLERGY_KIND_LABEL,
  ALLERGY_SEVERITY_LABEL,
  childHealthSchema,
  specialNeedsCategorySchema,
  type Allergy,
  type SpecialNeed,
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
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/auth/session";

/** The picker's list — an array, not a page: the reference table is small and
 * the endpoint returns it whole. */
const specialNeedsCategoryListSchema = z.array(specialNeedsCategorySchema);

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

  const health = useQuery({
    queryKey: qk.health(childId),
    queryFn: () => get(`/children/${childId}/health`, childHealthSchema),
  });

  if (health.isPending) return <LoadingState rows={4} />;
  if (health.isError) return <ErrorState description={errorMessage(health.error)} />;

  const { allergies, medications, vaccinations, specialNeeds, healthNotes } = health.data;
  const live = allergies.filter((allergy) => !allergy.endedOn);
  const liveNeeds = specialNeeds.filter((need) => !need.endedOn);

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
                    /*
                      ★ Was `false`, which pre-dated there being anything to do
                      here but end an allergy — and an ended one cannot be ended
                      again. Now that delete exists it has to reach this list:
                      a record entered by mistake is often ended before anyone
                      works out it was wrong, and ending it a second time is not
                      the repair. `AllergyRow` still hides "Дуусгах" whenever
                      `endedOn` is set, so this only exposes the delete.
                    */
                    canEdit={isStaff}
                  />
                ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/*
        Тусгай хэрэгцээ — А/261, цэцэрлэгийн шалгуур 11.

        ★ Between the allergies and the medication, which is where it belongs
        rather than at the foot of the screen: it is read at the same moment
        the allergies are — when a teacher is working out what this child needs
        today — and not at the moment a dose is due.

        ★★ A family reads it and does not write it, the split the allergy
        section already makes. The category is counted by the state in a return
        the kindergarten signs, and the person who can be asked which
        commission decision it came from is a member of staff. The API answers
        404 to a guardian who posts one, so offering them the form would be
        offering a control that always fails.
      */}
      <section aria-labelledby="special-needs-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="special-needs-heading"
          title="Тусгай хэрэгцээ"
          lede={isStaff ? "Комиссын шийдвэрийн дагуу бүртгэнэ." : undefined}
        />

        {isStaff ? <SpecialNeedForm childId={childId} /> : null}

        {liveNeeds.length === 0 ? (
          <EmptyState
            title="Бүртгэгдсэн тусгай хэрэгцээ алга"
            description={
              isStaff
                ? "Комиссын шийдвэр гарсан бол ангиллыг нь энд бүртгэнэ үү."
                : "Хүүхэд тань тусгай дэмжлэг шаардлагатай бол багштайгаа ярилцана уу."
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {liveNeeds.map((need) => (
              <SpecialNeedRow key={need.id} childId={childId} need={need} canEdit={isStaff} />
            ))}
          </ul>
        )}

        {/*
          Ended needs are kept and shown separately, for the ended allergies'
          reason: support that was withdrawn was still once in place, and a
          teacher reading the history needs to know it was considered.
        */}
        {specialNeeds.length > liveNeeds.length ? (
          <details className="group">
            <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-caption font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
              Дууссан бүртгэл ({specialNeeds.length - liveNeeds.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {specialNeeds
                .filter((need) => need.endedOn)
                .map((need) => (
                  <SpecialNeedRow key={need.id} childId={childId} need={need} canEdit={isStaff} />
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

                    {/*
                      ★ Staff, or the guardian who authorised this one.

                      `removeMedication` 404s a guardian who did not sign it —
                      "one guardian may not withdraw another's consent" — so
                      offering the button to the other parent would be offering
                      a control that always fails. The row *is* the consent, so
                      withdrawing it is the family's to do.
                    */}
                    {isStaff || (userId && medication.authorisedBy?.id === userId) ? (
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

                  {/*
                    Staff only — `@Roles("TEACHER", "ADMIN")`, and the register
                    is the kindergarten's, not the family's. A guardian cannot
                    record one either.
                  */}
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
            ))}
          </ul>
        )}
      </section>
    </div>
  );
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

function SpecialNeedForm({ childId }: { childId: string }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

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

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Тусгай хэрэгцээ нэмэх
      </Button>
    );
  }

  return (
    <Card pad="roomy">
      <form
        onSubmit={(e) => {
          e.preventDefault();
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ангилал" error={errors.categoryId} required>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={categoryId}
                disabled={categories.isPending}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {/*
                  An empty first option, deliberately. A pre-selected "Хараа"
                  is a classification nobody chose, and this one goes into a
                  return the kindergarten signs.
                */}
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
                onChange={(e) => setAssessedOn(e.target.value)}
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
                onChange={(e) => setDocumentNo(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Шаардлагатай дэмжлэг" error={errors.note}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={3}
              aria-describedby={describedBy}
              invalid={invalid}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={save.isPending || !categoryId}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Болих
          </Button>
        </div>
      </form>
    </Card>
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
