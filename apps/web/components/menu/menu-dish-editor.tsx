"use client";

import { Plus, Trash2 } from "lucide-react";
import { MEAL_KIND_LABEL, type MealKind, type MenuDish } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";

/**
 * One day's dish editor — every field `saveMenuDaySchema` accepts
 * (`meals.dto.ts`), structured rather than a name-only list.
 *
 * ★ Extracted from `child-menu.tsx` (2026-08-28) on 2026-08-30, when the
 * Тогооч role's own screen (`(app)/menu/page.tsx`) needed the exact same
 * editor rather than a second one that only collected a dish's name.
 *
 * That gap was not cosmetic. `PUT /kindergartens/:id/menu/:date` **replaces**
 * the day's `dishes` outright (`meals.repository.ts`'s `upsertDay` — an
 * `update`, not a merge), and `findAllergenWarnings` only ever produces a
 * warning by iterating `dish.allergenTags`. A cook saving through a
 * name-only form did two things at once: it could never trigger RFP Module
 * 2's own allergy warning (the one requirement the RFP names for this role),
 * and it silently erased any `kind`/`allergenTags`/`ingredients`/`calories`/
 * `portions` a teacher had already entered for that day through this same
 * form. One editor, reused, is what keeps a cook's save and a teacher's save
 * unable to disagree about what a full dish record looks like.
 */
export const MEAL_KIND_ORDER: MealKind[] = [
  "BREAKFAST",
  "MID_MORNING_SNACK",
  "LUNCH",
  "AFTERNOON_SNACK",
  "EXTRA",
];

export interface DishDraft {
  /** Stable per-row identity for React's reconciliation — removing a middle
   * row must not shift focus onto whatever row inherits its array index. */
  key: string;
  name: string;
  kind: MealKind;
  allergenTags: string;
  ingredients: string;
  calories: string;
  portions: string;
}

export function toDraft(dishes: MenuDish[]): DishDraft[] {
  return dishes.map((dish, i) => ({
    key: `${i}-${dish.name}`,
    name: dish.name,
    kind: dish.kind ?? "BREAKFAST",
    allergenTags: dish.allergenTags.join(", "),
    ingredients: dish.ingredients ?? "",
    calories: dish.calories === null || dish.calories === undefined ? "" : String(dish.calories),
    portions: dish.portions === null || dish.portions === undefined ? "" : String(dish.portions),
  }));
}

/** The inverse of `toDraft`. Blank names are dropped rather than saved as "". */
export function fromDraft(drafts: DishDraft[]) {
  return drafts
    .filter((d) => d.name.trim())
    .map((d) => ({
      name: d.name.trim(),
      kind: d.kind,
      allergenTags: d.allergenTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      ingredients: d.ingredients.trim() || null,
      calories: d.calories.trim() ? Number(d.calories) : null,
      portions: d.portions.trim() ? Number(d.portions) : null,
    }));
}

export function newDraft(kind: MealKind): DishDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    kind,
    allergenTags: "",
    ingredients: "",
    calories: "",
    portions: "",
  };
}

/**
 * A row per dish, structured rather than the free-text-with-a-parenthesis
 * syntax this used to be.
 *
 * ★ Replaced the single textarea on purpose. "Нэр (сүү, самар)" per line
 * worked when a dish was a name and a tag list; it has no honest way to also
 * carry which sitting a dish belongs to, its calories or its portion count
 * without inventing more punctuation a teacher has to remember the shape of.
 * A row of real fields is longer to build and shorter to use correctly.
 */
export function MenuDishEditor({
  draftDishes,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  draftDishes: DishDraft[];
  onChange: (next: DishDraft[]) => void;
  onSave: () => void;
  /** Omit where there is no separate read state to fall back to — the
   * cook's page is always in this form, so it has no "Цуцлах". */
  onCancel?: () => void;
  saving: boolean;
  error: string | null;
}) {
  function update(index: number, patch: Partial<DishDraft>) {
    onChange(draftDishes.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function remove(index: number) {
    onChange(draftDishes.filter((_, i) => i !== index));
  }

  function addRow() {
    const lastKind = draftDishes.at(-1)?.kind ?? "BREAKFAST";
    onChange([...draftDishes, newDraft(lastKind)]);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving) onSave();
      }}
      className="flex flex-col gap-3"
    >
      <FormError message={error} />

      {draftDishes.length === 0 ? (
        <p className="text-body text-muted">Хоол алга. Доор нэмнэ үү.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {draftDishes.map((dish, i) => (
            <Card key={dish.key} pad="compact" className="flex flex-col gap-2.5">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Хоолны нэр">
                    {({ id }) => (
                      <Input
                        id={id}
                        value={dish.name}
                        onChange={(e) => update(i, { name: e.target.value })}
                        autoFocus={i === draftDishes.length - 1}
                      />
                    )}
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Энэ хоолыг хасах"
                  onClick={() => remove(i)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Field label="Хоолны цаг">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={dish.kind}
                      onChange={(e) => update(i, { kind: e.target.value as MealKind })}
                    >
                      {MEAL_KIND_ORDER.map((kind) => (
                        <option key={kind} value={kind}>
                          {MEAL_KIND_LABEL[kind]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Илчлэг (ккал)">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={3000}
                      value={dish.calories}
                      onChange={(e) => update(i, { calories: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Порц">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      value={dish.portions}
                      onChange={(e) => update(i, { portions: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Харшлын орц" hint="Таслалаар тусгаарлана">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      placeholder="сүү, өндөг"
                      value={dish.allergenTags}
                      onChange={(e) => update(i, { allergenTags: e.target.value })}
                    />
                  )}
                </Field>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Button type="button" variant="secondary" size="sm" onClick={addRow} className="self-start">
        <Plus size={16} aria-hidden="true" />
        Хоол нэмэх
      </Button>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            Цуцлах
          </Button>
        ) : null}
      </div>
    </form>
  );
}
