"use client";

import { ArrowDown, ArrowUp, ChefHat, PencilLine, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { MEAL_KIND_LABEL, type MealKind, type MenuDish } from "@kinder/contracts";
import type { EsisFoodProduct } from "@/components/esis/use-esis-food-products";
import { SingleImageUpload } from "@/components/media/single-image-upload";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RowMenu } from "@/components/ui/menu";
import { MEAL_KIND_STYLE, MEAL_KIND_TIME } from "@/components/child/family-menu";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { cn } from "@/lib/utils";

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
  /**
   * The ESIS бэлэн бүтээгдэхүүн this row was filled from — **UI only, never
   * saved**, like `useRecipe` above.
   *
   * ★ It is not `recipeId` and must never become it. `recipeId` is a foreign
   * key into this kindergarten's own `Recipe` table, and `MealsService.saveDay`
   * looks the row up to freeze the dish's name, allergens and calories from
   * it. A ministry product id there would point at nothing.
   *
   * ★★ So what the ESIS pick actually does is copy values *onto the draft* —
   * name and calories — and a dish saved that way is indistinguishable from
   * one typed by hand. That is deliberate: the ministry's reference is where
   * the cook reads the илчлэг, not a key the menu carries forever. If ESIS
   * renumbers a product next year, no saved menu breaks.
   */
  esisProductId: string;
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
    /*
     * Always blank on load, and it has to be: nothing is stored that says a
     * saved dish came from ESIS, by the design `DishDraft.esisProductId`
     * argues for. Re-opening a menu shows the dish as the free-text row it
     * became on save, which is what it is.
     */
    esisProductId: "",
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
    esisProductId: "",
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
  /**
   * ESIS-ийн бэлэн бүтээгдэхүүн — `useEsisFoodProducts()`.
   *
   * ★ Added 2026-09-09, at the client's request: "тогоочийн хэсэгт бэлэн хоол
   * сонгох хэсэгт API-г дуудах." They join the *same* picker as the local
   * cards rather than getting a third mode button, because from the cook's
   * side both answer one question — "which ready dish is this?" — and a mode
   * switch would make them choose a source before choosing a dish.
   *
   * Optional and defaulted to empty, so `child-menu.tsx`'s quick edit and
   * every existing test keep working unchanged.
   */
  esisProducts?: EsisFoodProduct[];
}

/** Value prefix that tells an ESIS product apart from a local recipe id in
 * the one `<select>` that carries both. Recipe ids are UUIDs, so no local
 * value can collide with it. */
