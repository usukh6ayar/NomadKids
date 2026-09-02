"use client";

import { ChefHat, PencilLine, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { MEAL_KIND_LABEL, type MealKind, type MenuDish } from "@kinder/contracts";
import { SingleImageUpload } from "@/components/media/single-image-upload";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
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
 *
 * ★★ 2026-09-01 — `recipeId` and `photoMediaFileId` joined the draft for the
 * same reason `kind`/`calories`/etc. did the first time: a dish carrying
 * either, saved through whichever screen doesn't render a control for it,
 * must still come back out unchanged rather than silently drop it. Both are
 * therefore always part of `DishDraft`/`toDraft`/`fromDraft` — round-tripped
 * even where there is no UI to set them — and only the `kitchen` prop below
 * decides whether a screen *offers* to set them.
 *
 * `note` joined the same way, but with no gate at all: RFP §12 asks for one
 * on every dish, `saveMenuDaySchema` has always accepted it, and no screen
 * had ever rendered a field for it.
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
  note: string;
  /** The технологийн карт this dish is cooked from, if any. `""` means the
   * dish is free text. See `KitchenOptions` for what shows the picker. */
  recipeId: string;
  /** A photograph of the dish as plated. `""` means none. */
  photoMediaFileId: string;
  /**
   * Which of the two modes the row is showing — **UI only, never saved.**
   *
   * ★ It cannot be derived from `recipeId`, and that is the whole reason it
   * exists. Pressing "Бэлэн хоол" has to show the picker *before* anything is
   * picked, and at that instant `recipeId` is still `""` — indistinguishable
   * from free text. Deriving the mode would make the button appear not to
   * work.
   *
   * It lives on the draft rather than in a `useState` beside it so there is
   * one array to keep in step instead of two: a row removed from the middle
   * takes its mode with it.
   */
  useRecipe: boolean;
}

export function toDraft(dishes: MenuDish[]): DishDraft[] {
  return dishes.map((dish, i) => ({
    key: `${i}-${dish.recipeId ?? dish.name}`,
    name: dish.name,
    kind: dish.kind ?? "BREAKFAST",
    allergenTags: dish.allergenTags.join(", "),
    ingredients: dish.ingredients ?? "",
    calories: dish.calories === null || dish.calories === undefined ? "" : String(dish.calories),
    portions: dish.portions === null || dish.portions === undefined ? "" : String(dish.portions),
    note: dish.note ?? "",
    recipeId: dish.recipeId ?? "",
    photoMediaFileId: dish.photoMediaFileId ?? "",
    useRecipe: Boolean(dish.recipeId),
  }));
}

/**
 * The inverse of `toDraft`. Blank names are dropped rather than saved as "".
 *
 * ★ `note`/`recipeId`/`photoMediaFileId` are only included when set, unlike
 * `ingredients`/`calories`/`portions` above. Those three are new enough that
 * older assertions of an exact PUT body (`cook-menu.test.tsx`) were written
 * against a dish with none of them — sending an explicit `null` for a field
 * nobody touched would be a needless behaviour change for every existing
 * save, not just a cosmetic one for the test.
 */
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
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
      ...(d.recipeId ? { recipeId: d.recipeId } : {}),
      ...(d.photoMediaFileId ? { photoMediaFileId: d.photoMediaFileId } : {}),
    }));
}

export function newDraft(kind: MealKind, useRecipe = false): DishDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    kind,
    allergenTags: "",
    ingredients: "",
    calories: "",
    portions: "",
    note: "",
    recipeId: "",
    photoMediaFileId: "",
    useRecipe,
  };
}

/** What a recipe-linked dish needs from its технологийн карт — just enough
 * to name it, group the picker by sitting, and scale its batch count. */
export interface RecipeOption {
  id: string;
  name: string;
  yieldPortions: number;
  /** Groups the picker. `null` cards fall into "Бусад" rather than vanishing. */
  mealKind: MealKind | null;
}

/**
 * Turns on the технологийн карт picker and the dish photo upload.
 *
 * ★ A single opt-in prop rather than two, so a screen cannot show the photo
 * control without the ability to authorise its upload (`kindergartenId`) or
 * show the recipe picker without anything to pick from.
 *
 * `child-menu.tsx`'s quick edit from inside a child's page omits this
 * entirely — technology cards are the kitchen's own planning concept, not
 * something a teacher fixing a typo needs to reach — while still round-
 * tripping a recipe/photo an existing dish already carries, via `DishDraft`.
 */
export interface KitchenOptions {
  kindergartenId: string;
  /** Every APPROVED recipe — `GET /kindergartens/:id/recipes/approved`. */
  recipes: RecipeOption[];
}

/**
 * The picker's `<optgroup>`s, in sitting order with unassigned cards last.
 *
 * A kitchen with two dozen approved cards produces a flat list nobody scans.
 * Grouping costs nothing — `listApprovedRecipes` already selects `mealKind`.
 */
