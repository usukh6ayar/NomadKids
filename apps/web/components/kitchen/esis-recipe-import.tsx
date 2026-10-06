"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { ingredientSchema, type EsisRow, type Ingredient, type MealKind } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { capitalize } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { SearchField } from "@/components/ui/search-field";
import { FormError, LoadingState } from "@/components/ui/states";
import type { RecipeLineDraft } from "@/components/kitchen/recipe-lines-editor";
import {
  allIngredients,
  decimal,
  esisUnit,
  foodResourceQuery,
  ingredientFromEsis,
  rowsOf,
  sameName,
  useEsisFoodAccess,
} from "@/components/kitchen/esis-food";

export { esisUnit } from "@/components/kitchen/esis-food";

/**
 * «ESIS-ээс татах» beside «Карт нэмэх» — client, 2026-10-06: pick one of the
 * ministry's ready dishes and «Технологийн карт нэмэх» opens already filled —
 * the name, the kind where it maps, and the ingredient lines. A material the
 * kitchen has not got yet is added to «Орц, түүхий эд» on the way (the client
 * chose that over asking the cook).
 *
 * ★ A prefill, never a save. The cook sees every line in the form and saves
 * the card themselves, exactly as with «Esis татах» on the settings screen.
 *
 * ★★ What the live store showed on 2026-10-06 and what it changed here:
 * names arrive in capitals («ГУРИЛТАЙ ШӨЛ») and are written as a sentence;
 * a dish's `calories` (514–1637, `measureCode` "UNIT") are not a portion's
 * and are not carried — the card works its own figure out from the lines;
 * the same dish can appear twice, so each row shows its code.
 *
 * ★★★ Still unconfirmed: that `grossWeight` is per one portion. A unit
 * `esisUnit` does not recognise skips the line and says so — a wrong unit
 * would be a wrong amount of food on a child's plate.
 *
 * ★★★★ The store serves 500 rows of `foodProductMaterials`, of a thousand
 * the ministry holds, so a dish past that cut comes back with no lines. The
 * dialog says so rather than leaving the list quietly empty.
 */

const NEEDED = ["foodProducts", "foodProductMaterials", "foodMaterials"] as const;

/**
 * ESIS dish types onto the card's «Хоолны төрөл». Only two map: SOUP would be
 * `SNACK` («Шөл»), which `POST …/recipes` refuses, and the rest (bakery,
 * salad, kit) have no counterpart.
 */
const MEAL_KIND: Record<string, MealKind> = { MAIN: "LUNCH", DRINKS: "EXTRA" };

/** «ГУРИЛТАЙ ШӨЛ» → «Гурилтай шөл»; a name already in mixed case is kept. */
export function dishName(raw: string | null | undefined) {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  return name === name.toLocaleUpperCase("mn") ? capitalize(name.toLocaleLowerCase("mn")) : name;
}

export interface EsisRecipeFill {
  name: string;
  mealKind: MealKind | "";
  lines: RecipeLineDraft[];
  /** Every ingredient the kitchen now holds, for the line pickers. */
  ingredients: Ingredient[];
  /** One sentence per line that could not be filled. */
  skipped: string[];
}

export function EsisRecipeImport({
  kindergartenId,
  onFill,
}: {
  kindergartenId: string;
  onFill: (fill: EsisRecipeFill) => void;
}) {
  const allowed = useEsisFoodAccess(kindergartenId, NEEDED);
  const [open, setOpen] = useState(false);

  if (!allowed) return null;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Download size={16} aria-hidden="true" />
        ESIS-ээс татах
      </Button>
      {open ? (
        <PickDialog
          kindergartenId={kindergartenId}
          onClose={() => setOpen(false)}
          onFill={(fill) => {
            setOpen(false);
            onFill(fill);
          }}
        />
      ) : null}
    </>
  );
}

