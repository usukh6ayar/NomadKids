"use client";

import { useQuery } from "@tanstack/react-query";
import {
  esisResourceReadSchema,
  esisScopedCatalogSchema,
  type EsisResourceKey,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";

export interface EsisRowsResult {
  rows: Record<string, string | null>[];
  /** The catalog or the read is still in flight. */
  isPending: boolean;
  /**
   * This role, this deployment, cannot read the service at all — no token, or
   * the scope is not in the caller's catalog.
   *
   * ★ Distinct from a read that failed and from one that returned nothing.
   * A screen that treats all three alike tells a director "ЭСИС-ээс мэдээлэл
   * шинэчлэхэд алдаа гарлаа" when nothing went wrong, or says nothing at all
   * when something did.
   */
  isUnavailable: boolean;
  /** The read reached the ministry and it refused, or the parse failed. */
  isError: boolean;
}

/**
 * One ESIS service's rows, for a screen that renders them as *domain* data.
 *
 * ★ Why this is not `EsisDataPanel`. That component draws a service — its
 * name, its path, its record count, its pull button, every field it returned.
 * This returns rows so a screen can fold them into something of its own: the
 * staff directory joins two of these onto NomadKids accounts, and a table of
 * ministry field names underneath it is exactly what that screen was built to
 * stop being.
 *
 * `use-esis-food-products.ts` is the same idea for one resource and came
 * first; it is left as it is rather than rewritten on top of this, because its
 * value is the mapping to a dish rather than the fetching.
 *
 * ★★ Reads the **role-scoped** catalog first, as every other ESIS caller
 * does, so a service absent from the caller's own role is never requested.
 *
 * ★★★ Same call discipline: one read, no refetch on focus or reconnect. Each
 * is an outbound request to the ministry and an `AuditLog` VIEW row saying
 * somebody read the roster. Alt-tabbing is not somebody reading the roster.
 */
export function useEsisRows(
  resource: EsisResourceKey,
  {
    enabled = true,
    params,
  }: {
    enabled?: boolean;
    /**
     * Path values the service needs — `{ studentGroupId }` for api-13.
     *
     * ★ A missing one does **not** fall back to reading without it. The read
     * stays disabled instead: calling `group/student/list` with no group asks
     * the ministry a question about nobody, and a group this product has not
     * matched to ESIS yet has no honest value to send.
     */
    params?: Record<string, string | null | undefined>;
  } = {},
): EsisRowsResult {
  const { primaryKindergartenId } = useSession();

  const query = new URLSearchParams({ resource });
  let missingParam = false;
  for (const [name, value] of Object.entries(params ?? {})) {
    if (!value) {
      missingParam = true;
      continue;
    }
    query.set(name, value);
  }
  const wanted = enabled && !missingParam;

  const catalog = useQuery({
    queryKey: qk.esisCatalog(primaryKindergartenId ?? "none"),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/catalog`, esisScopedCatalogSchema),
    enabled: wanted && Boolean(primaryKindergartenId),
    retry: false,
  });

  const endpoint = catalog.data?.endpoints.find((item) => item.key === resource);
  const canRead = Boolean(endpoint) && Boolean(catalog.data?.canRead);

  const read = useQuery({
    queryKey: qk.esisResource(primaryKindergartenId ?? "none", resource, query.toString()),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/resource?${query}`, esisResourceReadSchema),
    enabled: wanted && canRead,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    retry: false,
  });

  if (!wanted) {
    return { rows: [], isPending: false, isUnavailable: false, isError: false };
  }

  if (catalog.isPending) {
    return { rows: [], isPending: true, isUnavailable: false, isError: false };
  }

  /*
   * ★ A 404 from the catalog is a kindergarten with no ESIS connection, not an
   * error to report. The screen simply has no ministry column.
   */
  if (!canRead) {
    return { rows: [], isPending: false, isUnavailable: true, isError: false };
  }

  return {
    /*
     * ★ Live rows or none — never the catalog's sample. The same decision
     * `use-esis-food-products.ts` records: a fallback row is a person who does
     * not work here, on a screen whose whole job is saying who does.
     */
    rows: read.data?.status === "SUCCEEDED" ? read.data.rows : [],
    isPending: read.isPending,
    isUnavailable: false,
    isError: read.isError || read.data?.status === "FAILED",
  };
}
