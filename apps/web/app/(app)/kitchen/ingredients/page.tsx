"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  INGREDIENT_CATEGORIES,
  INGREDIENT_UNIT_LABEL,
  ingredientSchema,
  paginated,
  type Ingredient,
  type IngredientUnit,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/use-debounced";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { ArchiveButton } from "@/components/ui/archive-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";

const ingredientsSchema = paginated(ingredientSchema);

const COLUMNS = [
  { key: "category", label: "Ангилал", className: "md:w-[180px]" },
  { key: "unit", label: "Нэгж", className: "md:w-[80px]" },
  { key: "calories", label: "Ккал/100", className: "md:w-[100px]" },
  { key: "allergens", label: "Харшил", className: "md:w-[190px]" },
];

/**
 * Түүхий эд — the kitchen's ingredient catalog. Every technology card's
 * ingredient lines and its nutrition figure are drawn from these rows, so
 * this is the screen everything else in Хоол үйлдвэрлэл is built on.
 */
export default function IngredientsPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <Ingredients />
    </RequireRole>
  );
}

function Ingredients() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const search = useDebounced(query.trim());

  // A filter change lands on a page that may no longer exist — back to the
  // first page rather than an empty screen with a working pager beside it.
  useEffect(() => setPage(1), [search, category]);

  const filters = { page, q: search || undefined, category: category || undefined };

  const list = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kitchen.ingredients(kindergartenId ?? "", filters),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (search) params.set("q", search);
      if (category) params.set("category", category);
      return get(`/kindergartens/${kindergartenId}/ingredients?${params}`, ingredientsSchema);
    },
  });

  const items = list.data?.items ?? [];
  const filtered = Boolean(search || category);

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Түүхий эд"
        actions={
          kindergartenId ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={18} />
              Орц нэмэх
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            aria-label="Орцны нэрээр хайх"
            placeholder="Нэрээр хайх"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-11"
          />
        </div>

        <Field label="Ангилал" className="min-w-[200px]">
          {({ id }) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Бүгд</option>
              {INGREDIENT_CATEGORIES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {list.isLoading ? <LoadingState rows={4} /> : null}
      {list.isError ? <ErrorState description={errorMessage(list.error)} /> : null}

      {list.data && items.length === 0 ? (
        <EmptyState
          title={filtered ? "Олдсонгүй" : "Орц бүртгэгдээгүй байна"}
          description={
            filtered
              ? "Өөр нэр эсвэл ангиллаар хайж үзнэ үү."
              : "Технологийн карт үүсгэхийн өмнө орцоо бүртгэнэ үү."
          }
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <ResultCount total={list.data?.total ?? 0} noun="орц" />
          <DataList columns={COLUMNS} leadWidth={null} actionsWidth="w-[96px]">
            {items.map((ingredient) => (
              <IngredientRow
                key={ingredient.id}
                ingredient={ingredient}
                kindergartenId={kindergartenId!}
              />
            ))}
          </DataList>
          <Pagination page={page} totalPages={list.data?.totalPages ?? 1} onPage={setPage} />
        </>
      ) : null}

      {creating && kindergartenId ? (
        <IngredientFormDialog
          kindergartenId={kindergartenId}
          open={creating}
          onOpenChange={setCreating}
        />
      ) : null}
    </div>
  );
}

function IngredientRow({
  ingredient,
  kindergartenId,
}: {
  ingredient: Ingredient;
  kindergartenId: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <DataRow
        title={ingredient.name}
        subtitle={ingredient.note ?? undefined}
        cells={{
          category: ingredient.category ? (
            <Badge tone="sky">{ingredient.category}</Badge>
          ) : (
            <span className="text-body text-faint">—</span>
          ),
          unit: (
            <span className="text-body text-ink">{INGREDIENT_UNIT_LABEL[ingredient.unit]}</span>
          ),
          calories: (
            <span className="text-body tabular-nums text-ink">
              {ingredient.caloriesPer100 ?? "—"}
            </span>
          ),
          allergens:
            ingredient.allergenTags.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {ingredient.allergenTags.map((tag) => (
                  <Badge key={tag} tone="peach">
                    {tag}
                  </Badge>
                ))}
              </span>
            ) : (
              <span className="text-body text-faint">—</span>
            ),
        }}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditing(true)}
              aria-label={`"${ingredient.name}" засах`}
            >
              <Pencil size={18} aria-hidden="true" />
            </Button>
            <ArchiveButton
              path={`/ingredients/${ingredient.id}`}
              label="Архивлах"
              confirmation={`"${ingredient.name}" орцыг архивлах уу?`}
              invalidate={[["kitchen", "ingredients"]]}
              variant="ghost"
              iconOnly
            />
          </>
        }
      />

      {editing ? (
        <IngredientFormDialog
          kindergartenId={kindergartenId}
          ingredient={ingredient}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </>
  );
}

