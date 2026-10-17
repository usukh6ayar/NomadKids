"use client";

import { useSession } from "@/lib/auth/session";

/**
 * Whether this kindergarten is connected to ESIS — `undefined` until known.
 *
 * ★ For the screens that only make sense with ESIS: a kindergarten without it
 * (a private one, 2026-10-06) is shown neither the ministry's empty panels nor
 * the ESIS write queue, and is offered the manual paths instead — «Жил нэмэх»
 * rather than «ESIS татах».
 *
 * ★★ Read from the session, not `GET /kindergartens/:id` — 2026-10-17. That
 * route is an administrator's, so a teacher never had an answer and their
 * register offered «ESIS илгээх» and a red "ESIS код тохируулагдаагүй" in a
 * kindergarten that has no ESIS at all. The user: "ESIS-гүй цэцэрлэгүүд ч
 * адилхан ашиглаж болдог байх, ESIS-ээс зүгээр дата авахгүй, дата явуулахгүй".
 */
export function useEsisLinked(): boolean | undefined {
  const { session, primaryKindergartenId } = useSession();
  if (!session || !primaryKindergartenId) return undefined;
  return session.esisKindergartenIds.includes(primaryKindergartenId);
}
