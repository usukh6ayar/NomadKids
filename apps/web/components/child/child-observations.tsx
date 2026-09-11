"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { MAX_PAGE_SIZE, observationSchema, paginated, termSchema } from "@kinder/contracts";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { termNumberForDay } from "@/lib/terms";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { Art } from "@/components/ui/art";
import { MediaThumb } from "@/components/media/media-image";
import { ObservationRow } from "@/components/observations/observation-row";
import { excerpt, formatDate } from "@/lib/format";

const observationsSchema = paginated(observationSchema);
const termsSchema = z.array(termSchema);

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

  const today = new Date().toISOString().slice(0, 10);
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

function MomentCard({
  observation,
  canManage,
  onOpen,
  onEdit,
  onDelete,
}: {
  observation: Observation;
  canManage: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const photo = observation.media[0];
  const comment = observationText(observation);

  return (
    <article className="relative h-full rounded-card border border-border bg-surface shadow-sm transition-transform hover:-translate-y-0.5">
      <button
        type="button"
        className="flex h-full w-full flex-col overflow-hidden rounded-card text-left"
        onClick={onOpen}
      >
        {photo ? (
          <MediaThumb
            mediaId={photo.id}
            caption={photo.caption ?? comment}
            className="h-28 w-full sm:h-32"
            flush
          />
        ) : (
          <div className="flex h-28 w-full items-center justify-center bg-canvas sm:h-32">
            <Art
              name={artForObservation(observation)}
              size={64}
              className="size-16 object-contain"
            />
          </div>
        )}
        <div className="flex w-full flex-1 flex-col gap-1.5 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={observation.source === "PARENT" ? "sky" : "mint"}>
              {observation.source === "PARENT" ? "Эцэг эх" : "Багш"}
            </Badge>
            <span className="text-caption text-muted">{formatDate(observation.observedOn)}</span>
          </div>
          <p className="line-clamp-3 text-caption text-ink">
            {excerpt(comment || "Тэмдэглэл", 90)}
          </p>
        </div>
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

export function ObservationDetailDialog({
  observation,
  onClose,
}: {
  observation: Observation | null;
  onClose: () => void;
}) {
  const text = observation ? observationText(observation) : "";

  return (
    <FormDialog
      open={Boolean(observation)}
      onOpenChange={(open) => !open && onClose()}
      title={observation?.type?.name ?? "Тэмдэглэл"}
      description={observation ? formatDate(observation.observedOn) : undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      {observation ? (
        <div className="flex flex-col gap-4">
          <Badge tone={observation.source === "PARENT" ? "sky" : "mint"}>
            {observation.source === "PARENT" ? "Эцэг эхийн тэмдэглэл" : "Багшийн тэмдэглэл"}
          </Badge>
          {observation.media.length > 0 ? (
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
          ) : null}
          <p className="whitespace-pre-wrap text-body text-ink">{text || "Тэмдэглэл"}</p>
        </div>
      ) : null}
    </FormDialog>
  );
}

function EditObservationDialog({
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
  const [observedOn, setObservedOn] = useState(observation.observedOn.slice(0, 10));
  const [situation, setSituation] = useState(observationText(observation));
  const update = useMutation({
    mutationFn: () =>
      mutate(`/observations/${observation.id}`, observationSchema, {
        method: "PATCH",
        // Older parent forms split one note across these three fields. The
        // editor presents one clean note and consolidates it on save so the
        // next render cannot repeat the old fragments.
        body: {
          observedOn,
          situation: situation.trim() || null,
          childDid: null,
          childSaid: null,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      toast.success("Тэмдэглэл шинэчлэгдлээ.");
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Огноо">
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
        <Field label="Тэмдэглэл">
          {({ id }) => (
            <Textarea
              id={id}
              value={situation}
              onChange={(event) => setSituation(event.target.value)}
            />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

function DeleteObservationDialog({
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
