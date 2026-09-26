"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { childDetailSchema, observationTypeSchema } from "@kinder/contracts";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildObservations } from "@/components/child/child-observations";
import { ObservationHub } from "@/components/child/observation-hub";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { useSession } from "@/lib/auth/session";
import { capitalize } from "@/lib/format";

const observationTypesSchema = z.array(observationTypeSchema);

/**
 * A specific child's observations — the standalone route.
 *
 * ★ Same reasoning as `/attendance` and `/menu`: this used to be the child
 * hub's own "Ажиглалт" tab; the hub is gone (`children/[childId]/page.tsx`
 * was deleted), so this opens directly and the tab no longer exists anywhere.
 */
export default function ChildObservationsPage() {
  return (
    <Suspense fallback={<LoadingState rows={4} />}>
      <Body />
    </Suspense>
  );
}

function Body() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const searchParams = useSearchParams();
  const typeCode = searchParams.get("type") ?? "";
  const initialPanel = searchParams.get("panel") === "progress" ? "reports" : "notes";
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  /*
    The kind's id, resolved from its code — a kindergarten may add its own
    types, so the id differs per deployment while `daily` / `conversation` /
    `artwork` are the system rows' stable codes.
  */
  const types = useQuery({
    queryKey: qk.observationTypes(childId),
    queryFn: () => get(`/children/${childId}/observations/types`, observationTypesSchema),
    enabled: Boolean(typeCode),
    staleTime: 5 * 60_000,
  });

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  if (child.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState description={errorMessage(child.error)} />
      </div>
    );
  }

  const data = child.data!;

  /*
    ★ `?type=` turns this route into the client's 2026-09-11 hub.

    Pressing Ажиглалт used to open a blank compose form — the right
    destination when a teacher has already decided what to write, the wrong one
    when they came to look, and looking is most of what the screen is for. With
    a kind named, this is the landing between the door and the form: four
    tiles, the total, and the terms.

    Without it the route is what it always was — the child's whole record,
    reached from their file — so the parent's own view and every existing link
    are unchanged.
  */
  if (typeCode && isStaff) {
    const type = (types.data ?? []).find((row) => (row.code ?? "") === typeCode);

    /*
      ★ Буцах and the title belong to the hub, not to this route — 2026-09-14.

      They share a row with the school-year picker now, and that picker is the
      hub's own state. Drawing two thirds of a control strip here and the rest
      a component away is how the two halves drift apart.
    */
    return (
      /* No top padding: the header row is the first thing, hard against it. */
      <div className="flex flex-col gap-3 pb-2">
        {type ? (
          <ObservationHub
            childId={childId}
            typeCode={typeCode}
            typeId={type.id}
            title={capitalize(type.name)}
            initialPanel={initialPanel}
          />
        ) : (
          <LoadingState rows={4} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-2">
      <PageHeader backHref="/dashboard" title="Явцын үнэлгээ" />

      {/* ★ Staff only, 2026-09-09 — see assessments/page.tsx's note. */}
      {isStaff ? <ChildHeroProfile child={data} showHealthAlert={isStaff} /> : null}

      <ChildObservations childId={childId} isStaff={isStaff} />
    </div>
  );
}
