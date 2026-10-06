"use client";

import { useQuery } from "@tanstack/react-query";
import {
  esisResourceReadSchema,
  esisScopedCatalogSchema,
  ingredientSchema,
  paginated,
  type EsisRow,
  type Ingredient,
  type IngredientCategory,
  type IngredientUnit,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";

/**
 * What the two «ESIS-ээс татах» buttons on the kitchen screens share — the
 * ministry's food references read from the store, and the few rules for
 * turning one of their rows into one of ours.
 *
 * ★ Confirmed against the live store on 2026-10-06 (the client pasted it):
 * a material's `measureCode` is "gr" and its `calories` are per 100 g —
 * «Бүхэл үрийн гурил», gr, 334.
 */

export type FoodResource =
  "foodProducts" | "foodProductMaterials" | "foodMaterials" | "foodMaterialGroups";

export function foodResourceQuery(kindergartenId: string, resource: FoodResource) {
  return {
    queryKey: qk.esisResource(kindergartenId, resource, `resource=${resource}`),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/esis/resource?resource=${resource}`,
        esisResourceReadSchema,
      ),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  } as const;
}

/** The rows of a read, or none when it failed. */
export const rowsOf = (read: { status: string; rows: EsisRow[] } | undefined) =>
  read?.status === "SUCCEEDED" ? read.rows : [];

/** Whether this person's role may read every one of `resources`. */
export function useEsisFoodAccess(kindergartenId: string, resources: readonly FoodResource[]) {
  const catalog = useQuery({
    queryKey: qk.esisCatalog(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/esis/catalog`, esisScopedCatalogSchema),
    retry: false,
  });
  const keys = new Set(catalog.data?.endpoints.map((endpoint) => endpoint.key));
  return Boolean(catalog.data?.canRead) && resources.every((key) => keys.has(key));
}

/** ESIS unit spellings → the kitchen's base unit and the factor into it. */
const UNITS: Record<string, { unit: IngredientUnit; factor: number }> = {
  г: { unit: "GRAM", factor: 1 },
  гр: { unit: "GRAM", factor: 1 },
  грамм: { unit: "GRAM", factor: 1 },
  g: { unit: "GRAM", factor: 1 },
  gr: { unit: "GRAM", factor: 1 },
  gram: { unit: "GRAM", factor: 1 },
  кг: { unit: "GRAM", factor: 1000 },
  kg: { unit: "GRAM", factor: 1000 },
  мл: { unit: "MILLILITER", factor: 1 },
  ml: { unit: "MILLILITER", factor: 1 },
  л: { unit: "MILLILITER", factor: 1000 },
  литр: { unit: "MILLILITER", factor: 1000 },
  l: { unit: "MILLILITER", factor: 1000 },
  ш: { unit: "PIECE", factor: 1 },
  ширхэг: { unit: "PIECE", factor: 1 },
  pcs: { unit: "PIECE", factor: 1 },
};

export function esisUnit(code: string | null | undefined) {
  const key = (code ?? "").trim().toLowerCase().replace(/\.$/, "");
  return UNITS[key] ?? null;
}

/** A decimal string the kitchen API accepts (`123.45`), or null. */
export function decimal(value: string | null | undefined, factor = 1, max = 99_999_999) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number) || number <= 0) return null;
  const scaled = Math.round(number * factor * 100) / 100;
  return scaled > 0 && scaled <= max ? String(scaled) : null;
}

export const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase("mn") === b.trim().toLocaleLowerCase("mn");

/**
 * ESIS's forty material groups onto the kitchen's ten categories, by the
 * words in the group's name. Anything unrecognised is «Бусад» — the cook can
 * re-file it, and a wrong guess would hide a row under a filter.
 */
const CATEGORY_WORDS: [RegExp, IngredientCategory][] = [
  [/гурил|талх|боов|гоймон|хийц/, "Гурилан бүтээгдэхүүн"],
  [/тариа|будаа|шош|вандуй/, "Тариа, будаа"],
  [/мах|загас|хиам|шувуу/, "Мах, махан бүтээгдэхүүн"],
  [/сүү|тараг|бяслаг|ааруул|цөцгий|ээдэм/, "Сүү, сүүн бүтээгдэхүүн"],
  [/өндөг/, "Өндөг"],
  // Before vegetables: «халуун ногоо» is a spice.
  [/амтлагч|давс|чихэр|зуурмаг|соус|цуу|халуун ногоо/, "Амтлагч, зуурмаг"],
  [/ногоо|төмс|лууван|байцаа|сонгино/, "Хүнсний ногоо"],
  [/жимс|чацаргана/, "Жимс, жимсгэнэ"],
  [/тос|өөх/, "Тос, өөх"],
];

export function esisCategory(groupName: string | null | undefined): IngredientCategory {
  const name = (groupName ?? "").toLocaleLowerCase("mn");
  return CATEGORY_WORDS.find(([words]) => words.test(name))?.[1] ?? "Бусад";
}

/** The kitchen's own body for one ESIS material, or null if its unit is unknown. */
export function ingredientFromEsis(material: EsisRow, groupName?: string | null) {
  const name = (material.materialName ?? "").trim();
  const unit = esisUnit(material.measureCode);
  if (!name || !unit) return null;
  const per100 = (value: string | null | undefined) =>
    unit.unit === "PIECE" ? null : decimal(value, 1, 999_999);
  return {
    name,
    unit: unit.unit,
    category: esisCategory(groupName),
    caloriesPer100: per100(material.calories),
    proteinPer100: per100(material.proteins),
    fatPer100: per100(material.fats),
    carbsPer100: per100(material.carbohydrate),
  };
}

const ingredientsSchema = paginated(ingredientSchema);

/** Every ingredient the kitchen holds — a few pages of 100, for a name check. */
export async function allIngredients(kindergartenId: string): Promise<Ingredient[]> {
  const items: Ingredient[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await get(
      `/kindergartens/${kindergartenId}/ingredients?page=${page}&pageSize=100`,
      ingredientsSchema,
    );
    items.push(...result.items);
    if (page >= result.totalPages) break;
  }
  return items;
}
