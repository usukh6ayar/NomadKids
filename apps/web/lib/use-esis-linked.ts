"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { useSession } from "@/lib/auth/session";

/**
 * Whether this kindergarten is connected to ESIS — `undefined` until known.
 *
 * ★ For the screens that only make sense with ESIS: a kindergarten without it
 * (a private one, 2026-10-06) is shown neither the ministry's empty panels nor
 * the ESIS write queue, and is offered the manual paths instead — «Жил нэмэх»
 * rather than «ESIS татах». `esisInstitutionId` is on `GET /kindergartens/:id`
 * for an administrator; no new field or permission.
 */
export function useEsisLinked(): boolean | undefined {
  const { primaryKindergartenId } = useSession();
  const link = useQuery({
    queryKey: ["kindergarten", primaryKindergartenId ?? "", "esis-link"],
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}`,
        z.object({ esisInstitutionId: z.string().nullish() }),
      ),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });
  return link.isSuccess ? Boolean(link.data.esisInstitutionId) : undefined;
}
