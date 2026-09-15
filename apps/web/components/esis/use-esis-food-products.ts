"use client";

import { useQuery } from "@tanstack/react-query";
import { esisResourceReadSchema, esisScopedCatalogSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";

/**
 * One ministry dish, reduced to what a menu row can use.
 *
 * ★ `calories` is a string because every ESIS value is. The panel renders them
 * verbatim and so does the dish draft — `menuDishInputSchema` parses the
 * number at the edge, and converting here would mean guessing at a locale the
 * ministry never declared.
 */
export interface EsisFoodProduct {
  productId: string;
  name: string;
  calories: string | null;
}

/**
 * ESIS-ийн бэлэн бүтээгдэхүүн, for the menu's dish picker.
 *
 * ★ Why a hook and not a second `EsisDataPanel`. A panel *shows* a service;
 * this feeds a `<select>`. The client asked for the API to be called where a
 * cook chooses a ready dish — "тогоочийн хэсэгт бэлэн хоол сонгох хэсэгт
 * API-г дуудах" — and a table underneath the form would not have been that.
 *
 * ★★ It reads the **role-scoped** catalog first, exactly as the panel does, so
 * the product list is fetched only for somebody whose own role holds
 * `foodProducts`. A teacher's menu form asks for nothing and gets nothing.
 *
 * ★★★ Same call discipline as the panel: one read, no refetch on focus or
 * reconnect. Every one of these is an outbound request to the ministry and an
 * `AuditLog` VIEW row; alt-tabbing is not somebody reading the reference.
 */
export function useEsisFoodProducts(): EsisFoodProduct[] {
  const { primaryKindergartenId } = useSession();

  const catalog = useQuery({
    queryKey: qk.esisCatalog(primaryKindergartenId ?? "none"),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/catalog`, esisScopedCatalogSchema),
    enabled: Boolean(primaryKindergartenId),
    retry: false,
  });

  const endpoint = catalog.data?.endpoints.find((item) => item.key === "foodProducts");

  const read = useQuery({
    queryKey: qk.esisResource(
      primaryKindergartenId ?? "none",
      "foodProducts",
      "resource=foodProducts",
    ),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/esis/resource?resource=foodProducts`,
        esisResourceReadSchema,
      ),
    enabled: Boolean(endpoint) && Boolean(catalog.data?.canRead),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    retry: false,
  });

  if (!endpoint) return [];

  /*
   * ★ Live rows, or none — 2026-09-14.
   *
   * This fell back to the catalog's demo products, so a cook building a menu
   * could pick a dish the ministry does not list and save it against a real
   * meal plan. The picker is now empty until `cook/product` answers, and an
   * empty picker is the honest report of a failed read: the screen around it
   * says the service did not answer.
   */
  const rows = read.data?.status === "SUCCEEDED" ? read.data.rows : [];

  return rows
    .map((row) => ({
      productId: row.productId ?? "",
      name: row.productName ?? "",
      calories: row.calories ?? null,
    }))
    .filter((product) => product.productId && product.name);
}
