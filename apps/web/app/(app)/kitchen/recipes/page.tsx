"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  ingredientSchema,
  MEAL_KIND_LABEL,
  paginated,
  RECIPE_STATUS_LABEL,
  recipeSummarySchema,
  type Ingredient,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

const recipesSchema = paginated(recipeSummarySchema);
const ingredientsSchema = paginated(ingredientSchema);

const COLUMNS = [
  { key: "status", label: "Төлөв", className: "md:w-[110px]" },
  { key: "portions", label: "Порц", className: "md:w-[80px]" },
  { key: "calories", label: "Ккал/порц", className: "md:w-[110px]" },
];

/**
 * Технологийн карт — the recipe cards the menu's dishes point at. A DRAFT
 * card cannot be attached to a menu day; approving one is the "Батлагдсан
 * цэс" this whole module exists for.
 */
export default function RecipesPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <Recipes />
    </RequireRole>
  );
}

function Recipes() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [status, setStatus] = useState<"" | "DRAFT" | "APPROVED">("");
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kitchen.recipes(kindergartenId ?? "", { status }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "100" });
      if (status) params.set("status", status);
      return get(`/kindergartens/${kindergartenId}/recipes?${params}`, recipesSchema);
    },
  });

  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Технологийн карт"
        lede="Орц, порц, шим тэжээлийн тооцоо бүхий батлагдсан жор."
        actions={
          kindergartenId ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={18} />
              Карт нэмэх
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2">
        {(
          [
            { value: "", label: "Бүгд" },
            { value: "DRAFT", label: "Ноорог" },
            { value: "APPROVED", label: "Батлагдсан" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={`min-h-[44px] rounded-pill border px-3.5 text-body font-medium transition-colors ${
              status === tab.value
                ? "border-primary bg-primary-soft text-primary"
                : "border-border bg-surface text-muted hover:bg-canvas"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {list.isLoading ? <LoadingState rows={4} /> : null}
      {list.isError ? <ErrorState description={errorMessage(list.error)} /> : null}

      {list.data && items.length === 0 ? (
        <EmptyState
          title="Технологийн карт үүсгээгүй байна"
          description="Цэсэнд батлагдсан жор ашиглахын тулд эхлээд карт үүсгэнэ үү."
        />
      ) : null}

      {items.length > 0 ? (
        <DataList columns={COLUMNS} leadWidth={null} actionsWidth={null}>
          {items.map((recipe) => (
            <DataRow
              key={recipe.id}
              interactive
              title={
                <Link href={`/kitchen/recipes/${recipe.id}`} className="hover:text-primary">
                  {recipe.name}
                </Link>
              }
              subtitle={recipe.mealKind ? MEAL_KIND_LABEL[recipe.mealKind] : undefined}
              cells={{
                status: (
                  <Badge tone={recipe.status === "APPROVED" ? "mint" : "neutral"}>
                    {RECIPE_STATUS_LABEL[recipe.status]}
                  </Badge>
                ),
                portions: (
                  <span className="text-body tabular-nums text-ink">{recipe.yieldPortions}</span>
                ),
                calories: (
                  <span className="text-body tabular-nums text-ink">
                    {recipe.nutritionPerPortion.calories ?? "—"}
                  </span>
                ),
              }}
              actions={
                recipe.status === "DRAFT" && kindergartenId ? (
                  <ApproveButton recipeId={recipe.id} name={recipe.name} />
                ) : null
              }
            />
          ))}
        </DataList>
      ) : null}

      {creating && kindergartenId ? (
        <CreateRecipeDialog kindergartenId={kindergartenId} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

/**
 * Батлах, from the list rather than only from the card's own page.
 *
 * ★ A DRAFT card is invisible to the menu — `/recipes/approved` filters on
 * `status: "APPROVED"`, so until a card is approved the cook's menu screen has
 * nothing to offer them. A kindergarten seeded from `kitchen-reference.ts`
 * starts with **eight** drafts, and approving them one at a time meant eight
 * navigations into and back out of a detail page to press the same button.
 *
 * ★★ It is not a bulk "approve everything". Approval is the cook saying they
 * have read the card and it matches what this kitchen actually does — a single
 * button that waves through eight recipes' allergen lists would make that
 * signature meaningless, and allergens are the one thing in this module that
 * reaches a child. One press per card, in one place.
 */
function ApproveButton({ recipeId, name }: { recipeId: string; name: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const approve = useMutation({
    mutationFn: () =>
      mutate(`/recipes/${recipeId}/approve`, recipeSummarySchema, { method: "POST" }),
    onSuccess: () => {
      toast.success(`“${name}” батлагдлаа. Цэсэнд сонгох боломжтой боллоо.`);
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "recipes"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={approve.isPending}
      onClick={() => approve.mutate()}
    >
      <Check size={16} aria-hidden="true" />
      {approve.isPending ? "Батлаж байна…" : "Батлах"}
    </Button>
  );
}

/**
 * One ingredient line — a select and a quantity, shared between recipe
 * creation here and editing on the detail page.
 */
export interface RecipeLineDraft {
  key: string;
  ingredientId: string;
  quantity: string;
}

export function RecipeLinesEditor({
  lines,
  onChange,
  ingredients,
}: {
  lines: RecipeLineDraft[];
  onChange: (lines: RecipeLineDraft[]) => void;
  ingredients: Ingredient[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, index) => (
        <div key={line.key} className="flex items-center gap-2">
          <Select
            aria-label={`${index + 1}-р орц`}
            value={line.ingredientId}
            onChange={(e) =>
              onChange(
                lines.map((l) => (l.key === line.key ? { ...l, ingredientId: e.target.value } : l)),
              )
            }
            className="min-w-0 flex-1"
          >
            <option value="">Орц сонгоно уу</option>
            {ingredients.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.name}
              </option>
            ))}
          </Select>
          <Input
            aria-label={`${index + 1}-р орцны хэмжээ`}
            type="number"
            min={0}
            step="0.01"
            value={line.quantity}
            onChange={(e) =>
              onChange(
                lines.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value } : l)),
              )
            }
            className="w-[110px] shrink-0"
            placeholder="Хэмжээ"
          />
          <button
            type="button"
            aria-label={`${index + 1}-р орцыг хасах`}
            onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
            className="grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-danger"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          onChange([...lines, { key: crypto.randomUUID(), ingredientId: "", quantity: "" }])
        }
        className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-body font-medium text-primary hover:text-primary-strong"
      >
        <Plus size={16} aria-hidden="true" />
        Орц нэмэх
      </button>
    </div>
  );
}

function CreateRecipeDialog({
  kindergartenId,
  onClose,
}: {
  kindergartenId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [mealKind, setMealKind] = useState("");
  const [yieldPortions, setYieldPortions] = useState("10");
  const [instructions, setInstructions] = useState("");
  const [lines, setLines] = useState<RecipeLineDraft[]>([]);

  const ingredients = useQuery({
    queryKey: qk.kitchen.ingredients(kindergartenId, { all: true }),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/ingredients?page=1&pageSize=100`, ingredientsSchema),
  });

  const validLines = lines.filter((l) => l.ingredientId && l.quantity.trim());

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/recipes`, recipeSummarySchema, {
        method: "POST",
        body: {
          name: name.trim(),
          mealKind: mealKind || null,
          yieldPortions: Number(yieldPortions),
          instructions: instructions.trim() || null,
          ingredients: validLines.map((l) => ({
            ingredientId: l.ingredientId,
            quantity: l.quantity,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Технологийн карт үүслээ.");
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "recipes"] });
      onClose();
    },
  });

  const errors = fieldErrors(create.error);
  const canSubmit = name.trim() && Number(yieldPortions) > 0 && validLines.length > 0;

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={create.isPending}
      title="Технологийн карт нэмэх"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={create.isPending}
            onClick={onClose}
          >
            Болих
          </Button>
          <Button
            type="submit"
            form="recipe-form"
            size="sm"
            disabled={!canSubmit || create.isPending}
          >
            {create.isPending ? "Үүсгэж байна…" : "Үүсгэх"}
          </Button>
        </>
      }
    >
      <form
        id="recipe-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !create.isPending) create.mutate();
        }}
      >
        <FormError
          message={
            create.isError && Object.keys(errors).length === 0 ? errorMessage(create.error) : null
          }
        />

        <Field label="Хоолны нэр" error={errors.name} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Жишээ нь: Цагаан будаатай шөл"
              autoFocus
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Хоолны төрөл" error={errors.mealKind}>
            {({ id }) => (
              <Select id={id} value={mealKind} onChange={(e) => setMealKind(e.target.value)}>
                <option value="">Сонгоогүй</option>
                {Object.entries(MEAL_KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Порцын тоо" error={errors.yieldPortions} required>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={1}
                value={yieldPortions}
                onChange={(e) => setYieldPortions(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Орцны жагсаалт"
          error={errors.ingredients}
          required
          hint="Жорын жин — г/мл/ширхэгээр"
        >
          {() =>
            ingredients.isLoading ? (
              <LoadingState rows={1} />
            ) : (
              <RecipeLinesEditor
                lines={lines}
                onChange={setLines}
                ingredients={ingredients.data?.items ?? []}
              />
            )
          }
        </Field>

        <Field label="Хийх заавар" error={errors.instructions}>
          {({ id }) => (
            <Textarea
              id={id}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
            />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}