function groupByKind(recipes: RecipeOption[]): [string, RecipeOption[]][] {
  const groups: [string, RecipeOption[]][] = [];
  for (const kind of MEAL_KIND_ORDER) {
    const inKind = recipes.filter((r) => r.mealKind === kind);
    // `MEAL_KIND_LABEL` is a `Record<string, string>` in the contracts, so
    // under `noUncheckedIndexedAccess` every lookup is possibly undefined even
    // though `kind` is a `MealKind`. The fallback is unreachable, not defensive.
    if (inKind.length > 0) groups.push([MEAL_KIND_LABEL[kind] ?? kind, inKind]);
  }
  const rest = recipes.filter((r) => r.mealKind === null);
  if (rest.length > 0) groups.push(["Бусад", rest]);
  return groups;
}

/**
 * Бэлэн хоол · Өөрөө бичих.
 *
 * ★ This replaced `<option value="">Чөлөөт бичвэр</option>` — the first entry
 * of a dropdown that only rendered at all once the kitchen had an APPROVED
 * технологийн карт. Until then the control was **absent**, so a cook opening
 * the menu screen on a fresh deployment saw a plain name box and no way to
 * learn that picking a ready dish was a thing the product does. The capability
 * had shipped; its discoverability had not.
 *
 * ★★ It renders even with zero approved cards, disabled and saying where to
 * make one. CLAUDE.md §5 — an empty state says what to do next. Hiding the
 * control instead is what produced the problem above.
 */
function ModeSwitch({
  value,
  hasRecipes,
  onChange,
}: {
  value: boolean;
  hasRecipes: boolean;
  onChange: (useRecipe: boolean) => void;
}) {
  const base =
    "min-h-[40px] flex-1 rounded-control px-3 text-body font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";
  const on = "bg-surface text-primary shadow-sm";
  const off = "text-muted hover:text-ink";

  return (
    <div
      role="group"
      aria-label="Хоолыг хэрхэн оруулах"
      className="flex gap-1 rounded-control bg-canvas p-1"
    >
      <button
        type="button"
        disabled={!hasRecipes}
        aria-pressed={value}
        onClick={() => onChange(true)}
        className={`${base} ${value ? on : off}`}
      >
        <ChefHat size={15} aria-hidden="true" className="mr-1.5 inline align-[-2px]" />
        Бэлэн хоол
      </button>
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange(false)}
        className={`${base} ${value ? off : on}`}
      >
        <PencilLine size={15} aria-hidden="true" className="mr-1.5 inline align-[-2px]" />
        Өөрөө бичих
      </button>
    </div>
  );
}

/**
 * What the picker says when the kitchen has cards but none approved yet.
 *
 * ★ This is the exact state a newly seeded kindergarten is in: the eight
 * reference технологийн карт ship as DRAFT by design (`kitchen-reference.ts`),
 * because nothing may reach a parent's screen or an allergy cross-check before
 * a cook has read it. So the first thing this screen must do is say so and
 * point at the one click that fixes it.
 */
