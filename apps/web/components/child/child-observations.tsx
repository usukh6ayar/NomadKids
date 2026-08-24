"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { observationSchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ObservationRow } from "@/components/observations/observation-row";

const observationsSchema = paginated(observationSchema);

/** Enough to answer "what has been happening"; the full list is its own screen. */
const PAGE_SIZE = 10;

/**
 * The "Ажиглалт" tab.
 *
 * ★ The API decides what a viewer sees, not this component.
 *
 * A guardian's `GET /children/:id/observations` simply does not contain a
 * teacher's private notes — the filtering is server-side, as it has to be, and
 * `isStaff` here only changes the wording and whether the review state is shown.
 * If this component ever starts hiding rows itself, the mobile client will
 * answer differently.
 */
export function ChildObservations({ childId, isStaff }: { childId: string; isStaff: boolean }) {
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
    queryKey: qk.childObservations(childId, { pageSize: PAGE_SIZE }),
    queryFn: () =>
      get(`/children/${childId}/observations?page=1&pageSize=${PAGE_SIZE}`, observationsSchema),
  });

  if (observations.isPending) return <LoadingState rows={3} />;
  if (observations.isError) return <ErrorState description={errorMessage(observations.error)} />;

  const items = observations.data.items;

  if (items.length === 0) {
    return (
      <EmptyState
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

  return (
    <div className="flex flex-col gap-3">
      <Card className="divide-y divide-border">
        {items.map((observation) => (
          <ObservationRow key={observation.id} observation={observation} showVisibility={isStaff} />
        ))}
      </Card>

      {/*
        ★ Says so when there are more, rather than showing the first ten as if
        they were all of them. This tab has no pager yet; a silent truncation is
        the version of that gap nobody notices.
      */}
      {observations.data.total > items.length ? (
        <p className="px-1 text-body text-muted">
          Нийт {observations.data.total} ажиглалтаас сүүлийн {items.length}-г харуулж байна.
        </p>
      ) : null}
    </div>
  );
}
