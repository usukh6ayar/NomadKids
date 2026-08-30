"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { MAX_PAGE_SIZE, observationSchema, paginated, termSchema } from "@kinder/contracts";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ObservationRow } from "@/components/observations/observation-row";

const observationsSchema = paginated(observationSchema);
const termsSchema = z.array(termSchema);

type Observation = z.infer<typeof observationSchema>;

/** One quarter and the notes that fall inside it. */
interface Quarter {
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
function groupByQuarter(items: Observation[], terms: z.infer<typeof termsSchema>): Quarter[] {
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
