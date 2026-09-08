import { Plus, X } from "lucide-react";
import type { Ingredient } from "@kinder/contracts";
import { Input, Select } from "@/components/ui/field";

export interface RecipeLineDraft {
  key: string;
  ingredientId: string;
  quantity: string;
}

/** Ingredient rows shared by recipe create and edit screens. */
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
            onChange={(event) =>
              onChange(
                lines.map((item) =>
                  item.key === line.key ? { ...item, ingredientId: event.target.value } : item,
                ),
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
            onChange={(event) =>
              onChange(
                lines.map((item) =>
                  item.key === line.key ? { ...item, quantity: event.target.value } : item,
                ),
              )
            }
            className="w-[110px] shrink-0"
            placeholder="Хэмжээ"
          />
          <button
            type="button"
            aria-label={`${index + 1}-р орцыг хасах`}
            onClick={() => onChange(lines.filter((item) => item.key !== line.key))}
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