const ESIS_OPTION_PREFIX = "esis:";

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
    "min-h-[44px] flex-1 rounded-control px-3 text-body font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";
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
  const esisProducts = kitchen?.esisProducts ?? [];
  /* Either source makes "Бэлэн хоол" a real choice. Before ESIS joined the
     picker this was `kitchen.recipes.length > 0` in three places, and a
     kitchen with no approved card but a live ministry list would have had the
     mode disabled over a dropdown that was ready to use. */
  const hasReadyDishes = (kitchen?.recipes.length ?? 0) > 0 || esisProducts.length > 0;

  function update(index: number, patch: Partial<DishDraft>) {
    onChange(draftDishes.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function remove(index: number) {
    onChange(draftDishes.filter((_, i) => i !== index));
  }

  /*
    ★ Дээр зөөх / Доор зөөх — 2026-09-11, from the client's drawing.

    The order of the rows is the order the day is served in, and it was only
    changeable by deleting a dish and typing it again. A swap with the
    neighbour is the whole of it: a drag handle on a phone fights the page
    scroll, and two menu entries say what they do.
  */
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= draftDishes.length) return;
    const next = [...draftDishes];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
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
    onChange([...draftDishes, newDraft(lastKind, hasReadyDishes)]);
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
              <Card
                key={dish.key}
                pad="compact"
                className={cn("flex flex-col gap-2.5", MEAL_KIND_STYLE[dish.kind].card)}
              >
                {/*
                  ★ The sitting names the card — the client's 2026-09-11
                  drawing: its glyph, its label and its time, in its own tint.

                  The rows were five identical white boxes whose only difference
                  was a "Хоолны цаг" select three fields down. A cook scanning a
                  day for the afternoon snack had to read every card; now the
                  purple one is the afternoon snack.
                */}
                <div className="flex items-center gap-2">
                  <span className={cn("shrink-0", MEAL_KIND_STYLE[dish.kind].title)}>
                    {MEAL_KIND_STYLE[dish.kind].icon}
                  </span>
                  <p
                    className={cn(
                      "min-w-0 flex-1 truncate font-semibold",
                      MEAL_KIND_STYLE[dish.kind].title,
                    )}
                  >
                    {MEAL_KIND_LABEL[dish.kind]}
                  </p>
                  <span className="shrink-0 text-caption font-semibold tabular-nums text-muted">
                    {MEAL_KIND_TIME[dish.kind]}
                  </span>
                  <RowMenu
                    ariaLabel={`${dish.name || MEAL_KIND_LABEL[dish.kind]} — үйлдэл`}
                    items={[
                      ...(i > 0
                        ? [
                            {
                              label: "Дээр зөөх",
                              icon: <ArrowUp size={16} aria-hidden="true" />,
                              onSelect: () => move(i, -1),
                            },
                          ]
                        : []),
                      ...(i < draftDishes.length - 1
                        ? [
                            {
                              label: "Доор зөөх",
                              icon: <ArrowDown size={16} aria-hidden="true" />,
                              onSelect: () => move(i, 1),
                            },
                          ]
                        : []),
                      {
                        label: "Устгах",
                        icon: <Trash2 size={16} aria-hidden="true" />,
                        tone: "danger" as const,
                        separated: true,
                        onSelect: () => remove(i),
                      },
                    ]}
                  />
                </div>

                {kitchen ? (
                  <ModeSwitch
                    value={dish.useRecipe}
                    hasRecipes={hasReadyDishes}
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
                          !hasReadyDishes
                            ? undefined
                            : dish.esisProductId
                              ? /*
                                   ★ A different promise, because a different
                                   thing happens. A local card's values are
                                   frozen server-side from the card; an ESIS
                                   product's are copied onto this form and
                                   saved as ordinary values — and it carries no
                                   allergen list at all, which the cook has to
                                   know before RFP Module 2's cross-check
                                   silently has nothing to check.
                                */
                                "ESIS-ээс нэр, илчлэг бөглөгдлөө. Харшлын мэдээллийг гараар нэмнэ үү"
                              : "Орц, илчлэг, харшил нь картаас өөрөө бөглөгдөнө"
                        }
                      >
                        {({ id, describedBy }) =>
                          kitchen.recipes.length === 0 && esisProducts.length === 0 ? (
                            <NoApprovedRecipes />
                          ) : (
                            <Select
                              id={id}
                              aria-describedby={describedBy}
                              value={
                                dish.recipeId ||
                                (dish.esisProductId
                                  ? `${ESIS_OPTION_PREFIX}${dish.esisProductId}`
                                  : "")
                              }
                              onChange={(e) => {
                                const value = e.target.value;

                                /*
                                 * ★ An ESIS product copies its values onto the
                                 * draft and leaves `recipeId` empty — see
                                 * `DishDraft.esisProductId` for why it must
                                 * never be written there.
                                 *
                                 * `portions` is deliberately not defaulted to
                                 * "1" the way a card's is. A технологийн карт
                                 * declares a `yieldPortions`, so "one batch"
                                 * means something; the ministry's reference is
                                 * a single порц with no batch size to multiply,
                                 * and pre-filling a count nobody stated would
                                 * be inventing data.
                                 */
                                if (value.startsWith(ESIS_OPTION_PREFIX)) {
                                  const productId = value.slice(ESIS_OPTION_PREFIX.length);
                                  const product = esisProducts.find(
                                    (p) => p.productId === productId,
                                  );
                                  update(i, {
                                    recipeId: "",
                                    esisProductId: productId,
                                    name: product?.name ?? "",
                                    calories: product?.calories ?? "",
                                  });
                                  return;
                                }

                                const picked = kitchen.recipes.find((r) => r.id === value);
                                update(i, {
                                  recipeId: value,
                                  // Picking a local card drops any ESIS origin;
                                  // a row has one source at a time.
                                  esisProductId: "",
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
                                  portions: value ? dish.portions || "1" : "",
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
                              {/*
                                ★ Last, and in a group that names its source.
                                The kindergarten's own approved cards are what
                                a cook should reach for first — those carry the
                                allergen list RFP Module 2's cross-check reads,
                                and an ESIS product carries none.
                              */}
                              {esisProducts.length > 0 ? (
                                <optgroup label="ESIS — бэлэн бүтээгдэхүүн">
                                  {esisProducts.map((product) => (
                                    <option
                                      key={product.productId}
                                      value={`${ESIS_OPTION_PREFIX}${product.productId}`}
                                    >
                                      {product.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                            </Select>
                          )
                        }
                      </Field>
                    ) : dish.useRecipe ? (
                      /*
                       * ★ A recipe-linked dish on a screen with no `kitchen`
                       * prop — `child-menu.tsx`'s quick edit from inside a
                       * child's page. It reads the name, it does not offer to
                       * change it.
                       *
                       * An editable input here would be a form that lies:
                       * `MealsService.saveDay` re-freezes a recipe-linked
                       * dish's name from the card, so a teacher could type over
                       * it, press Хадгалах, get a success toast, and watch the
                       * old name come back. That is the same class of bug as
                       * the silently dropped dish above — the save reports
                       * success and does something else.
                       */
                      <Field label="Хоолны нэр">
                        {() => (
                          <p className="flex h-12 items-center text-body text-ink">
                            {recipe?.name ?? dish.name}
                          </p>
                        )}
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

                  {/*
                    ★ An ESIS-picked dish takes the free-text fields, not the
                    card's "Багцын тоо".

                    A технологийн карт declares a `yieldPortions`, so a batch
                    count multiplies into "хэдэн хүүхдэд" — the hint below does
                    exactly that arithmetic. The ministry's reference declares
                    no batch size, so the same control would multiply by zero
                    and say "0 хүүхдэд" under every ESIS dish.

                    ★★ More importantly it is the only way the cook can reach
                    "Харшлын орц". `MealsService.saveDay` freezes allergens from
                    a *card*; an ESIS product carries none, and RFP Module 2's
                    cross-check reads `dish.allergenTags` and nothing else. A
                    dish with no route to that field is a dish the allergy
                    warning can never fire for.
                  */}
                  {dish.useRecipe && !dish.esisProductId ? (
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

                {/*
                  ★ "Зураг солих" once there is one, "Зураг нэмэх" while there
                  is not — 2026-09-11, the client's drawing.

                  One word, and it is the difference between a control that
                  looks like it will add a second photograph and one that says
                  it replaces the first. A dish carries exactly one.
                */}
                {kitchen ? (
                  <div className="flex flex-col gap-1 border-t border-border-soft pt-2.5">
                    <span className="text-caption font-medium text-muted">Хоолны зураг</span>
                    <SingleImageUpload
                      endpoint={`/kindergartens/${kitchen.kindergartenId}/menu/dish-photo`}
                      currentMediaId={dish.photoMediaFileId || null}
                      label={dish.photoMediaFileId ? "Зураг солих" : "Зураг нэмэх"}
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
        Хоолны цаг нэмэх
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