function PickDialog({
  kindergartenId,
  onClose,
  onFill,
}: {
  kindergartenId: string;
  onClose: () => void;
  onFill: (fill: EsisRecipeFill) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const products = useQuery(foodResourceQuery(kindergartenId, "foodProducts"));

  const rows = rowsOf(products.data).filter((row) => row.productId && row.productName?.trim());
  const term = query.trim().toLocaleLowerCase("mn");
  const matches = (
    term ? rows.filter((row) => row.productName!.toLocaleLowerCase("mn").includes(term)) : rows
  ).slice(0, 50);

  async function pick(product: EsisRow) {
    setBusy(true);
    setError(null);
    try {
      const [joins, materials, owned] = await Promise.all([
        queryClient.fetchQuery(foodResourceQuery(kindergartenId, "foodProductMaterials")),
        queryClient.fetchQuery(foodResourceQuery(kindergartenId, "foodMaterials")),
        allIngredients(kindergartenId),
      ]);
      const byId = new Map(rowsOf(materials).map((row) => [row.materialId, row]));
      const parts = rowsOf(joins).filter((row) => row.productId === product.productId);

      const cache = [...owned];
      const lines: RecipeLineDraft[] = [];
      const skipped: string[] = [];
      let created = 0;

      for (const part of parts) {
        const material = byId.get(part.materialId ?? "");
        const name = material?.materialName?.trim();
        if (!material || !name) {
          skipped.push("Нэг орцын нэр олдсонгүй.");
          continue;
        }
        const unit = esisUnit(part.measureCode ?? material.measureCode);
        const quantity = unit ? decimal(part.grossWeight ?? part.netWeight, unit.factor) : null;
        if (!unit || !quantity) {
          skipped.push(`«${name}» — хэмжих нэгж эсвэл жин танигдсангүй, гараар нэмнэ үү.`);
          continue;
        }
        let ingredient = cache.find((item) => sameName(item.name, name));
        if (!ingredient) {
          const body = ingredientFromEsis(material);
          ingredient = await mutate(
            `/kindergartens/${kindergartenId}/ingredients`,
            ingredientSchema,
            { method: "POST", body: { ...(body ?? { name }), unit: unit.unit } },
          );
          cache.push(ingredient);
          created += 1;
        }
        if (!lines.some((line) => line.ingredientId === ingredient.id)) {
          lines.push({ key: crypto.randomUUID(), ingredientId: ingredient.id, quantity });
        }
      }

      if (parts.length === 0) {
        skipped.push("Энэ хоолны орц ESIS-ээс олдсонгүй. Орцоо гараар нэмнэ үү.");
      }
      if (created > 0) {
        void queryClient.invalidateQueries({ queryKey: ["kitchen", "ingredients"] });
      }

      onFill({
        name: dishName(product.productName),
        mealKind: MEAL_KIND[product.productType ?? ""] ?? "",
        lines,
        ingredients: cache,
        skipped,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const failed = products.isError || products.data?.status === "FAILED";

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={busy}
      title="ESIS-ээс хоол татах"
      footer={
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onClose}>
          Болих
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <SearchField
          label="Хоолны нэрээр хайх"
          placeholder="Жишээ нь: цуйван"
          value={query}
          onChange={setQuery}
        />
        <FormError message={error} />

        {products.isLoading || busy ? (
          <LoadingState rows={3} />
        ) : failed || rows.length === 0 ? (
          <p className="text-body text-muted">
            ESIS-ээс хоолны жагсаалт ирсэнгүй. Картаа «Карт нэмэх»-ээр гараар бөглөнө үү.
          </p>
        ) : matches.length === 0 ? (
          <p className="text-body text-muted">Ийм нэртэй хоол олдсонгүй.</p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
            {matches.map((row) => (
              <li key={row.productId}>
                <button
                  type="button"
                  onClick={() => void pick(row)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-control px-2 text-left text-body text-ink hover:bg-canvas"
                >
                  <span className="min-w-0 truncate">{dishName(row.productName)}</span>
                  {row.productCode ? (
                    <span className="shrink-0 text-caption tabular-nums text-muted">
                      {row.productCode}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormDialog>
  );
}
