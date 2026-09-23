"use client";

import { useQuery } from "@tanstack/react-query";
import { Link2, Link2Off } from "lucide-react";
import { z } from "zod";
import { adminDashboardSchema, esisScopedCatalogSchema, uuidSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/**
 * The two fields of `GET /kindergartens/:id` this card reads.
 *
 * ★ A local schema rather than `kindergartenSchema`, which is `{ id, name }` —
 * the bare reference other payloads embed. `esisInstitutionId` is sent to an
 * ADMIN and to nobody else (`tenants.test.ts` pins both field sets), and
 * widening the shared schema to reach it here would put the number into every
 * embedded group, child and invoice reference a parent also receives.
 */
const connectionSchema = z.object({
  id: uuidSchema,
  esisInstitutionId: z.string().nullish(),
});

/**
 * ЭСИС холболт — where this kindergarten stands with the ministry.
 *
 * ★ **The integration-level facts, on the integration screen.** A director
 * asking "are we actually connected, and how much has come across" had to read
 * it off four different places: the institution number on `/admin/kindergarten`,
 * the group and child counts on `/admin`, the staff count on `/admin/users`,
 * and whether any of it was live from whether a panel happened to draw rows.
 *
 * ★★ **Nothing here is stored or recomputed.** The counts are the same
 * `/dashboard/admin` figures the administrator's own screen shows — counted
 * server-side, not folded out of whatever page of rows happened to load — and
 * "connected" is the role-scoped catalog's own `canRead`, which is the single
 * thing that decides whether any ESIS read on any screen can reach anything.
 * A second definition of "connected" here would be a second thing to be wrong.
 *
 * ★★★ It makes **no** outbound request to the ministry. Every value is ours;
 * this is a summary of our own state, not a health check that spends the
 * deployment's rate-limited token each time somebody opens the page.
 */
export function EsisConnectionSummary({ kindergartenId }: { kindergartenId: string }) {
  const catalog = useQuery({
    queryKey: qk.esisCatalog(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/esis/catalog`, esisScopedCatalogSchema),
    retry: false,
  });

  const kindergarten = useQuery({
    queryKey: qk.adminKindergartenInstitution(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}`, connectionSchema),
  });

  const overview = useQuery({
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
    staleTime: 60_000,
  });

  const connected = catalog.data?.canRead === true;
  const institutionId = kindergarten.data?.esisInstitutionId ?? null;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {connected ? (
          <Link2 size={18} aria-hidden="true" className="shrink-0 text-mint-ink" />
        ) : (
          <Link2Off size={18} aria-hidden="true" className="shrink-0 text-muted" />
        )}
        <h2 className="text-body font-semibold text-ink">ЭСИС холболт</h2>
        {catalog.isPending ? null : connected ? (
          <Badge tone="mint">Холбогдсон</Badge>
        ) : (
          <Badge tone="neutral">Холбогдоогүй</Badge>
        )}
      </div>

      {/*
        ★ The institution number is shown to a director because their staff
        type it into the public registration form — it is how an account gets
        made. It is on the ministry's public register rather than secret, and
        `GET /kindergartens/:id` sends it to an ADMIN and to nobody else.
      */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Figure label="Байгууллагын ЭСИС ID" value={institutionId} />
        <Figure label="Бүлэг" value={overview.data?.counts.groups} />
        <Figure label="Суралцагч" value={overview.data?.counts.children} />
        <Figure label="Багш, ажилтан" value={overview.data?.counts.staff} />
      </dl>

      {!connected && !catalog.isPending ? (
        <p className="rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
          {institutionId
            ? "Байгууллагын код холбогдсон ч ЭСИС-ийн холболт идэвхгүй байна. Платформын операторт хандана уу."
            : "Энэ цэцэрлэг ЭСИС-т холбогдоогүй байна. Платформын оператор байгууллагын кодыг холбоно."}
        </p>
      ) : null}
    </Card>
  );
}

/** One figure. "—" while it loads or when nobody has recorded it. */
function Figure({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="truncate text-lead font-semibold tabular-nums text-ink">
        {value === null || value === undefined ? <span className="text-faint">—</span> : value}
      </dd>
    </div>
  );
}