function IngredientFormDialog({
  kindergartenId,
  ingredient,
  open,
  onOpenChange,
}: {
  kindergartenId: string;
  ingredient?: Ingredient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = Boolean(ingredient);

  const [name, setName] = useState(ingredient?.name ?? "");
  const [unit, setUnit] = useState<IngredientUnit>(ingredient?.unit ?? "GRAM");
  const [category, setCategory] = useState(ingredient?.category ?? "");
  const [calories, setCalories] = useState(ingredient?.caloriesPer100 ?? "");
  const [protein, setProtein] = useState(ingredient?.proteinPer100 ?? "");
  const [fat, setFat] = useState(ingredient?.fatPer100 ?? "");
  const [carbs, setCarbs] = useState(ingredient?.carbsPer100 ?? "");
  const [allergenTags, setAllergenTags] = useState(ingredient?.allergenTags.join(", ") ?? "");
  const [note, setNote] = useState(ingredient?.note ?? "");

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        unit,
        category: category || null,
        caloriesPer100: calories.trim() || null,
        proteinPer100: protein.trim() || null,
        fatPer100: fat.trim() || null,
        carbsPer100: carbs.trim() || null,
        allergenTags: allergenTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        note: note.trim() || null,
      };
      return isEdit
        ? mutate(`/ingredients/${ingredient!.id}`, ingredientSchema, { method: "PATCH", body })
        : mutate(`/kindergartens/${kindergartenId}/ingredients`, ingredientSchema, {
            method: "POST",
            body,
          });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Орц хадгалагдлаа." : "Орц нэмэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "ingredients"] });
      onOpenChange(false);
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={save.isPending}
      title={isEdit ? "Орц засах" : "Орц нэмэх"}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            Болих
          </Button>
          <Button type="submit" form="ingredient-form" size="sm" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <form
        id="ingredient-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !save.isPending) save.mutate();
        }}
      >
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
          }
        />

        <Field label="Нэр" error={errors.name} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Жишээ нь: Гурил"
              autoFocus
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Хэмжих нэгж" error={errors.unit} required>
            {({ id }) => (
              <Select
                id={id}
                value={unit}
                onChange={(e) => setUnit(e.target.value as IngredientUnit)}
              >
                {Object.entries(INGREDIENT_UNIT_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Ангилал" error={errors.category}>
            {({ id }) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Сонгоогүй</option>
                {INGREDIENT_CATEGORIES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Ккал / 100" error={errors.caloriesPer100} hint="Тоо">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={0}
                step="0.01"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
              />
            )}
          </Field>
          <Field label="Уураг / 100" error={errors.proteinPer100}>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={0}
                step="0.01"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
              />
            )}
          </Field>
          <Field label="Өөх тос / 100" error={errors.fatPer100}>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={0}
                step="0.01"
                value={fat}
                onChange={(e) => setFat(e.target.value)}
              />
            )}
          </Field>
          <Field label="Нүүрс ус / 100" error={errors.carbsPer100}>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={0}
                step="0.01"
                value={carbs}
                onChange={(e) => setCarbs(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Харшлын шошго"
          error={errors.allergenTags}
          hint="Таслалаар тусгаарлана. Жишээ нь: сүү, самар"
        >
          {({ id }) => (
            <Input id={id} value={allergenTags} onChange={(e) => setAllergenTags(e.target.value)} />
          )}
        </Field>

        <Field label="Тэмдэглэл" error={errors.note}>
          {({ id }) => (
            <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}
