"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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
import { fullName, todayLocal } from "@/lib/format";
import { readDraft, useDraftAutosave } from "@/lib/use-form-draft";

const typesSchema = z.array(observationTypeSchema);

/**
 * What survives a Back button. Flat strings and booleans — see
 * `lib/use-form-draft.ts` for why the shape is deliberately this narrow.
 */
interface ObservationDraft {
  typeId: string;
  activityName: string;
  situation: string;
  childDid: string;
  childSaid: string;
  teacherComment: string;
  nextSteps: string;
  visibleToParents: boolean;
  includeInReport: boolean;
  [key: string]: string | boolean;
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
/**
 * ★ A Suspense boundary, because the form reads `?typeId=`.
 *
 * `useSearchParams` suspends during prerender in the App Router, and a client
 * page that calls it without a boundary fails the build rather than at
 * runtime. `/groups/:id/assessment` wraps its own reader the same way and for
 * the same reason.
 */
export default function NewObservationPage() {
  return (
    <Suspense fallback={<LoadingState rows={5} shape="text" />}>
      <KnownAudience />
    </Suspense>
  );
}

/**
 * Holds the form back until the signed-in person's roles are known.
 *
 * ★ Not a loading nicety — the draft depends on it.
 *
 * `isStaff` decides which of two different forms this is, and therefore which
 * `localStorage` key the draft restores from. Roles arrive with `/auth/me`, so
 * on the very first render `hasRole` answers `false` for everybody, including
 * a teacher. The restore happens in a `useState` initialiser — once, on that
 * first render — so without this gate a teacher's form would read the *parent*
 * key every time: their own draft would never come back, and a "Гэрийн мөч"
 * shared from the same device would open inside the teacher's form under
 * headings it was not written for.
 *
 * Mounting the form only once the answer is known costs one frame and removes
 * the whole class of problem, rather than teaching each field to re-key itself.
 */
function KnownAudience() {
  const { isLoading } = useSession();
  if (isLoading) return <LoadingState rows={5} shape="text" />;
  return <NewObservationForm />;
}

function NewObservationForm() {
  const toast = useToast();
  const searchParams = useSearchParams();
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

  /*
    ★ `?typeId=` seeds the select — 2026-08-30.

    `/assessment` puts one button per configured type beside the child picker,
    which is the shortcut the client asked for: pick a child, pick a kind,
    write. Arriving here with the kind already chosen is what makes those
    buttons worth pressing rather than being three routes to the same empty
    form.

    Seeded, not forced: the select still lists every type and the teacher can
    change their mind here. An id that does not match any configured type
    simply leaves the field empty, which is the same state as arriving with no
    parameter at all — no validation branch needed for a stale bookmark.
  */
  /*
   * ★ The draft, restored before the first paint.
   *
   * The brief's constraint 13 — "Observations autosave a draft. Losing typed
   * text is the worst failure that screen can have" — and §4.4, which calls a
   * tapped Back button the worst thing that can happen here. This screen held
   * everything in `useState` alone, so a Back button, a reload or a phone
   * discarding a backgrounded tab lost every paragraph written into it.
   *
   * Keyed by child *and* by audience: the two forms have different fields
   * (`isStaff` decides), and a parent's short "Гэрийн мөч" draft restoring into
   * a teacher's long form would put text under headings it was not written for.
   */
  const draftKey = `nomadkids:observation-draft:${isStaff ? "staff" : "parent"}:${childId}`;
  const [draft] = useState(() => readDraft<ObservationDraft>(draftKey));

  /*
   * `?typeId=` still wins over the draft: arriving from the assessment sheet's
   * type buttons is an explicit choice made *now*, and a stale draft should not
   * quietly override the button just pressed.
   */
  const [typeId, setTypeId] = useState(searchParams.get("typeId") ?? draft?.typeId ?? "");
  // The date is not restored. A draft opened the next morning should be filed
  // under the day it is being written, not the day it was abandoned.
  const [observedOn, setObservedOn] = useState(todayLocal());
  const [activityName, setActivityName] = useState(draft?.activityName ?? "");
  const [situation, setSituation] = useState(draft?.situation ?? "");
  const [childDid, setChildDid] = useState(draft?.childDid ?? "");
  const [childSaid, setChildSaid] = useState(draft?.childSaid ?? "");
  const [teacherComment, setTeacherComment] = useState(draft?.teacherComment ?? "");
  const [nextSteps, setNextSteps] = useState(draft?.nextSteps ?? "");
  const [visibleToParents, setVisibleToParents] = useState(draft?.visibleToParents ?? false);
  const [includeInReport, setIncludeInReport] = useState(draft?.includeInReport ?? true);

  /*
   * ★ Only the text is persisted, plus the two visibility choices.
   *
   * Photos are not: they are attached to an observation that already exists
   * (`ObservationPhotos` runs after the save), so there is nothing to restore
   * and a draft cannot hold a `File` anyway.
   */
  const { clear: clearDraft, resume: resumeDraft } = useDraftAutosave<ObservationDraft>(draftKey, {
    typeId,
    activityName,
    situation,
    childDid,
    childSaid,
    teacherComment,
    nextSteps,
    visibleToParents,
    includeInReport,
  });

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
      /*
        ★ The draft is discarded here and nowhere else.

        Only a successful POST means the text is safe somewhere other than this
        browser. Clearing on submit, or on unmount, would throw the draft away
        on exactly the failures it exists for — a rejected save, a dropped
        connection, a closed tab mid-request.
      */
      clearDraft();
      // Prefix invalidation: everything under this child is now stale.
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.teacher() });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  if (child.isLoading) return <LoadingState rows={5} shape="text" />;

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
              // The blank form is a new observation and drafts again from here.
              // Without this the autosave stays latched off from the first save
              // onward — see `resume` in `lib/use-form-draft.ts`.
              resumeDraft();
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
    /*
      ★ REDESIGN 2026-09-03 — a reading measure on the writing screen.

      This is the one page in the product that is mostly prose: six textareas a
      teacher writes paragraphs into. It ran the full 1400px content column, so
      on a desktop a line of Mongolian could be 1300px wide — far past the
      45–75 character measure text stays readable at, and the width at which
      the eye loses its place returning to the next line. Capping at `4xl`
      (56rem) and centring is what makes it feel like a document rather than a
      database form. Below that breakpoint nothing changes.
    */
    <div className="page-band mx-auto w-full max-w-4xl py-2">
      <header>
        <Link
          href={`/children/${childId}/general`}
          className="-ml-1 inline-flex min-h-[44px] items-center gap-1 rounded-control px-1 text-body font-medium text-muted transition-colors hover:text-primary"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          {fullName(child.data)}
        </Link>
        <h1 className="mt-1 text-heading font-semibold tracking-[-.01em] text-ink md:text-display">
          {isStaff ? "Шинэ ажиглалт" : "Гэрийн мөч хуваалцах"}
        </h1>
        {!isStaff ? (
          <p className="mt-1.5 text-body text-muted">Таны бичсэнийг багш хянаад хавтаст нэмнэ.</p>
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

        {/*
          ★ The restore is announced, not silent.

          Text appearing in a form nobody remembers filling is indistinguishable
          from the wrong child's record having opened — the one thing this
          screen must never look like. `role="status"` so it is read out rather
          than only seen, and it names what happened rather than congratulating
          anyone.
        */}
        {draft ? (
          <p role="status" className="text-body text-muted">
            Хадгалаагүй ноорог сэргээгдлээ.
          </p>
        ) : null}

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

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href={`/children/${childId}/general`}>Цуцлах</Link>
            </Button>
          </div>

          {/*
            ★ The autosave says so, quietly and permanently.

            "Цуцлах" is a link away from a page holding unsaved paragraphs, and
            the guarantee that makes pressing it safe is invisible otherwise.
            One faint line beside the button is what turns the draft from a
            mechanism into something the teacher can rely on.
          */}
          <p className="text-caption text-faint">Бичсэн зүйл ноорогт автоматаар хадгалагдана.</p>
        </div>
      </form>
    </div>
  );
}
