"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { childDetailSchema, observationSchema, observationTypeSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PORTFOLIO } from "@/lib/vocabulary";
import { Card, SectionHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ObservationPhotos } from "@/components/observations/observation-photos";
import { fullName } from "@/lib/format";

const typesSchema = z.array(observationTypeSchema);

/** Today, as `YYYY-MM-DD` in local time — `toISOString()` would shift the day in UTC+8. */
function todayLocal(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Record one observation.
 *
 * ★ A single page, not a wizard. A teacher writing this has the moment in their
 * head and wants it down before it goes; splitting it across steps means
 * re-reading what they already wrote to find where they were.
 *
 * The two audiences submit to **different endpoints** with different fields —
 * `/observations` for staff, `/parent-observations` for a family. That is the
 * API's design (RFP §5.4): a parent shares what happened at home, and
 * visibility, report inclusion and domain tagging are the teacher's decisions,
 * so the parent schema does not accept them at all.
 */
export default function NewObservationPage() {
  const toast = useToast();
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const types = useQuery({
    queryKey: qk.observationTypes(childId),
    queryFn: () => get(`/children/${childId}/observations/types`, typesSchema),
    enabled: isStaff && child.isSuccess,
  });

  const [typeId, setTypeId] = useState("");
  const [observedOn, setObservedOn] = useState(todayLocal());
  const [activityName, setActivityName] = useState("");
  const [situation, setSituation] = useState("");
  const [childDid, setChildDid] = useState("");
  const [childSaid, setChildSaid] = useState("");
  const [teacherComment, setTeacherComment] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [visibleToParents, setVisibleToParents] = useState(false);
  const [includeInReport, setIncludeInReport] = useState(true);

  /** Set once the observation exists, so photos can be attached to it. */
  const [savedId, setSavedId] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      // `undefined` rather than `""` for empty optional text: the API's schema
      // is `.strict()`, and an empty string is a value that would overwrite
      // rather than be left unset.
      const optional = (value: string) => (value.trim() ? value.trim() : undefined);

      if (!isStaff) {
        return mutate(`/children/${childId}/parent-observations`, observationSchema, {
          method: "POST",
          body: {
            observedOn,
            situation: optional(situation),
            childDid: optional(childDid),
            childSaid: optional(childSaid),
          },
        });
      }

      return mutate(`/children/${childId}/observations`, observationSchema, {
        method: "POST",
        body: {
          typeId,
          observedOn,
          activityName: optional(activityName),
          situation: optional(situation),
          childDid: optional(childDid),
          childSaid: optional(childSaid),
          teacherComment: optional(teacherComment),
          nextSteps: optional(nextSteps),
          visibleToParents,
          includeInReport,
        },
      });
    },
    onSuccess: (observation) => {
      /*
        ★ No success toast here, deliberately — unlike the other ten screens in
        this pass.

        Saving replaces the form with a confirmation card that also says what
        to do next ("Хүсвэл зураг хавсаргана уу"), and the photo uploader
        appears under it. A toast would be the same sentence twice, two inches
        apart. `toast.ts` makes this argument the other way round for errors:
        the one that is actionable stays inline.

        `onError` below is the half that was genuinely missing.
      */
      setSavedId(observation.id);
      // Prefix invalidation: everything under this child is now stale.
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.teacher() });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  if (child.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState
          description={errorMessage(child.error)}
          action={
            <Button asChild variant="secondary">
              <Link href="/children">Жагсаалт руу буцах</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Saved. The form stays on screen behind a confirmation so photos can be
  // attached — navigating away immediately would make adding a picture a
  // second, separate errand.
  if (savedId) {
    return (
      <div className="flex flex-col gap-5 py-2">
        <Card className="px-5 py-5">
          <p role="status" className="font-medium text-mint-ink">
            Ажиглалт хадгалагдлаа.
          </p>
          <p className="mt-1 text-body text-muted">
            {isStaff
              ? "Хүсвэл зураг хавсаргана уу."
              : "Багш хянаад баталгаажуулна. Хүсвэл зураг хавсаргана уу."}
          </p>
        </Card>

        <ObservationPhotos childId={childId} observationId={savedId} />

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => router.push(`/children/${childId}/general`)}>Дуусгах</Button>
          <Button
            variant="secondary"
            onClick={() => {
              // A fresh blank form, same child — the common case is writing
              // several observations in one sitting.
              setSavedId(null);
              save.reset();
              setSituation("");
              setChildDid("");
              setChildSaid("");
              setTeacherComment("");
              setNextSteps("");
              setActivityName("");
            }}
          >
            Дахин бичих
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-2">
      <header>
        <Link
          href={`/children/${childId}/general`}
          className="inline-flex min-h-[44px] items-center text-body text-primary underline underline-offset-4"
        >
          ← {fullName(child.data)}
        </Link>
        <h1 className="mt-1 text-heading font-semibold text-ink">
          {isStaff ? "Шинэ ажиглалт" : "Гэрийн мөч хуваалцах"}
        </h1>
        {!isStaff ? (
          <p className="mt-1 text-body text-muted">Таны бичсэнийг багш хянаад хавтаст нэмнэ.</p>
        ) : null}
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (save.isPending) return;
          save.mutate();
        }}
        className="flex flex-col gap-5"
        noValidate
      >
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
          }
        />

        <Card pad="roomy" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {isStaff ? (
              <Field label="Ажиглалтын төрөл" error={errors.typeId} required>
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={typeId}
                    onChange={(e) => setTypeId(e.target.value)}
                    required
                  >
                    <option value="">Сонгоно уу</option>
                    {(types.data ?? []).map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            <Field label="Огноо" error={errors.observedOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={observedOn}
                  max={todayLocal()}
                  onChange={(e) => setObservedOn(e.target.value)}
                  required
                />
              )}
            </Field>
          </div>

          {isStaff ? (
            <Field label="Үйл ажиллагааны нэр" error={errors.activityName}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={activityName}
                  onChange={(e) => setActivityName(e.target.value)}
                />
              )}
            </Field>
          ) : null}
        </Card>

        <section>
          <SectionHeader title="Юу болсон бэ?" as="h2" />
          <Card pad="roomy" className="flex flex-col gap-4">
            <Field label="Нөхцөл байдал" error={errors.situation}>
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={situation}
                  onChange={(e) => setSituation(e.target.value)}
                  placeholder="Хаана, хэзээ, ямар нөхцөлд болсон бэ?"
                />
              )}
            </Field>

            <Field label="Хүүхэд юу хийсэн бэ?" error={errors.childDid}>
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={childDid}
                  onChange={(e) => setChildDid(e.target.value)}
                />
              )}
            </Field>

            <Field label="Хүүхэд юу хэлсэн бэ?" error={errors.childSaid}>
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={childSaid}
                  onChange={(e) => setChildSaid(e.target.value)}
                />
              )}
            </Field>
          </Card>
        </section>

        {isStaff ? (
          <>
            <section>
              <SectionHeader title="Багшийн дүгнэлт" as="h2" />
              <Card pad="roomy" className="flex flex-col gap-4">
                <Field label="Тайлбар" error={errors.teacherComment}>
                  {({ id, describedBy, invalid }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={teacherComment}
                      onChange={(e) => setTeacherComment(e.target.value)}
                    />
                  )}
                </Field>

                <Field label="Дараагийн алхам" error={errors.nextSteps}>
                  {({ id, describedBy, invalid }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={nextSteps}
                      onChange={(e) => setNextSteps(e.target.value)}
                    />
                  )}
                </Field>
              </Card>
            </section>

            <section>
              <SectionHeader title="Хэн харах вэ?" as="h2" />
              <Card className="px-4 py-3 sm:px-5">
                {/*
                  ★ Unchecked by default, matching the API's own default. A
                  teacher's working note is private until they deliberately
                  share it; a checkbox that starts on would publish notes nobody
                  meant to publish.
                */}
                <Checkbox
                  label="Эцэг эх харах боломжтой"
                  description="Тэмдэглэхгүй бол зөвхөн багш нар харна."
                  checked={visibleToParents}
                  onChange={(e) => setVisibleToParents(e.target.checked)}
                />
                <Checkbox
                  label={`${PORTFOLIO}ны PDF-д оруулах`}
                  checked={includeInReport}
                  onChange={(e) => setIncludeInReport(e.target.checked)}
                />
              </Card>
            </section>
          </>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href={`/children/${childId}/general`}>Цуцлах</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
