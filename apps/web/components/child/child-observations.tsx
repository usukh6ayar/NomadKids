"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Eye, EyeOff, Pencil, Plus, Trash2, Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  MAX_PAGE_SIZE,
  ARTWORK_TYPES,
  assessmentConfigSchema,
  curriculumCodeAtLevel,
  curriculumIndicatorSchema,
  observationSchema,
  observationTypeSchema,
  paginated,
  termSchema,
  localDate,
} from "@kinder/contracts";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { termNumberForDay } from "@/lib/terms";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { Art } from "@/components/ui/art";
import { MediaThumb } from "@/components/media/media-image";
import { ObservationRow } from "@/components/observations/observation-row";
import { ObservationPhotos } from "@/components/observations/observation-photos";
import { DAILY_ACTIVITIES } from "@/components/assessment/group-coverage";
import { PORTFOLIO } from "@/lib/vocabulary";
import { excerpt, formatDate, formatLongDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const observationsSchema = paginated(observationSchema);
const termsSchema = z.array(termSchema);
const observationTypesSchema = z.array(observationTypeSchema);
const curriculumIndicatorsSchema = z.array(curriculumIndicatorSchema);

type Observation = z.infer<typeof observationSchema>;

type ParentCategoryCode = "daily" | "conversation" | "artwork";

/** One quarter and the notes that fall inside it. */
export interface Quarter {
  key: string;
  label: string;
  items: Observation[];
  /** Whether today falls inside this quarter — decides what opens first. */
  current: boolean;
}

/**
 * The "Ажиглалт" tab, grouped by quarter.
 *
 * ★ The API decides what a viewer sees, not this component.
 *
 * A guardian's `GET /children/:id/observations` simply does not contain a
 * teacher's private notes — the filtering is server-side, as it has to be, and
 * `isStaff` here only changes the wording and whether the review state is shown.
 * If this component ever starts hiding rows itself, the mobile client will
 * answer differently.
 *
 * ★★ Quarters, at the client's 2026-08-31 request, and the grouping is derived
 * rather than stored.
 *
 * An observation has an `observedOn` date and no term; a `Term` has a number and
 * a date range. Which quarter a note belongs to is therefore a question about
 * those two, answered here — adding a `termId` column would mean every note
 * written before a term's dates were corrected would keep pointing at the old
 * quarter, and the administrator who fixed the dates would have no way to know.
 *
 * ★★★ The whole list, not the first ten.
 *
 * This fetched `pageSize=10` and said so in a footnote. Ten notes spread over
 * four quarters would leave three of them looking empty when they are not —
 * a grouped view has to have everything in it or the groups lie. `MAX_PAGE_SIZE`
 * is the API's own ceiling (100), which a single child's notes stay far inside.
 */
export function ChildObservations({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  const { primaryKindergartenId } = useSession();

  /*
   * ★ No `enabled` guard, because there is nothing to guard.
   *
   * Radix unmounts an inactive `Tabs.Content`, so this component does not exist
   * until its tab is opened and the query cannot fire early — verified rather
   * than assumed (`flows.test.tsx`, "does not fetch a tab's data until the tab
   * is opened"). An `enabled` prop derived from the URL alongside it would be a
   * second source of truth for the same fact, and the two can disagree.
   */
  const observations = useQuery({
    queryKey: qk.childObservations(childId, { pageSize: MAX_PAGE_SIZE }),
    queryFn: () =>
      get(`/children/${childId}/observations?page=1&pageSize=${MAX_PAGE_SIZE}`, observationsSchema),
  });

  /*
    The quarters themselves. Readable by any member — `GET /kindergartens/:id/
    terms` carries no `@Roles`, unlike the POST beside it — so a parent gets the
    same grouping a teacher does rather than a flat list nobody asked for.
  */
  const terms = useQuery({
    queryKey: qk.terms(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/terms`, termsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  if (observations.isPending) return <LoadingState rows={3} />;
  if (observations.isError) return <ErrorState description={errorMessage(observations.error)} />;

  const items = observations.data.items;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Image src="/background/mascot-robot.webp" alt="" width={96} height={96} />}
        title={isStaff ? "Ажиглалт бичигдээгүй байна" : "Одоогоор мөч хуваалцаагүй байна"}
        description={
          isStaff
            ? "Энэ хүүхдийн талаар анхны ажиглалтаа бичнэ үү."
            : "Багшийн хуваалцсан ажиглалт энд харагдана."
        }
        action={
          <Button asChild>
            <Link href={`/children/${childId}/observations/new`}>
              {isStaff ? "Ажиглалт бичих" : "Мөч хуваалцах"}
            </Link>
          </Button>
        }
      />
    );
  }

  const quarters = groupByQuarter(items, terms.data ?? []);

  /*
    ★ Falls back to a flat list only when there are no terms at all.

    A kindergarten whose administrator has not set up terms yet (the state
    `/admin/terms` exists to fix, and which its own empty copy describes) has no
    quarters to group by, and an accordion with nothing to divide is a control
    that only ever does one thing — worse than the plain list this screen was.

    The condition is `=== 0`, not `<= 1`, and the difference is a real one that
    a test caught: a child whose notes all fall in one quarter still gets that
    quarter's heading. It names the period the notes belong to, which is the
    point of the grouping, and it keeps the screen's shape stable as the year
    goes on rather than sprouting an accordion the first week of the second
    term.
  */
  if (quarters.length === 0) {
    return (
      <Card className="divide-y divide-border">
        {items.map((observation) => (
          <ObservationRow key={observation.id} observation={observation} showVisibility={isStaff} />
        ))}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {quarters.map((quarter) => (
        <QuarterSection key={quarter.key} quarter={quarter} isStaff={isStaff} />
      ))}
    </div>
  );
}

/**
 * One collapsible quarter.
 *
 * ★ `<details>`, not a `useState` accordion.
 *
 * The element opens and closes without JavaScript, is focusable and operable
 * from the keyboard for free, and is announced as expandable by every screen
 * reader — three behaviours a `div` with an `onClick` has to reimplement and
 * usually gets partly wrong. It is also what the reference build's own
 * `nav-group` uses, so the product already has one accordion idiom rather than
 * two.
 *
 * `open` is an uncontrolled default: the current quarter starts expanded, and
 * after that the reader decides. A controlled `open` would slam every other
 * section shut whenever the query refetched in the background.
 */
function QuarterSection({ quarter, isStaff }: { quarter: Quarter; isStaff: boolean }) {
  return (
    <details
      open={quarter.current}
      className="group overflow-hidden rounded-card border border-border bg-surface"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-canvas">
        <ChevronDown
          size={18}
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform group-open:rotate-180"
        />
        <span className="flex-1 text-body font-semibold text-ink">{quarter.label}</span>
        {/*
          The count belongs on the closed row: it is the only thing that says
          whether opening this is worth the tap.
        */}
        <span className="shrink-0 text-caption tabular-nums text-muted">
          {quarter.items.length} тэмдэглэл
        </span>
      </summary>

      <div className="divide-y divide-border border-t border-border">
        {quarter.items.map((observation) => (
          <ObservationRow key={observation.id} observation={observation} showVisibility={isStaff} />
        ))}
      </div>
    </details>
  );
}

/**
 * Files each note under the quarter whose dates contain it.
 *
 * ★ Every note lands somewhere, including the ones that fit nowhere.
 *
 * A note written in the summer holiday, or before the first term was created,
 * falls outside every range. Dropping those would make the quarter counts sum
 * to less than the list — a breakdown whose parts do not add up is one nobody
 * can check — so they collect in "Бусад хугацаа" at the end.
 *
 * ★★ Empty quarters are omitted. A term with no notes in it is a heading that
 * costs a tap to discover there is nothing behind it; the client's drawing
 * shows counts precisely so a reader can skip.
 */
export function groupByQuarter(
  items: Observation[],
  terms: z.infer<typeof termsSchema>,
): Quarter[] {
  const dated = terms
    .filter((term) => term.startsOn && term.endsOn)
    .sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn)));

  if (dated.length === 0) return [];

  const today = localDate();
  const buckets = new Map<string, Observation[]>();
  const other: Observation[] = [];

  for (const observation of items) {
    /*
      Compared as `yyyy-mm-dd` strings rather than as `Date`s. `observedOn` is a
      calendar day and the term bounds are calendar days; parsing them into
      instants would put an observation on a term's last day into the next
      quarter for anyone east of UTC, which is everyone here.
    */
    const day = observation.observedOn.slice(0, 10);
    const term = dated.find(
      (candidate) => day >= String(candidate.startsOn) && day <= String(candidate.endsOn),
    );

    if (!term) {
      other.push(observation);
      continue;
    }

    const bucket = buckets.get(term.id);
    if (bucket) bucket.push(observation);
    else buckets.set(term.id, [observation]);
  }

  const quarters: Quarter[] = dated
    .filter((term) => (buckets.get(term.id)?.length ?? 0) > 0)
    .map((term) => ({
      key: term.id,
      label: term.name,
      items: buckets.get(term.id) ?? [],
      current: today >= String(term.startsOn) && today <= String(term.endsOn),
    }));

  if (other.length > 0) {
    quarters.push({
      key: "other",
      label: "Бусад хугацаа",
      items: other,
      // Never the one that opens by default: it is the leftovers, not the
      // quarter somebody came to read.
      current: false,
    });
  }

  /*
    Nothing is "current" outside term time — a summer reader would otherwise
    open a screen with every section shut. The most recent quarter with notes in
    it is the one they were last looking at.
  */
  if (quarters.length > 0 && !quarters.some((quarter) => quarter.current)) {
    const last = quarters.filter((quarter) => quarter.key !== "other").at(-1) ?? quarters[0]!;
    last.current = true;
  }

  return quarters;
}

/**
 * The parent's compact note library. It intentionally includes text-only
 * records: the empty state is about whether a note exists, not whether that
 * note happens to carry a photograph.
 */
export function SharedMomentsTeaser({
  childId,
  categoryCode,
  title,
  onAdd,
  composer,
}: {
  childId: string;
  categoryCode: ParentCategoryCode;
  title: string;
  onAdd: () => void;
  composer?: ReactNode;
}) {
  const { primaryKindergartenId } = useSession();

  const observations = useQuery({
    queryKey: qk.childObservations(childId, { pageSize: MAX_PAGE_SIZE }),
    queryFn: () =>
      get(`/children/${childId}/observations?page=1&pageSize=${MAX_PAGE_SIZE}`, observationsSchema),
  });

  const terms = useQuery({
    queryKey: qk.terms(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/terms`, termsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  return (
    <section aria-label={title}>
      {/*
        ★ No repeated title here.
        The bucket's name is already the label on the button above that
        selected it; showing it again as a heading was a button-less repeat
        of a word already on screen. The "+" is all this row needs — `title`
        still names the section for a screen reader and the add button's
        accessible name.
      */}
      <div className="mb-2.5 flex justify-end">
        <Button size="icon" className="rounded-pill" aria-label={`${title} нэмэх`} onClick={onAdd}>
          <Plus aria-hidden="true" />
        </Button>
      </div>

      {composer ? <div className="mb-4">{composer}</div> : null}

      {observations.isPending ? <LoadingState rows={2} /> : null}
      {observations.isError ? <ErrorState description={errorMessage(observations.error)} /> : null}

      {!observations.isPending && !observations.isError ? (
        <MomentsFeed
          childId={childId}
          items={observations.data.items}
          terms={terms.data ?? []}
          categoryCode={categoryCode}
        />
      ) : null}
    </section>
  );
}

function MomentsFeed({
  childId,
  items,
  terms,
  categoryCode,
}: {
  childId: string;
  items: Observation[];
  terms: z.infer<typeof termsSchema>;
  categoryCode: ParentCategoryCode;
}) {
  const { session } = useSession();
  const [source, setSource] = useState<"all" | "TEACHER" | "PARENT">("all");
  const [selectedTerm, setSelectedTerm] = useState<number | null>(null);
  const [detail, setDetail] = useState<Observation | null>(null);
  const [editing, setEditing] = useState<Observation | null>(null);
  const [deleting, setDeleting] = useState<Observation | null>(null);
  const userId = session?.user.id ?? null;
  const termNumber = selectedTerm ?? termNumberForDay(todayIso(), terms);

  const shown = items.filter((observation) => {
    const code = observation.type?.code === "parent" ? "daily" : observation.type?.code;
    return (
      code === categoryCode &&
      (source === "all" || observation.source === source) &&
      termNumberForDay(observation.observedOn.slice(0, 10), terms) === termNumber
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3">
        <div className="max-w-[220px]">
          <Field label="Улирал">
            {({ id }) => (
              <Select
                id={id}
                value={String(termNumber)}
                onChange={(event) => setSelectedTerm(Number(event.target.value))}
              >
                <option value="1">1-р улирал</option>
                <option value="2">2-р улирал</option>
                <option value="3">3-р улирал</option>
              </Select>
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Тэмдэглэлийн эх сурвалж">
          <Button
            size="sm"
            variant={source === "TEACHER" ? "primary" : "secondary"}
            aria-pressed={source === "TEACHER"}
            onClick={() => setSource((current) => (current === "TEACHER" ? "all" : "TEACHER"))}
          >
            Багшийн тэмдэглэл
          </Button>
          <Button
            size="sm"
            variant={source === "PARENT" ? "primary" : "secondary"}
            aria-pressed={source === "PARENT"}
            onClick={() => setSource((current) => (current === "PARENT" ? "all" : "PARENT"))}
          >
            Эцэг эхийн тэмдэглэл
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Тэмдэглэл ороогүй" />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((observation) => {
            const canManage = Boolean(
              userId && observation.source === "PARENT" && observation.author?.id === userId,
            );
            return (
              <li key={observation.id}>
                <MomentCard
                  observation={observation}
                  canManage={canManage}
                  onOpen={() => setDetail(observation)}
                  onEdit={() => setEditing(observation)}
                  onDelete={() => setDeleting(observation)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <ObservationDetailDialog observation={detail} onClose={() => setDetail(null)} />
      {editing ? (
        <EditObservationDialog
          childId={childId}
          observation={editing}
          terms={terms}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <DeleteObservationDialog
        childId={childId}
        observation={deleting}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

/**
 * One note, as a card — the client's 2026-09-14 drawing.
 *
 * ★ The order is who · what kind · when, then the picture, then the words.
 *
 * It used to open with a coloured Багш/Эцэг эх badge beside the date and bury
 * the kind, the strand and the indicator in a grey row at the foot. A teacher
 * scanning a term is asking "what kind of note is this and when" before
 * anything else, and the two questions were the two things hardest to find.
 *
 * ★★ The date is numeric here, against `formatDayMonthLong` elsewhere.
 *
 * The client's card says `2025.09.10`, and on a card the date is a label being
 * matched against a register rather than a sentence being read. §5's Mongolian
 * rule is about the words; the written-out form is still what the note's own
 * screen and the conclusion's citation use.
 *
 * ★★★ Two of these sit side by side on a phone, at the client's instruction
 * ("бичсэн тэмдэглэл картууд утсанд 2 эгнээ харагддаг болго"), which is about
 * 160px of width. The type scale steps down for that width and back up from
 * `sm`: at `text-body` the date and the kind cannot share a line there, and a
 * pill that wraps under its own row is what makes a dense grid look broken.
 *
 * ★★★★ Эцэг эх харна is an icon with a name, not a worded badge.
 *
 * Same reason `BackButton` draws no label: the client asked for icons where
 * the meaning is already carried by the shape. `aria-label` keeps it findable
 * and announceable, so nothing is lost to a screen reader.
 */
export function MomentCard({
  observation,
  canManage,
  showPlaceholderArt = true,
  showTeacherMetadata = false,
  onOpen,
  onEdit,
  onDelete,
}: {
  observation: Observation;
  canManage: boolean;
  showPlaceholderArt?: boolean;
  showTeacherMetadata?: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="relative h-full rounded-card border border-border bg-surface shadow-sm transition-transform hover:-translate-y-0.5">
      <button
        type="button"
        className="flex h-full w-full flex-col gap-2 rounded-card p-3 text-left"
        onClick={onOpen}
      >
        <NoteCardFace
          observation={observation}
          showPlaceholderArt={showPlaceholderArt}
          showTeacherMetadata={showTeacherMetadata}
          reserveMenuSpace={canManage}
        />
      </button>
      {canManage ? (
        <RowMenu
          className="absolute right-1 top-1 rounded-pill bg-surface/90"
          ariaLabel="Тэмдэглэлийн үйлдэл"
          items={[
            {
              label: "Засах",
              icon: <Pencil size={16} aria-hidden="true" />,
              onSelect: onEdit,
            },
            {
              label: "Устгах",
              icon: <Trash2 size={16} aria-hidden="true" />,
              onSelect: onDelete,
              tone: "danger",
            },
          ]}
        />
      ) : null}
    </article>
  );
}

/**
 * The card's contents, without the card.
 *
 * ★ Extracted 2026-09-14, when the conclusion's note picker was asked to look
 * like this one — "Тэмдэглэлүүдээс сонгох гэдгийг ажиглалт дээрх тэмдэглэл
 * шигээ загвараар".
 *
 * The two differ only in what wrapping them means: here a button that opens
 * the note, there a label that ticks it. Copying the face would give the
 * product two note cards that start identical and drift, which is the argument
 * `ui/tone.ts`, `ui/quick-tile.tsx` and `ui/filter-chip.tsx` each record having
 * had already. Every element is a `<span>` or a `<p>` so it is legal inside
 * either wrapper.
 */
export function NoteCardFace({
  observation,
  showPlaceholderArt = true,
  showTeacherMetadata = false,
  reserveMenuSpace = false,
}: {
  observation: Observation;
  showPlaceholderArt?: boolean;
  showTeacherMetadata?: boolean;
  /** Keeps the top row clear of a ⋮ menu or a tick drawn over the corner. */
  reserveMenuSpace?: boolean;
}) {
  const photo = observation.media[0];
  const comment = observationText(observation);
  const domainLevel = observation.domains.find((entry) => entry.level)?.level?.label;
  const indicatorLevel = observation.indicatorLevel
    ? `${romanLevel(observation.indicatorLevel)} түвшин`
    : domainLevel;

  return (
    <>
      <span className="text-caption font-semibold italic text-primary">
        {observation.source === "PARENT" ? "Эцэг эх" : "Багш"}
      </span>

      {/* The kind and the day, with room kept for the ⋮ when there is one. */}
      <span
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-2 gap-y-1",
          reserveMenuSpace && "pr-7",
        )}
      >
        {observation.type?.name ? (
          <span
            className={cn(
              "rounded-pill px-2 py-0.5 text-caption font-medium text-white sm:px-2.5 sm:py-1",
              observationTypeTone(observation.type.code),
            )}
          >
            {observation.type.name}
          </span>
        ) : (
          <span />
        )}
        <span className="text-caption font-semibold text-ink sm:text-body">
          {formatDate(observation.observedOn)}
        </span>
      </span>

      {/*
          The frame around the picture is `cornflower-chart`, the nearest thing
          in the palette to the drawing's violet. An eighth accent is a palette
          decision and this is one border — see globals.css on how the seventh
          came to be added.
        */}
      {photo ? (
        <MediaThumb
          mediaId={photo.id}
          caption={photo.caption ?? comment}
          className="h-28 w-full border-2 border-cornflower-chart sm:h-32"
        />
      ) : showPlaceholderArt ? (
        <span className="flex h-28 w-full items-center justify-center rounded-control border-2 border-cornflower-chart bg-canvas sm:h-32">
          <Art name={artForObservation(observation)} size={64} className="size-16 object-contain" />
        </span>
      ) : null}

      {observation.activityName ? (
        <span className="text-caption font-semibold text-primary sm:text-body">
          {observation.activityName}
        </span>
      ) : null}

      <p className="line-clamp-3 text-caption leading-snug text-ink sm:text-body">
        {excerpt(comment || "Тэмдэглэл", 120)}
      </p>

      {showTeacherMetadata ? (
        <span
          className="mt-auto flex flex-wrap items-center gap-1.5 pt-1"
          aria-label="Тэмдэглэлийн сонголтууд"
        >
          {observation.domains.map((entry) => (
            <span
              key={entry.domain.id}
              aria-label={`Сургалтын чиглэл: ${entry.domain.name}`}
              className="rounded-pill bg-primary-soft px-2.5 py-1 text-caption font-semibold italic text-primary"
            >
              {entry.domain.name}
            </span>
          ))}
          {observation.indicator?.code ? (
            <span
              aria-label={`СҮД код: ${observation.indicator.code}`}
              className="rounded-pill bg-primary-soft px-2.5 py-1 text-caption font-semibold text-primary"
            >
              {observation.indicator.code}
            </span>
          ) : null}
          {indicatorLevel ? (
            <span
              aria-label={`Түвшин: ${indicatorLevel}`}
              className="rounded-pill bg-canvas px-2.5 py-1 text-caption text-muted"
            >
              {indicatorLevel}
            </span>
          ) : null}

          <span
            role="img"
            aria-label={observation.visibleToParents ? "Эцэг эх харна" : "Дотоод тэмдэглэл"}
            className={cn(
              "ml-auto grid size-7 shrink-0 place-items-center",
              observation.visibleToParents ? "text-mint-chart" : "text-faint",
            )}
          >
            {observation.visibleToParents ? (
              <Users size={18} aria-hidden="true" />
            ) : (
              <EyeOff size={16} aria-hidden="true" />
            )}
          </span>
        </span>
      ) : null}
    </>
  );
}

function romanLevel(level: number): string {
  return ["I", "II", "III", "IV"][level - 1] ?? String(level);
}

/** The record-kind badge directly below Багш: green, blue and orange. */
function observationTypeTone(code?: string | null): string {
  if (code === "conversation") return "bg-sky-solid";
  if (code === "artwork") return "bg-peach-solid";
  return "bg-mint-solid";
}

export function ObservationDetailDialog({
  observation,
  showTeacherMetadata = false,
  onClose,
}: {
  observation: Observation | null;
  showTeacherMetadata?: boolean;
  onClose: () => void;
}) {
  const text = observation ? observationText(observation) : "";
  const domainLevel = observation?.domains.find((entry) => entry.level)?.level?.label;
  const indicatorLevel = observation?.indicatorLevel
    ? `${romanLevel(observation.indicatorLevel)} түвшин`
    : domainLevel;

  return (
    <FormDialog
      open={Boolean(observation)}
      onOpenChange={(open) => !open && onClose()}
      title={observation?.type?.name ?? "Тэмдэглэл"}
      description={observation ? formatLongDate(observation.observedOn) : undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      {observation ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone={observation.source === "PARENT" ? "sky" : "mint"}>
              {observation.source === "PARENT" ? "Эцэг эхийн тэмдэглэл" : "Багшийн тэмдэглэл"}
            </Badge>
            {showTeacherMetadata ? (
              <>
                <Badge tone={observation.visibleToParents ? "mint" : "neutral"}>
                  {observation.visibleToParents ? (
                    <Eye size={12} aria-hidden="true" />
                  ) : (
                    <EyeOff size={12} aria-hidden="true" />
                  )}
                  {observation.visibleToParents ? "Эцэг эх харна" : "Дотоод"}
                </Badge>
                <Badge tone={observation.includeInReport ? "primary" : "neutral"}>
                  {observation.includeInReport ? "PDF-д орно" : "PDF-д орохгүй"}
                </Badge>
              </>
            ) : null}
          </div>

          {showTeacherMetadata ? (
            <Card pad="compact">
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailFact label="Огноо" value={formatLongDate(observation.observedOn)} />
                {observation.observedTime ? (
                  <DetailFact label="Цаг" value={observation.observedTime.slice(0, 5)} />
                ) : null}
                <DetailFact label="Тэмдэглэлийн төрөл" value={observation.type?.name ?? "—"} />
                {observation.activityName ? (
                  <DetailFact
                    label={observation.type?.code === "artwork" ? "Төрөл" : "Үйл ажиллагааны төрөл"}
                    value={observation.activityName}
                  />
                ) : null}
                {observation.domains.length > 0 ? (
                  <DetailFact
                    label="Сургалтын чиглэл"
                    value={observation.domains.map((entry) => entry.domain.name).join(", ")}
                  />
                ) : null}
                {indicatorLevel ? <DetailFact label="Түвшин" value={indicatorLevel} /> : null}
                {observation.indicator?.code ? (
                  <DetailFact label="СҮД код" value={observation.indicator.code} />
                ) : null}
              </dl>
            </Card>
          ) : null}

          {observation.media.length > 0 ? (
            <section aria-labelledby="observation-photos-title">
              <h3
                id="observation-photos-title"
                className="mb-2 text-caption font-semibold text-muted"
              >
                Зураг
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {observation.media.map((media) => (
                  <MediaThumb
                    key={media.id}
                    mediaId={media.id}
                    caption={media.caption ?? text}
                    className="w-full"
                  />
                ))}
              </div>
            </section>
          ) : null}
          <section
            aria-label={showTeacherMetadata ? undefined : "Тэмдэглэл"}
            aria-labelledby={showTeacherMetadata ? "observation-note-title" : undefined}
          >
            {showTeacherMetadata ? (
              <h3
                id="observation-note-title"
                className="mb-2 text-caption font-semibold text-muted"
              >
                Тэмдэглэл
              </h3>
            ) : null}
            <p className="whitespace-pre-wrap text-body text-ink">{text || "Тэмдэглэл"}</p>
          </section>
        </div>
      ) : null}
    </FormDialog>
  );
}

function DetailFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body font-semibold text-ink">{value}</dd>
    </div>
  );
}

/**
 * Тэмдэглэл засах — every field the note was written with.
 *
 * ★ The client, 2026-09-14: "анх бичихэд байсан бүх талбарууд харагдаж."
 *
 * This dialog used to offer a date, a term and one merged text box, and it
 * **erased** what it did not show: `childDid`, `childSaid`, `teacherComment`
 * and `nextSteps` were sent as `null` on every save, so correcting a typo in a
 * note filed through the older parent form silently dropped the rest of it.
 * The kind, the strand, the level, the СҮД code and the two visibility
 * choices could not be corrected at all — a note filed against the wrong
 * strand had to be deleted and written again.
 *
 * ★★ The same controls as the compose form, in the same order.
 *
 * A teacher who has filed a note knows this screen; an editor that asks the
 * same questions in a different order is a second form to learn. The two are
 * not one component because the compose form owns a draft, a photo queue and a
 * child picker that an editor has no use for — what they share is the
 * vocabulary, and that lives in `DAILY_ACTIVITIES`, `assessment-config` and
 * the curriculum endpoint rather than in either screen.
 *
 * ★★★ The merged text still merges, but only when it has to.
 *
 * `observationText` joins the five narrative columns for display. Saving that
 * join back into `situation` is right for a note that carries fragments from
 * the old five-box form — but only then, so a note whose text is already one
 * box round-trips unchanged and the other columns are left alone.
 */
export function EditObservationDialog({
  childId,
  observation,
  terms,
  onClose,
}: {
  childId: string;
  observation: Observation;
  terms: z.infer<typeof termsSchema>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasRole, primaryKindergartenId } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const [observedOn, setObservedOn] = useState(observation.observedOn.slice(0, 10));
  const [observedTime, setObservedTime] = useState(observation.observedTime?.slice(0, 5) ?? "");
  const [typeId, setTypeId] = useState(observation.type?.id ?? "");
  const [activityName, setActivityName] = useState(observation.activityName ?? "");
  const [domainId, setDomainId] = useState(observation.domains[0]?.domain.id ?? "");
  const [indicatorLevel, setIndicatorLevel] = useState(
    observation.indicatorLevel ? String(observation.indicatorLevel) : "",
  );
  const [indicatorId, setIndicatorId] = useState(observation.indicator?.id ?? "");
  const [situation, setSituation] = useState(observationText(observation));
  const [visibleToParents, setVisibleToParents] = useState(observation.visibleToParents);
  const [includeInReport, setIncludeInReport] = useState(observation.includeInReport ?? true);
  /* The fragments the old five-box form left behind — see ★★★ above. */
  const wasSplit = Boolean(
    observation.childDid ||
    observation.childSaid ||
    observation.teacherComment ||
    observation.nextSteps,
  );

  const types = useQuery({
    queryKey: qk.observationTypes(childId),
    queryFn: () => get(`/children/${childId}/observations/types`, observationTypesSchema),
    enabled: isStaff,
    staleTime: 5 * 60_000,
  });
  const selectedTypeCode =
    (types.data ?? []).find((type) => type.id === typeId)?.code ?? observation.type?.code;

  const config = useQuery({
    queryKey: qk.assessmentConfig(primaryKindergartenId ?? ""),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/assessment-config`, assessmentConfigSchema),
    enabled: Boolean(primaryKindergartenId) && isStaff,
    staleTime: 5 * 60_000,
  });

  /* Asked for only once a strand is chosen: the codes belong to the strand. */
  const indicators = useQuery({
    queryKey: qk.curriculumIndicators(primaryKindergartenId ?? "", domainId),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/curriculum-indicators?domainId=${domainId}`,
        curriculumIndicatorsSchema,
      ),
    enabled: Boolean(primaryKindergartenId && domainId) && isStaff,
    staleTime: 5 * 60_000,
  });

  /*
    The codes that say something at the chosen level — the same rule the
    compose form applies: an indicator with no text at this level is not an
    option at this level.
  */
  const levelCodes = (indicators.data ?? []).flatMap((indicator) => {
    const written = indicator.levels.find((row) => String(row.level) === indicatorLevel);
    if (!written) return [];
    return [
      {
        id: indicator.id,
        code: curriculumCodeAtLevel(indicator.code, written.level),
        text: written.text,
      },
    ];
  });

  const update = useMutation({
    mutationFn: () =>
      mutate(`/observations/${observation.id}`, observationSchema, {
        method: "PATCH",
        body: {
          observedOn,
          observedTime: observedTime || undefined,
          situation: situation.trim() || null,
          ...(isStaff
            ? {
                typeId: typeId || undefined,
                activityName: activityName || null,
                domainIds: domainId ? [domainId] : [],
                indicatorId: indicatorId || undefined,
                indicatorLevel: indicatorLevel ? Number(indicatorLevel) : undefined,
                visibleToParents,
                includeInReport,
              }
            : {}),
          /*
            Cleared only for a note that still carries the old form's
            fragments: they were merged into the box above, so leaving them
            would show the same sentences twice on the next render.
          */
          ...(wasSplit
            ? { childDid: null, childSaid: null, teacherComment: null, nextSteps: null }
            : {}),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      await queryClient.invalidateQueries({ queryKey: qk.childObservations(childId) });
      toast.success("Тэмдэглэл шинэчлэгдлээ.");
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(update.error);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Тэмдэглэл засах"
      busy={update.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            Болих
          </Button>
          <Button onClick={() => update.mutate()} disabled={update.isPending || !situation.trim()}>
            {update.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError message={update.isError ? errorMessage(update.error) : null} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Огноо" error={errors.observedOn}>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                max={todayIso()}
                value={observedOn}
                onChange={(event) => setObservedOn(event.target.value)}
              />
            )}
          </Field>
          <Field label="Улирал">
            {({ id }) => (
              <Select
                id={id}
                value={String(termNumberForDay(observedOn, terms))}
                onChange={(event) =>
                  setObservedOn(
                    firstAvailableDateForTerm(Number(event.target.value), todayIso(), terms),
                  )
                }
              >
                <option value="1">1-р улирал</option>
                <option value="2">2-р улирал</option>
                <option value="3">3-р улирал</option>
              </Select>
            )}
          </Field>
        </div>

        {isStaff ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Цаг" error={errors.observedTime}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="time"
                    value={observedTime}
                    onChange={(event) => setObservedTime(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Тэмдэглэлийн төрөл" error={errors.typeId}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={typeId}
                    onChange={(event) => setTypeId(event.target.value)}
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label={selectedTypeCode === "artwork" ? "Төрөл" : "Үйл ажиллагааны төрөл"}
                error={errors.activityName}
                required={selectedTypeCode === "artwork"}
              >
                {({ id }) => (
                  <Select
                    id={id}
                    value={activityName}
                    onChange={(event) => setActivityName(event.target.value)}
                  >
                    <option value="">Сонгоно уу</option>
                    {(selectedTypeCode === "artwork" ? ARTWORK_TYPES : DAILY_ACTIVITIES).map(
                      (name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ),
                    )}
                  </Select>
                )}
              </Field>
              <Field label="Сургалтын чиглэл" error={errors.domainIds}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={domainId}
                    onChange={(event) => {
                      setDomainId(event.target.value);
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

            <fieldset>
              <legend className="mb-1.5 text-body font-medium text-ink">Түвшин</legend>
              <div role="radiogroup" aria-label="Түвшин" className="grid grid-cols-4 gap-1.5">
                {([1, 2, 3, 4] as const).map((level) => {
                  const chosen = String(level) === indicatorLevel;

                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => setIndicatorLevel(String(level))}
                      className={cn(
                        "grid min-h-[44px] place-items-center rounded-control border text-body font-semibold transition-colors",
                        chosen
                          ? "border-primary bg-primary-soft text-primary"
                          : "border-border bg-surface text-muted hover:bg-canvas",
                      )}
                    >
                      {romanLevel(level)} түвшин
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {domainId ? (
              <Field label="СҮД код" error={errors.indicatorId}>
                {({ id }) => (
                  <Select
                    id={id}
                    className="[&>span:first-child]:min-w-0 [&>span:first-child]:truncate [&>span:first-child]:text-left"
                    value={indicatorId}
                    onChange={(event) => setIndicatorId(event.target.value)}
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
          </>
        ) : null}

        <Field label="Тэмдэглэл" error={errors.situation} hint={`${situation.length}/1000`}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              rows={4}
              value={situation}
              onChange={(event) => setSituation(event.target.value)}
            />
          )}
        </Field>

        {isStaff ? (
          <div className="grid grid-cols-2 gap-2">
            <Checkbox
              label="Эцэг эх харах боломжтой"
              checked={visibleToParents}
              onChange={(event) => setVisibleToParents(event.target.checked)}
            />
            <Checkbox
              label={`${PORTFOLIO}ны PDF-д оруулах`}
              checked={includeInReport}
              onChange={(event) => setIncludeInReport(event.target.checked)}
            />
          </div>
        ) : null}

        {/* The photographs already on the note, and the way to add another. */}
        <ObservationPhotos childId={childId} observationId={observation.id} />
      </div>
    </FormDialog>
  );
}

export function DeleteObservationDialog({
  childId,
  observation,
  onClose,
}: {
  childId: string;
  observation: Observation | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => mutate(`/observations/${observation!.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      toast.success("Тэмдэглэл устгагдлаа.");
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <ConfirmDialog
      open={Boolean(observation)}
      onOpenChange={(open) => !open && onClose()}
      title="Тэмдэглэл устгах уу?"
      description="Энэ үйлдлийг буцаах боломжгүй."
      confirmLabel="Устгах"
      pendingLabel="Устгаж байна…"
      tone="danger"
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
    />
  );
}

function observationText(observation: Observation): string {
  return [
    observation.situation,
    observation.childDid,
    observation.childSaid,
    observation.teacherComment,
    observation.nextSteps,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function artForObservation(observation: Observation): "observation" | "conversation" | "artwork" {
  if (observation.type?.code === "conversation") return "conversation";
  if (observation.type?.code === "artwork") return "artwork";
  return "observation";
}

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function firstAvailableDateForTerm(
  term: number,
  today: string,
  terms: z.infer<typeof termsSchema>,
): string {
  const configured = terms.find((candidate) => candidate.number === term && candidate.startsOn);
  if (configured?.startsOn) return configured.startsOn > today ? today : configured.startsOn;

  const schoolYear = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 9 ? 1 : 0);
  const candidate =
    term === 1
      ? `${schoolYear}-09-01`
      : term === 2
        ? `${schoolYear + 1}-01-01`
        : `${schoolYear + 1}-04-01`;
  return candidate > today ? today : candidate;
}
