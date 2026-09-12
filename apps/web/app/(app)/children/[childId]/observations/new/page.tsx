"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Users } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  assessmentConfigSchema,
  curriculumCodeAtLevel,
  curriculumIndicatorSchema,
  childDetailSchema,
  observationSchema,
  observationTypeSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { BackButton } from "@/components/ui/back-button";
import { ChildAvatar } from "@/components/media/media-image";
import { ChildPickerDialog } from "@/components/child/child-picker-dialog";
import { DAILY_ACTIVITIES } from "@/components/assessment/group-coverage";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PORTFOLIO } from "@/lib/vocabulary";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ObservationPhotoPicker } from "@/components/observations/observation-photo-picker";
import { uploadChildPhotos } from "@/components/media/photo-upload";
import { ageInYears, formatAge, fullName, todayLocal } from "@/lib/format";
import { cn } from "@/lib/utils";
import { readDraft, useDraftAutosave } from "@/lib/use-form-draft";

const typesSchema = z.array(observationTypeSchema);

/**
 * What survives a Back button. Flat strings and booleans — see
 * `lib/use-form-draft.ts` for why the shape is deliberately this narrow.
 */
const indicatorsSchema = z.array(curriculumIndicatorSchema);

/** I–IV, as the curriculum writes them. */
const LEVEL_NAME: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV" };

/**
 * The whole scale, drawn whether or not an indicator has been chosen.
 *
 * ★ Not read off the indicator's own rows any more. An indicator written only
 * at II and III would otherwise draw two cards, and a teacher would be choosing
 * from a scale whose shape changed under them as they picked codes.
 */
const LEVELS = [1, 2, 3, 4] as const;

/**
 * The level a child's age puts them at — client, 2026-09-11: 2→I, 3→II, 4→III,
 * 5→IV.
 *
 * ★ Clamped at both ends rather than left undefined.
 *
 * A child who has just turned two and one who is nearly six are both real, and
 * the curriculum has four levels for the whole range: below the first is the
 * first, above the last is the last. Returning nothing would leave the
 * commonest case — a form opened for a child at either edge — with no
 * suggestion at all.
 */
function levelForAge(years: number | null): number | null {
  if (years === null) return null;
  return Math.min(4, Math.max(1, years - 1));
}

