"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { INGREDIENT_UNIT_LABEL, ingredientSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { SearchField } from "@/components/ui/search-field";
import { FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import {
  allIngredients,
  foodResourceQuery,
  ingredientFromEsis,
  rowsOf,
  sameName,
  useEsisFoodAccess,
} from "@/components/kitchen/esis-food";
import { EsisButton } from "@/components/esis/esis-button";

/**
 * «ESIS-ээс татах» beside «Орц нэмэх» — client, 2026-10-06. It replaces the
 * two reference tables that sat under the list: the cook searches the
 * ministry's materials, ticks several, and they are added to the kitchen's
 * own catalog with the name, unit, calories per 100 and a category taken
 * from the ESIS group.
 *
 * ★ A material the kitchen already holds — same name, any case — is shown as
 * «Танайд байгаа» and cannot be ticked, so pulling twice never duplicates.
 * One whose unit `esisUnit` does not know cannot be ticked either; adding it
 * with a guessed unit would put a wrong amount on every card that uses it.
 */
export function EsisIngredientImport({ kindergartenId }: { kindergartenId: string }) {
  const allowed = useEsisFoodAccess(kindergartenId, ["foodMaterials"]);
  const [open, setOpen] = useState(false);

  if (!allowed) return null;

  return (
    <>
      <EsisButton onClick={() => setOpen(true)} />
      {open ? (
        <ImportDialog kindergartenId={kindergartenId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function ImportDialog({
  kindergartenId,
  onClose,
}: {
  kindergartenId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materials = useQuery(foodResourceQuery(kindergartenId, "foodMaterials"));
  const groups = useQuery(foodResourceQuery(kindergartenId, "foodMaterialGroups"));
  const owned = useQuery({
    queryKey: ["kitchen", "ingredients", kindergartenId, "all-names"],
    queryFn: () => allIngredients(kindergartenId),
  });

  const groupName = new Map(rowsOf(groups.data).map((row) => [row.groupId, row.groupName]));
  const rows = rowsOf(materials.data)
    .filter((row) => row.materialId && row.materialName?.trim())
    .map((row) => {
      const body = ingredientFromEsis(row, groupName.get(row.groupId ?? ""));
      const name = row.materialName!.trim();
      const exists = (owned.data ?? []).some((item) => sameName(item.name, name));
      return { id: row.materialId!, name, body, exists };
    });

  const term = query.trim().toLocaleLowerCase("mn");
  const shown = term ? rows.filter((row) => row.name.toLocaleLowerCase("mn").includes(term)) : rows;
  const chosen = rows.filter((row) => picked.has(row.id) && row.body && !row.exists);

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function add() {
    setBusy(true);
    setError(null);
    const done = new Set<string>();
    let added = 0;
    try {
      for (const row of chosen) {
        // Two ESIS rows can share a name; the kitchen keeps one.
        const key = row.name.toLocaleLowerCase("mn");
        if (done.has(key) || !row.body) continue;
        await mutate(`/kindergartens/${kindergartenId}/ingredients`, ingredientSchema, {
          method: "POST",
          body: row.body,
        });
        done.add(key);
        added += 1;
        setPicked((current) => {
          const next = new Set(current);
          next.delete(row.id);
          return next;
        });
      }
      toast.success(`${added} түүхий эд нэмэгдлээ.`);
      onClose();
    } catch (caught) {
      setError(
        `${added > 0 ? `${added} нэмэгдсэн, үлдсэн нь нэмэгдсэнгүй. ` : ""}${errorMessage(caught)}`,
      );
    } finally {
      if (added > 0) void queryClient.invalidateQueries({ queryKey: ["kitchen", "ingredients"] });
      setBusy(false);
    }
  }

  const loading = materials.isLoading || owned.isLoading;
  const failed = materials.isError || materials.data?.status === "FAILED";

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={busy}
      title="ESIS-ээс түүхий эд татах"
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onClose}>
            Болих
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={chosen.length === 0 || busy}
            onClick={() => void add()}
          >
            {busy ? "Нэмж байна…" : `Сонгосныг нэмэх (${chosen.length})`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SearchField
          label="Түүхий эдийн нэрээр хайх"
          placeholder="Жишээ нь: гурил"
          value={query}
          onChange={setQuery}
        />
        <FormError message={error} />

        {loading ? (
          <LoadingState rows={3} />
        ) : failed || rows.length === 0 ? (
          <p className="text-body text-muted">
            ESIS-ээс түүхий эдийн жагсаалт ирсэнгүй. Орцоо «Орц нэмэх»-ээр гараар нэмнэ үү.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-body text-muted">Ийм нэртэй түүхий эд олдсонгүй.</p>
        ) : (
          <>
            <p className="text-caption text-muted">Нийт {shown.length}</p>
            <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
              {shown.map((row) => {
                const disabled = row.exists || !row.body;
                const id = `esis-material-${row.id}`;
                return (
                  <li key={row.id}>
                    <label
                      htmlFor={id}
                      className={`flex min-h-[44px] items-center gap-3 rounded-control px-2 ${
                        disabled ? "text-muted" : "cursor-pointer text-ink hover:bg-canvas"
                      }`}
                    >
                      <input
                        id={id}
                        type="checkbox"
                        className="size-4 shrink-0"
                        checked={!disabled && picked.has(row.id)}
                        disabled={disabled}
                        onChange={() => toggle(row.id)}
                      />
                      <span className="min-w-0 flex-1 truncate text-body">{row.name}</span>
                      <span className="shrink-0 text-caption tabular-nums text-muted">
                        {row.exists
                          ? "✓ Танайд байгаа"
                          : !row.body
                            ? "Нэгж танигдсангүй"
                            : [
                                INGREDIENT_UNIT_LABEL[row.body.unit],
                                row.body.caloriesPer100 ? `${row.body.caloriesPer100} ккал` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </FormDialog>
  );
}
