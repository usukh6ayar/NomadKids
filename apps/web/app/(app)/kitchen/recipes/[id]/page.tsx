"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ingredientSchema,
  MEAL_KIND_LABEL,
  paginated,
  RECIPE_STATUS_LABEL,
  recipeSchema,
  type Recipe,
  type RecipeCost,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatTugrug } from "@/lib/funding-meta";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { ArchiveButton } from "@/components/ui/archive-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { RecipeLinesEditor, type RecipeLineDraft } from "@/components/kitchen/recipe-lines-editor";

const ingredientsSchema = paginated(ingredientSchema);

export default function RecipeDetailPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <RecipeDetail />
    </RequireRole>
  );
}

function RecipeDetail() {
  const params = useParams<{ id: string }>();
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  const recipe = useQuery({
    queryKey: qk.kitchen.recipe(params.id),
    queryFn: () => get(`/recipes/${params.id}`, recipeSchema),
  });

  const approve = useMutation({
    mutationFn: () => mutate(`/recipes/${params.id}/approve`, recipeSchema, { method: "POST" }),
    onSuccess: () => {
      toast.success("Технологийн карт батлагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.kitchen.recipe(params.id) });
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "recipes"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (recipe.isLoading) return <LoadingState rows={4} />;
  if (recipe.isError) return <ErrorState description={errorMessage(recipe.error)} />;
  if (!recipe.data) return null;

  const data = recipe.data;
  const isDraft = data.status === "DRAFT";

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title={data.name}
        lede={data.mealKind ? MEAL_KIND_LABEL[data.mealKind] : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={isDraft ? "neutral" : "mint"}>{RECIPE_STATUS_LABEL[data.status]}</Badge>
            {isDraft ? (
              <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate()}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {approve.isPending ? "Батлаж байна…" : "Батлах"}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden="true" />
              Засах
            </Button>
            <ArchiveButton
              path={`/recipes/${data.id}`}
              label="Архивлах"
              confirmation={`"${data.name}" технологийн картыг архивлах уу?`}
              invalidate={[["kitchen", "recipes"]]}
              redirectTo="/kitchen/recipes"
              variant="secondary"
            />
          </div>
        }
      />

      {approve.isError ? (
        <p className="text-caption text-danger">{errorMessage(approve.error)}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card pad="roomy" className="flex flex-col gap-3">
          <SectionHeader title="Шим тэжээл (1 порц)" />
          <dl className="grid grid-cols-2 gap-3">
            <NutritionStat label="Калори" value={data.nutritionPerPortion.calories} unit="ккал" />
            <NutritionStat label="Уураг" value={data.nutritionPerPortion.protein} unit="г" />
            <NutritionStat label="Өөх тос" value={data.nutritionPerPortion.fat} unit="г" />
            <NutritionStat label="Нүүрс ус" value={data.nutritionPerPortion.carbs} unit="г" />
          </dl>
          <p className="text-caption text-muted">{data.yieldPortions} порцын жороор бодов.</p>
        </Card>

        {/*
          Нэг хүүхдэд ногдох өртөг — А/261, цэцэрлэгийн шалгуур 38.

          ★ Beside the nutrition card, not below the ingredient list, because
          the criterion names them in one breath: "нэг хүүхдэд ногдох хүнсний
          түүхий эд, бүтээгдэхүүний өртөг, шим тэжээл, илчлэг". A reader
          checking a card against the order reads both figures together.

          ★★ Only the cook and the administrator ever get here — the route is
          `RequireRole roles={["COOK", "ADMIN"]}` and the endpoint behind it is
          `assertCanManageKitchen`. A teacher must not see a price at all.
        */}
        {data.cost ? <CostCard cost={data.cost} portions={data.yieldPortions} /> : null}

        <Card pad="roomy" className="flex flex-col gap-3">
          <SectionHeader title="Харшлын шошго" lede="Орцноос автоматаар тодорхойлогдоно." />
          {data.allergenTags.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {data.allergenTags.map((tag) => (
                <Badge key={tag} tone="peach">
                  {tag}
                </Badge>
              ))}
            </span>
          ) : (
            <p className="text-body text-muted">Харшил үүсгэдэг орц алга.</p>
          )}
        </Card>
      </div>

      <section aria-labelledby="lines-heading">
        <SectionHeader id="lines-heading" title="Орцны жагсаалт" />
        <Card className="divide-y divide-border-soft">
          {data.ingredients.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-body text-ink">{line.ingredient.name}</span>
              <span className="text-body tabular-nums text-muted">{line.quantity}</span>
            </div>
          ))}
        </Card>
      </section>

      {data.instructions ? (
        <section aria-labelledby="instructions-heading">
          <SectionHeader id="instructions-heading" title="Хийх заавар" />
          <Card pad="roomy">
            <p className="whitespace-pre-wrap text-body text-ink">{data.instructions}</p>
          </Card>
        </section>
      ) : null}

      {editing && kindergartenId ? (
        <EditRecipeDialog
          kindergartenId={kindergartenId}
          recipe={data}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Нэг хүүхдэд ногдох өртөг.
 *
 * ★ The unpriced case is the whole design of this card.
 *
 * `null` never means free — it means an ingredient has no purchase history, so
 * the total cannot be known. Rendering "₮0" there would be a confident lie
 * nobody can see through, which is why the empty state names the ingredients
 * to go and buy instead of showing a figure.
 */
function CostCard({ cost, portions }: { cost: RecipeCost; portions: number }) {
  const missing = cost.unpricedIngredients;

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <SectionHeader title="Өртөг (1 порц)" lede="Хамгийн сүүлийн худалдан авалтын үнээр бодов." />

      {cost.perPortion === null ? (
        <>
          <p className="text-body text-muted">
            {missing.length > 0
              ? "Дараах орцын худалдан авалт бүртгэгдээгүй тул өртөг тооцох боломжгүй:"
              : "Орц бүртгэгдээгүй тул өртөг тооцох боломжгүй."}
          </p>
          {missing.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {missing.map((name) => (
                <Badge key={name} tone="sun">
                  {name}
                </Badge>
              ))}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-caption text-muted">1 порц</dt>
              <dd className="text-lead font-semibold tabular-nums text-ink">
                {formatTugrug(cost.perPortion)}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted">Бүх багц ({portions} порц)</dt>
              <dd className="text-lead font-semibold tabular-nums text-ink">
                {formatTugrug(cost.total)}
              </dd>
            </div>
          </dl>
          {/*
            The date is not decoration. A cost moves every time the kitchen
            buys, so a figure with no date attached reads as a property of the
            recipe rather than of the market — and the two disagree by the time
            anybody checks.
          */}
          <p className="text-caption text-muted">{cost.pricedOn}-ний үнээр бодов.</p>
        </>
      )}
    </Card>
  );
}

function NutritionStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit: string;
}) {
  return (
    <div>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-lead font-semibold tabular-nums text-ink">
        {value ?? "—"}
        {value !== null ? (
          <span className="ml-1 text-caption font-normal text-muted">{unit}</span>
        ) : null}
      </dd>
    </div>
  );
}

function EditRecipeDialog({
  kindergartenId,
  recipe,
  onClose,
}: {
  kindergartenId: string;
  recipe: Recipe;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(recipe.name);
  const [mealKind, setMealKind] = useState(recipe.mealKind ?? "");
  const [yieldPortions, setYieldPortions] = useState(String(recipe.yieldPortions));
  const [instructions, setInstructions] = useState(recipe.instructions ?? "");
  const [lines, setLines] = useState<RecipeLineDraft[]>(
    recipe.ingredients.map((line) => ({
      key: line.id,
      ingredientId: line.ingredient.id,
      quantity: line.quantity,
    })),
  );

  const ingredients = useQuery({
    queryKey: qk.kitchen.ingredients(kindergartenId, { all: true }),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/ingredients?page=1&pageSize=100`, ingredientsSchema),
  });

  const validLines = lines.filter((l) => l.ingredientId && l.quantity.trim());

  const save = useMutation({
    mutationFn: () =>
      mutate(`/recipes/${recipe.id}`, recipeSchema, {
        method: "PATCH",
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
      toast.success("Технологийн карт хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.kitchen.recipe(recipe.id) });
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "recipes"] });
      onClose();
    },
  });

  const errors = fieldErrors(save.error);
  const canSubmit = name.trim() && Number(yieldPortions) > 0 && validLines.length > 0;

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={save.isPending}
      title="Технологийн карт засах"
      description={
        recipe.status === "APPROVED"
          ? "Өөрчлөлт оруулбал карт дахин баталгаажуулах шаардлагатай болно."
          : undefined
      }
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={save.isPending}
            onClick={onClose}
          >
            Болих
          </Button>
          <Button
            type="submit"
            form="edit-recipe-form"
            size="sm"
            disabled={!canSubmit || save.isPending}
          >
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <form
        id="edit-recipe-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !save.isPending) save.mutate();
        }}
      >
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
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

        <Field label="Орцны жагсаалт" error={errors.ingredients} required>
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