interface ObservationDraft {
  typeId: string;
  /** "HH:MM", or "" — see `Observation.observedTime`. */
  observedTime: string;
  activityName: string;
  /** The development strand, added to the form 2026-09-11. */
  domainId: string;
  indicatorId: string;
  /**
   * ★ A string, not a number, and that is the draft's own constraint.
   *
   * `ObservationDraft` carries an index signature so `use-form-draft` can walk
   * it, and widening that to admit a number would let every other field become
   * one. "" is "no level chosen"; the form parses it back.
   */
  indicatorLevel: string;
  situation: string;
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
  const { hasRole, primaryKindergartenId } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  /*
    The kindergarten's strands. `assessment-config` is readable by every
    member — the same query the assessment screen makes, so this normally reads
    a warm cache rather than a request.
  */
  const config = useQuery({
    queryKey: qk.assessmentConfig(primaryKindergartenId ?? ""),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/assessment-config`, assessmentConfigSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
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

  /*
    ★ Resolved rather than asked for — 2026-09-11, "Ажиглалтын төрөл энийг хас".

    Every route into this form names the kind: the hub's Шинэ тэмдэглэл tile and
    the assessment sheet's type buttons both link with `?typeId=`, so the select
    was a required field whose answer the screen already had. Removing it means
    the one case it *was* load-bearing — an old bookmark, a link without the
    parameter — has to be answered here instead, or Хадгалах would fail on a
    field the teacher can no longer see.

    `daily` first, then whatever the kindergarten configured first: the everyday
    observation is the overwhelming majority of notes, and a kindergarten that
    renamed or reordered its types still gets a real one rather than none.
  */
  useEffect(() => {
    if (typeId) return;
    const rows = types.data ?? [];
    const fallback = rows.find((row) => row.code === "daily") ?? rows[0];
    if (fallback) setTypeId(fallback.id);
  }, [typeId, types.data]);
  // The date is not restored. A draft opened the next morning should be filed
  // under the day it is being written, not the day it was abandoned.
  const [observedOn, setObservedOn] = useState(todayLocal());
  const [observedTime, setObservedTime] = useState(draft?.observedTime ?? "");
  const [activityName, setActivityName] = useState(draft?.activityName ?? "");
  /**
   * Which development strand this note is about.
   *
   * ★ One, not the array's ten. The client's design has a single select, and a
   * note about one moment is about one thing — `domainIds` still takes an
   * array because the review screen tags several after the fact.
   */
  const [domainId, setDomainId] = useState(draft?.domainId ?? "");

  /*
    ★ Бүтээл files itself under Зураг, урлал — 2026-09-12, at the client's
    request: "бүтээлд дүн шинжилгээ хийх хэсгийг сонгон шинээр бичихэд
    сургалтын чиглэл автоматаар зураг урлал сонгогдоно, учир нь бүтээлд дан
    зураг бүтээлүүд ордог."

    An artwork note is about a drawing or a craft by definition, so the strand
    was a required answer this screen already had — and it is exactly the answer
    a teacher skips, which is what left "Сургалтын чиглэлийн хамралт" counting
    almost nothing (the note on the field below tells that story).

    Only while the field is empty, so a restored draft and a teacher's own
    choice both stand: `creative` is offered, not enforced. The type cannot
    change under it either — the type select was removed on 2026-09-11 and
    `?typeId=` is fixed for the life of the form — so "empty" is the whole of
    the guard this needs.

    Matched on `code`, not on the name: a strand is a row an administrator may
    rename (§2.3), and the code is the part that does not move. A kindergarten
    with no `creative` strand simply gets the field it had, unfilled.
  */
  useEffect(() => {
    if (domainId) return;
    const code = (types.data ?? []).find((row) => row.id === typeId)?.code;
    if (code !== "artwork") return;
    const creative = (config.data?.domains ?? []).find((domain) => domain.code === "creative");
    if (creative) setDomainId(creative.id);
  }, [domainId, typeId, types.data, config.data]);
  /** Which СҮД indicator this note evidences, and the level judged. */
  const [indicatorId, setIndicatorId] = useState(draft?.indicatorId ?? "");
  const [indicatorLevel, setIndicatorLevel] = useState(draft?.indicatorLevel ?? "");
  /** Whether the teacher has touched the level, which stops the age reclaiming it. */
  const [levelTouched, setLevelTouched] = useState(Boolean(draft?.indicatorLevel));
  const [switching, setSwitching] = useState(false);
  /**
   * Photographs chosen but not yet uploaded — the client's "Зураг / Видео
   * (0/5)".
   *
   * ★ Held, not uploaded on pick, and deliberately outside the draft.
   *
   * The design attaches them before the note exists, and a photograph cannot
   * be attached to an observation that has no id — so they wait here and go up
   * behind the one Save press. `use-form-draft` persists to `localStorage`,
   * which cannot hold a `File`: a restored draft brings back every word and no
   * pictures, which is the honest half rather than a crash.
   */
  const [photos, setPhotos] = useState<File[]>([]);
  /**
   * Set while the photographs are going up, after the note itself has saved.
   *
   * The confirmation card says so, because the alternative is a teacher pressing
   * Дуусгах two seconds into a five-photograph upload with nothing on screen
   * suggesting anything is still happening.
   */

  /*
    The chosen strand's indicators. Asked for only once a strand is chosen —
    the endpoint requires `domainId` for that reason, so the whole curriculum
    is never one request away.
  */
  const indicators = useQuery({
    queryKey: qk.curriculumIndicators(primaryKindergartenId ?? "", domainId),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/curriculum-indicators?domainId=${domainId}`,
        indicatorsSchema,
      ),
    enabled: Boolean(primaryKindergartenId && domainId),
    staleTime: 5 * 60_000,
  });

  const [situation, setSituation] = useState(draft?.situation ?? "");
  const [visibleToParents, setVisibleToParents] = useState(draft?.visibleToParents ?? false);
  const [includeInReport, setIncludeInReport] = useState(draft?.includeInReport ?? true);

  /*
   * ★ Only the text is persisted, plus the two visibility choices.
   *
   * Photos are not, and since 2026-09-11 that is a real loss rather than a
   * non-issue: the form now holds a selection of its own. `localStorage` cannot
   * hold a `File`, so a restored draft brings back every word and no pictures
   * — the honest half, and the alternative is reading five photographs into
   * base64 on every keystroke.
   */
  const { clear: clearDraft } = useDraftAutosave<ObservationDraft>(draftKey, {
    typeId,
    observedTime,
    activityName,
    domainId,
    indicatorId,
    indicatorLevel,
    situation,
    visibleToParents,
    includeInReport,
  });

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
          },
        });
      }

      return mutate(`/children/${childId}/observations`, observationSchema, {
        method: "POST",
        body: {
          typeId,
          observedOn,
          activityName: optional(activityName),
          ...(observedTime ? { observedTime } : {}),
          // An empty select sends nothing rather than an empty array, which the
          // schema would accept and the service would store as "tagged with
          // nothing" — indistinguishable from a note nobody classified.
          ...(domainId ? { domainIds: [domainId] } : {}),
          /*
            ★ The level goes only with the indicator.

            The API refuses one without the other rather than storing half a
            judgement, so sending a level for an indicator that was cleared
            would be an error the teacher never caused.
          */
          ...(indicatorId ? { indicatorId } : {}),
          ...(indicatorId && indicatorLevel ? { indicatorLevel: Number(indicatorLevel) } : {}),
          situation: optional(situation),
          visibleToParents,
          includeInReport,
        },
      });
    },
    onSuccess: async (observation) => {
      /*
        ★ After the note, never before: `POST /children/:id/media` needs an
        observation to attach to.

        Failures are reported and the note is kept. A photograph that did not
        upload is recoverable from the screen below — the note is not, and
        rolling it back to keep the two consistent would throw away the writing
        to save the picture.
      */
      if (photos.length > 0) {
        try {
          const result = await uploadChildPhotos({
            childId,
            files: photos,
            observationId: observation.id,
            purpose: "OBSERVATION",
          });
          if (result.failed.length > 0) {
            toast.error(`${result.failed.length} зураг хавсрагдсангүй.`);
          }
          void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
        } catch (error: unknown) {
          toast.error(errorMessage(error));
        }
      }
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
      // Replace the compose route so Back never reopens the form that was just
      // submitted; it returns to the screen the teacher came from instead.
      router.replace(listHref);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const childGroup = child.data?.enrollments?.find((row) => row.group)?.group?.name;
  /*
    ★ The age fills the level in, once, and only while the teacher has not.

    `levelTouched` is what makes it a suggestion rather than a correction: a
    teacher who moved it to II must not have it snap back when the child query
    refetches in the background.

    ★★ It no longer waits for an indicator — 2026-09-11, "эхлээд түвшин
    харагдана … дараа нь багш сүд код сонгох".

    The level used to be drawn from the chosen indicator's own rows, which put
    it *after* the code and made it fall to whichever level that indicator
    happened to carry. The order is now the other way round, and it is the
    better one: the level is a fact about the child, the same four for every
    indicator, and with it chosen first the codes below can each read out what
    they mean *at that level* — which is the whole reason the text is worth
    showing.
  */
  const suggestedLevel = levelForAge(ageInYears(child.data?.dateOfBirth));
  useEffect(() => {
    if (levelTouched || !suggestedLevel) return;
    setIndicatorLevel(String(suggestedLevel));
  }, [levelTouched, suggestedLevel]);

  /*
    The codes offered at the level now chosen, each with what it says there.

    ★ An indicator the curriculum does not write at this level is not offered.

    Fourteen of the seventy-one begin at II or III — the behaviour does not
    exist earlier — so at I the list is 58 codes rather than 71. This is what
    "сүд код түвшингөөс хамааран бас өөрчлөгдөнө" comes to against the real
    curriculum: dropping the codes that say nothing at this level, and changing
    the text of the ones that do.

    ★★ The code itself is written at the level too — `ХЭМ1н` is shown as
    `ХЭМ4.1н`, because that is what the curriculum calls it at IV.

    The stored code carries the strand, the standard and the letter, which is
    what identifies one indicator across its four levels; the level digit is
    spliced back in for display by `curriculumCodeAtLevel`. The import dropped
    it, and the client found the picker offering `ХЭМ1н` the same day.

    ★★★ It is *not* a filter on that digit, which is the mistake next door.
    `ХЭМ1н`'s "1" is the standard number inside the strand, and every standard
    is taught at all four levels — `ХӨГ` has only standard 1 and carries text at
    I, II, III and IV. Matching the standard against the level would show a
    teacher no codes at all for four of the seven strands above level II.
  */
  const levelCodes = useMemo(
    () =>
      (indicators.data ?? []).flatMap((indicator) => {
        const written = indicator.levels.find((row) => String(row.level) === indicatorLevel);
        if (!written) return [];
        return [
          {
            id: indicator.id,
            code: curriculumCodeAtLevel(indicator.code, written.level),
            text: written.text,
          },
        ];
      }),
    [indicators.data, indicatorLevel],
  );

  /*
    A code chosen at one level, then dropped by moving to another, must not stay
    in the body — the API would store a judgement at a level the curriculum does
    not describe.
  */
  useEffect(() => {
    // Only once the list has actually arrived. Clearing while the query is in
    // flight would wipe the code a restored draft brought back, on the one
    // render where every list is empty.
    if (!indicatorId || !indicators.isSuccess) return;
    if (levelCodes.some((row) => row.id === indicatorId)) return;
    setIndicatorId("");
  }, [indicatorId, indicators.isSuccess, levelCodes]);

  const errors = fieldErrors(save.error);

  /*
    ★ Where leaving this form lands — the child's notes of this kind, not their
    record.

    Client, 2026-09-11: "Цуцлах дээр дарахаар хүүхдийн дэлгэрэнгүй рүү ороод
    байна. Ингэхгүйгээр хүүхдийн ажиглалт хэсэг рүү ормоор байна." Saving,
    cancelling and Back all mean "done with this form", and the useful next
    screen is the same one for all three: the list the note either joined or
    did not.

    The type code rather than the id, because that is what the list route reads
    to pick which hub it draws.
  */
  const typeCode = (types.data ?? []).find((type) => type.id === typeId)?.code;
  const listHref = `/children/${childId}/observations${
    typeCode ? `?type=${encodeURIComponent(typeCode)}` : ""
  }`;

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
    <div className="page-band mx-auto w-full max-w-3xl py-2">
      <header>
        {/*
          ★ A bare Буцах, not "Ганболдын Батбаяр луу буцах" — 2026-09-11, at the
          client's instruction.

          The name was redundant twice over: the child is named again in the card
          directly below, and this link claimed a destination the reader may
          never have come from. `BackButton` goes one step back through history
          with the child's page as the fallback for a form opened cold.
        */}
        <BackButton href={listHref} className="-ml-3" />
        <h1 className="mt-0.5 text-title font-semibold tracking-[-.01em] text-ink md:text-heading">
          {isStaff ? "Ажиглалт шинээр бичих" : "Гэрийн мөч хуваалцах"}
        </h1>
        {!isStaff ? (
          <p className="mt-1.5 text-body text-muted">Таны бичсэнийг багш хянаад хавтаст нэмнэ.</p>
        ) : null}
      </header>

      {/*
        ★ The child, named with their age and group and a way to change them —
        the client's 2026-09-11 design.

        The link above the title already carries the name, but it is a way
        *back*; this is a statement of who the note is about, which is the one
        thing a teacher must not get wrong on this screen. Солих is beside it
        because writing notes is done down a roster, and the commonest next
        action after finishing one child is the same form for the next.
      */}
      {isStaff && child.data ? (
        <Card pad="compact" className="flex items-center gap-3">
          <ChildAvatar child={child.data} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-semibold leading-snug text-ink">
              {fullName(child.data)}
            </p>
            <p className="truncate text-caption text-muted">
              {formatAge(child.data.dateOfBirth)}
              {childGroup ? ` · ${childGroup}` : ""}
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => setSwitching(true)}>
            <Users size={15} aria-hidden="true" />
            Солих
          </Button>
        </Card>
      ) : null}

      {switching ? (
        <ChildPickerDialog
          selectedId={childId}
          onClose={() => setSwitching(false)}
          onSelect={(next) => {
            /*
              The draft belongs to the child it was written about — switching
              carries the type across and nothing else, because a sentence
              about one child is not a sentence about another.
            */
            if (next !== childId) {
              router.push(`/children/${next}/observations/new?typeId=${typeId}`);
            }
          }}
        />
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (save.isPending) return;
          save.mutate();
        }}
        className="flex flex-col gap-3"
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

        <Card pad="compact" className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5">
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

            {/*
              ★ Optional, and left empty by default — the client's "Цаг".

              A note filed without one happened that day and no more precisely,
              which is the truth for most of them. Prefilling the current time
              would record when the note was typed up rather than when the
              moment happened, and a teacher writing up yesterday's morning
              would have to notice and correct it.
            */}
            {isStaff ? (
              <Field label="Цаг" error={errors.observedTime}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type="time"
                    value={observedTime}
                    onChange={(e) => setObservedTime(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
          </div>

          {isStaff ? (
            <div className="grid grid-cols-2 gap-2.5">
              {/*
                ★ A list, not a free-text box — 2026-09-11, the client's design.

                `Observation.activityName` is a `String?` and stays one: the
                thirteen stages of the day are what a teacher picks from, and
                typing them produced "Өглөөний цай", "өглөөний цай" and
                "Өглөөний цай " as three activities on the coverage screen. The
                same reference list `group-coverage.tsx` groups by, so the
                breakdown and the form cannot disagree about what an activity
                is called.
              */}
              <Field label="Үйл ажиллагааны төрөл" error={errors.activityName}>
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={activityName}
                    onChange={(e) => setActivityName(e.target.value)}
                  >
                    <option value="">Сонгоно уу</option>
                    {DAILY_ACTIVITIES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {/*
                ★ The development strand, which this form never asked for.

                `domainIds` has been on `createObservationSchema` since it was
                written and only the review screen ever set it — so every note
                a teacher filed arrived untagged, and "Сургалтын чиглэлийн
                хамралт" counted almost nothing. One strand per note rather
                than the array's ten: the client's design has one select, and a
                note about one moment is about one thing.
              */}
              <Field label="Сургалтын чиглэл" error={errors.domainIds}>
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={domainId}
                    onChange={(e) => {
                      setDomainId(e.target.value);
                      // The codes belong to the strand, so changing it leaves
                      // the old one naming an indicator from somewhere else.
                      setIndicatorId("");
                    }}
                  >
                    <option value="">Сонгоно уу</option>
                    {(config.data?.domains ?? []).map((domain) => (
                      <option key={domain.id} value={domain.id}>
                        {domain.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          ) : null}

          {/*
            ★ Four cards, not a select — the client's 2026-09-11 design.

            The four levels are not interchangeable options: they are a scale,
            and choosing one means judging where a child sits on it. A select
            shows one at a time and hides the thing being judged against; four
            cards side by side put the whole scale in front of the teacher,
            which is what makes the choice a judgement rather than a guess.

            ★★ Between the strand and the code, and always drawn.

            The client's order, revised twice on 2026-09-11: the level goes
            after Сургалтын чиглэл and before СҮД код ("түвшин сургалтын
            чиглэлийн дараа байна"). It arrives already chosen from the child's
            age (2→I, 3→II, 4→III, 5→IV) and stops suggesting the moment a
            teacher touches it. Sitting above the code is what lets each code
            read out what it means at that level, and be dropped when it says
            nothing there at all.
          */}
          {isStaff ? (
            <fieldset>
              <legend className="mb-1.5 text-body font-medium text-ink">Түвшин</legend>

              <div role="radiogroup" aria-label="Түвшин" className="grid grid-cols-4 gap-1.5">
                {LEVELS.map((level) => {
                  const chosen = String(level) === indicatorLevel;

                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => {
                        setIndicatorLevel(String(level));
                        setLevelTouched(true);
                      }}
                      className={cn(
                        "grid min-h-[44px] place-items-center rounded-control border text-body font-semibold transition-colors",
                        chosen
                          ? "border-primary bg-primary-soft text-primary"
                          : "border-border bg-surface text-muted hover:bg-canvas",
                      )}
                    >
                      {LEVEL_NAME[level]} түвшин
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {/*
            ★ СҮД — the curriculum indicator this note evidences.

            Drawn only once a strand is chosen, because the codes belong to the
            strand: an empty picker above an unanswered question is a control
            that asks for something the screen has not made possible yet.

            ★★ Each option carries the code *and* what it says, in full —
            2026-09-11, "сүд кодуудын арын бичвэр текст бүрэн бичээд оруулаад
            өг".

            The codes are the client's own notation and nobody memorises
            seventy-one of them, so a list of bare codes is a control a teacher
            cannot answer. The descriptor was a tinted paragraph *below* the
            select, which meant reading it only after guessing — the text has to
            be on the options themselves to be any use in choosing between them.
            Which text depends on the level, chosen just above.
          */}
          {isStaff && domainId ? (
            <Field label="СҮД код" error={errors.indicatorId}>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  // The trigger truncates what the popup shows in full: an
                  // option is a paragraph, and a 48px control cannot hold one
                  // without pushing the chevron off the row.
                  className="[&>span:first-child]:min-w-0 [&>span:first-child]:truncate [&>span:first-child]:text-left"
                  value={indicatorId}
                  onChange={(e) => setIndicatorId(e.target.value)}
                  disabled={indicators.isLoading}
                >
                  <option value="">Сонгоно уу</option>
                  {levelCodes.map((row) => (
                    <option key={row.id} value={row.id}>
                      {`${row.code} — ${row.text}`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </Card>

        {!isStaff ? (
          <ObservationPhotoPicker files={photos} onChange={setPhotos} disabled={save.isPending} />
        ) : null}

        {/*
          ★ One box called Тэмдэглэл — 2026-09-11, at the client's request.

          This was a "Юу болсон бэ?" section holding three textareas —
          Ажиглагдсан байдал, Хүүхэд юу хийсэн бэ?, Хүүхдийн хэлсэн үг — and
          below it a "Багшийн дүгнэлт" section holding two more, Тайлбар and
          Дараагийн алхам. Five boxes and two headings to file one moment, and
          the client's answer was to delete all of it and keep the writing:
          "энэ 2 арилаад зүгээр тэмдэглэл болго".

          `situation` is what stays, so every note already written keeps its
          text where the list and the PDF already look for it. The other four
          columns are untouched and still render wherever a note is read — the
          form stops asking for them, it does not erase them.
        */}
        <Card pad="compact">
          <Field label="Тэмдэглэл" error={errors.situation} hint={`${situation.length}/1000`}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                rows={4}
              />
            )}
          </Field>
        </Card>

        {/*
          ★ Two checkboxes in one compact card — 2026-09-11, "хэн харахыг зай
          бага эзлэхээр болго".

          The "Хэн харах вэ?" heading and the second checkbox's description were
          three lines of chrome around two taps, at the bottom of a phone screen
          the teacher is trying to get to the end of. The labels already say
          what each one does.
        */}
        {isStaff ? (
          <Card className="grid grid-cols-3 gap-2 px-3 py-3">
            <ObservationPhotoPicker
              files={photos}
              onChange={setPhotos}
              disabled={save.isPending}
              compact
            />
            {/*
              ★ Unchecked by default, matching the API's own default. A
              teacher's working note is private until they deliberately share
              it; a checkbox that starts on would publish notes nobody meant to
              publish.
            */}
            <Checkbox
              label="Эцэг эх харах боломжтой"
              className="min-w-0 flex-col items-center justify-center gap-1 px-1 text-center [&>span]:text-caption"
              checked={visibleToParents}
              onChange={(e) => setVisibleToParents(e.target.checked)}
            />
            <Checkbox
              label={`${PORTFOLIO}ны PDF-д оруулах`}
              className="min-w-0 flex-col items-center justify-center gap-1 px-1 text-center [&>span]:text-caption"
              checked={includeInReport}
              onChange={(e) => setIncludeInReport(e.target.checked)}
            />
          </Card>
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href={listHref}>Цуцлах</Link>
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