function NoApprovedRecipes() {
  return (
    <div className="flex flex-col gap-1.5 rounded-control border border-dashed border-border bg-canvas px-3.5 py-3">
      <p className="text-body text-ink">Батлагдсан технологийн карт алга.</p>
      <p className="text-caption text-muted">
        Жороо баталсны дараа энд сонголт болж гарч ирнэ. Одоохондоо “Өөрөө бичих”-ээр оруулаарай.
      </p>
      <Link
        href="/kitchen/recipes"
        className="inline-flex min-h-[36px] items-center text-body font-semibold text-primary hover:underline"
      >
        Технологийн карт руу очих
      </Link>
    </div>
  );
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
 *
 * ★★ Ingredients/calories/allergen tags hide once a recipe is picked, not
 * merely disabled. `MealsService.saveDay` freezes `name`/`allergenTags`/
 * `calories` from the (APPROVED) recipe regardless of what this form sends,
 * so an editable field there would silently do nothing — the technology
 * card is the ingredient list once one is chosen.
 */
export function MenuDishEditor({
  draftDishes,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
  kitchen,
}: {
  draftDishes: DishDraft[];
  onChange: (next: DishDraft[]) => void;
  onSave: () => void;
  /** Omit where there is no separate read state to fall back to — the
   * cook's page is always in this form, so it has no "Цуцлах". */
  onCancel?: () => void;
  saving: boolean;
  error: string | null;
  /** Shows the технологийн карт picker and the dish photo upload. Omit for a
   * quick edit that has neither reference data nor a reason to offer them. */
  kitchen?: KitchenOptions;
}) {
  function update(index: number, patch: Partial<DishDraft>) {
    onChange(draftDishes.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function remove(index: number) {
    onChange(draftDishes.filter((_, i) => i !== index));
  }

  function addRow() {
    const lastKind = draftDishes.at(-1)?.kind ?? "BREAKFAST";
    /*
     * ★ A new row opens on "Бэлэн хоол" wherever there are approved cards to
     * pick from. That is the path the kitchen module exists for — a dish
     * chosen from a технологийн карт carries its own allergens into RFP
     * Module 2's cross-check, and one typed by hand carries whatever the cook
     * remembers to type. Free text stays one press away, never removed.
     */
    onChange([...draftDishes, newDraft(lastKind, (kitchen?.recipes.length ?? 0) > 0)]);
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
          {draftDishes.map((dish, i) => {
            const recipe = kitchen?.recipes.find((r) => r.id === dish.recipeId);

            return (
              <Card key={dish.key} pad="compact" className="flex flex-col gap-2.5">
                {kitchen ? (
                  <ModeSwitch
                    value={dish.useRecipe}
                    hasRecipes={kitchen.recipes.length > 0}
                    onChange={(useRecipe) =>
                      /*
                       * ★ Switching to free text clears `recipeId`, and it has
                       * to: `MealsService.saveDay` freezes a recipe-linked
                       * dish's name, allergens and calories over anything the
                       * form sends, so a row left pointing at a card while
                       * showing free-text fields would save none of what the
                       * cook just typed.
                       *
                       * The name is deliberately kept. A cook who picked
                       * "Гурилтай шөл" and then switches to free text almost
                       * always means "the same dish, my own way", and clearing
                       * the field makes them type it again.
                       */
                      update(i, useRecipe ? { useRecipe } : { useRecipe, recipeId: "" })
                    }
                  />
                ) : null}

                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    {kitchen && dish.useRecipe ? (
                      <Field
                        label="Бэлэн хоол"
                        hint={
                          kitchen.recipes.length === 0
                            ? undefined
                            : "Орц, илчлэг, харшил нь картаас өөрөө бөглөгдөнө"
                        }
                      >
                        {({ id, describedBy }) =>
                          kitchen.recipes.length === 0 ? (
                            <NoApprovedRecipes />
                          ) : (
                            <Select
                              id={id}
                              aria-describedby={describedBy}
                              value={dish.recipeId}
                              onChange={(e) => {
                                const picked = kitchen.recipes.find((r) => r.id === e.target.value);
                                update(i, {
                                  recipeId: e.target.value,
                                  /*
                                   * ★★ The name is copied onto the draft, not
                                   * left to the server.
                                   *
                                   * `fromDraft` drops any row whose name is
                                   * blank, and `menuDishInputSchema` requires
                                   * `name.min(1)`. A fresh row with a card
                                   * picked and nothing typed therefore used to
                                   * be **filtered out on save** — the cook
                                   * chose a dish, pressed Хадгалах, and it was
                                   * simply not there afterwards, with no error.
                                   * The server re-freezes the name from the
                                   * card either way, so this only has to be
                                   * non-empty and true.
                                   */
                                  name: picked?.name ?? "",
                                  // Default to one batch of the card — a cook
                                  // doubling or tripling it for a bigger group
                                  // edits the number in place.
                                  portions: e.target.value ? dish.portions || "1" : "",
                                  // Follow the card's own sitting when it names
                                  // one; the cook can still move it.
                                  ...(picked?.mealKind ? { kind: picked.mealKind } : {}),
                                });
                              }}
                            >
                              <option value="">Сонгоно уу</option>
                              {groupByKind(kitchen.recipes).map(([label, options]) => (
                                <optgroup key={label} label={label}>
                                  {options.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </Select>
                          )
                        }
                      </Field>
                    ) : (
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
                    )}
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

                  {dish.useRecipe ? (
                    <Field
                      label="Багцын тоо"
                      hint={
                        dish.portions
                          ? `${Number(dish.portions) * (recipe?.yieldPortions ?? 0)} хүүхдэд`
                          : "Хэдэн багц технологийн картаар хийсэн бэ"
                      }
                    >
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
                  ) : (
                    <>
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
                    </>
                  )}
                </div>

                {dish.useRecipe && dish.recipeId ? (
                  <p className="text-caption text-muted">
                    Орц, шим тэжээл, харшлын шошго технологийн картаас автоматаар бодогдоно.
                  </p>
                ) : null}

                <Field label="Тэмдэглэл">
                  {({ id }) => (
                    <Textarea
                      id={id}
                      rows={2}
                      value={dish.note}
                      onChange={(e) => update(i, { note: e.target.value })}
                      placeholder="Жишээ нь: өнөөдөр амттай гарсан"
                    />
                  )}
                </Field>

                {kitchen ? (
                  <div className="flex flex-col gap-1 border-t border-border-soft pt-2.5">
                    <span className="text-caption font-medium text-muted">Хоолны зураг</span>
                    <SingleImageUpload
                      endpoint={`/kindergartens/${kitchen.kindergartenId}/menu/dish-photo`}
                      currentMediaId={dish.photoMediaFileId || null}
                      label="Зураг нэмэх"
                      alt={`${dish.name || recipe?.name || "Хоол"} зураг`}
                      onUploaded={(media) => update(i, { photoMediaFileId: media.id })}
                    />
                  </div>
                ) : null}
              </Card>
            );
          })}
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
