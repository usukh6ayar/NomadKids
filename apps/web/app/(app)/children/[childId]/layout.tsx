"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { isPaymentRequired } from "@/lib/api/errors";
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
    // A paywall is not a transient failure — retrying it just delays the
    // screen that takes the payment.
    retry: (_count, error) => !isPaymentRequired(error),
  });

  if (child.isError && isPaymentRequired(child.error)) {
    return <AccessGate childId={childId} />;
  }

  return <>{children}</>;
}
