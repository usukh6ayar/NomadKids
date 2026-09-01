"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { isPaymentRequired } from "@/lib/api/errors";
import { LoadingState } from "@/components/ui/states";
import { AccessGate } from "@/components/child/access-gate";

/**
 * The portal access gate, applied once for every screen under a child.
 *
 * ★ **A layout rather than a line in each page, and that is the whole point.**
 * There are fifteen screens under `/children/:id` today. Wiring the check into
 * each would work until the sixteenth is added, and the sixteenth would ship
 * showing an unpaid family "Алдаа гарлаа" instead of the payment that fixes
 * it. Here, a new page inherits the gate by existing.
 *
 * ★★ It costs no extra request. `qk.child(childId)` is the same key the pages
 * fetch under, so React Query serves both from one in-flight promise — this
 * layout reads the answer they were already asking for.
 *
 * ★★★ Only 402 is intercepted. A 404 falls through to the page, which knows
 * whether "this child does not exist" should read as an empty portfolio or a
 * missing record — and a 404 has nothing actionable to offer anyway. That
 * asymmetry is the reason the API distinguishes the two statuses at all;
 * see `authz/portal-access.ts`.
 */
export default function ChildLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
    /*
     * ★ No `retry` override here on purpose.
     *
     * There was one — `(_, error) => !isPaymentRequired(error)` — written to
     * stop a paywall being retried. It did that and broke everything else:
     * `providers.tsx` already declines to retry 401/402/403/404 and caps the
     * rest at two, and this replaced that whole policy with "retry anything
     * that is not a 402, for ever". A 404 then never settled, `isError` never
     * became true, and the layout sat on its loading skeleton indefinitely.
     *
     * The global rule is the right rule. 402 was added to it in the same
     * change that found this.
     */
  });

  /*
   * ★ Nothing renders until the gate has an answer.
   *
   * The first version returned `children` while this query was still in
   * flight, on the reasoning that a page which needs the child would fetch it
   * anyway. It does — but it also fetches everything else. A guardian's first
   * visit to a paywalled child produced four requests for the child and three
   * for their surveys, every one a 402, and a flash of "Алдаа гарлаа" before
   * the gate replaced it. Observed in a browser on 2026-09-01; no test caught
   * it, because a test that renders one page cannot see a second page's
   * requests.
   *
   * Waiting costs nothing: every screen under this route fetches the child
   * under this exact key, so this is the request they were already blocked on,
   * not an extra one.
   */
  /*
   * ★★ Error branch FIRST, and the order is not cosmetic.
   *
   * `isLoading` is `isPending && isFetching` in TanStack Query v5, and a query
   * that has failed and stopped retrying can still report `isPending` — so a
   * loading check placed above the error branch swallowed the 404 and left the
   * skeleton on screen for ever. Caught by the "lets a 404 through" test the
   * moment this layout started waiting at all.
   */
  if (child.isError) {
    if (isPaymentRequired(child.error)) return <AccessGate childId={childId} />;
    /*
     * ★ Everything else falls through to the page. A 404 has nothing
     * actionable to offer, and only the page knows whether "no such child"
     * reads as an empty portfolio or a missing record — intercepting it here
     * would take that judgement away from fifteen screens at once.
     */
    return <>{children}</>;
  }

  if (child.isPending) return <LoadingState rows={3} />;

  return <>{children}</>;
}
