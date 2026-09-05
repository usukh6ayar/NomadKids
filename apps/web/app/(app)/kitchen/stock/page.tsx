"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import {
  ingredientSchema,
  paginated,
  STOCK_DIRECTION_LABEL,
  stockLevelSchema,
  stockMovementSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { Pagination } from "@/components/ui/pagination";
import { formatDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";

const levelsSchema = z.array(stockLevelSchema);
const movementsSchema = paginated(stockMovementSchema);
const ingredientsSchema = paginated(ingredientSchema);

const DIRECTION_TONE: Record<string, "mint" | "danger" | "sky"> = {
  IN: "mint",
  OUT: "danger",
  ADJUSTMENT: "sky",
};

/** Нөөц, зарцуулалт — current stock and the ledger it is computed from. */
export default function StockPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <Stock />
    </RequireRole>
  );
}

function Stock() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState(false);

  const levels = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kitchen.stock(kindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${kindergartenId}/stock`, levelsSchema),
  });

  const movements = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kitchen.stockMovements(kindergartenId ?? "", { page }),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/stock/movements?page=${page}&pageSize=25`,
        movementsSchema,
      ),
  });

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Нөөц"
        actions={
          kindergartenId ? (
            <Button size="sm" onClick={() => setAdjusting(true)}>
              <Plus size={18} />
              Тохируулга
            </Button>
          ) : null
        }
      />

      <section aria-labelledby="levels-heading">
        <SectionHeader id="levels-heading" title="Одоогийн нөөц" />

        {levels.isLoading ? <LoadingState rows={3} /> : null}
        {levels.isError ? <ErrorState description={errorMessage(levels.error)} /> : null}

        {levels.data && levels.data.length === 0 ? (
          <EmptyState
            title="Нөөцийн хөдөлгөөн алга"
            description="Захиалга хүлээн авах эсвэл цэс хэрэглээнд бүртгэснээр нөөц бүрдэнэ."
          />
        ) : null}

        {levels.data && levels.data.length > 0 ? (
          <Card className="divide-y divide-border-soft">
            {levels.data.map((level) => (
              <div
                key={level.ingredient.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="truncate text-body text-ink">{level.ingredient.name}</span>
                <span
                  className={`shrink-0 text-body font-semibold tabular-nums ${Number(level.onHand) < 0 ? "text-danger" : "text-ink"}`}
                >
                  {level.onHand}
                </span>
              </div>
            ))}
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="movements-heading">
        <SectionHeader id="movements-heading" title="Хөдөлгөөний түүх" />

        {movements.isLoading ? <LoadingState rows={4} /> : null}
        {movements.isError ? <ErrorState description={errorMessage(movements.error)} /> : null}

        {movements.data && movements.data.items.length === 0 ? (
          <EmptyState title="Хөдөлгөөн бүртгэгдээгүй байна" />
        ) : null}

        {movements.data && movements.data.items.length > 0 ? (
          <>
            <Card className="divide-y divide-border-soft">
              {movements.data.items.map((movement) => (
                <div
                  key={movement.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-body font-medium text-ink">
                        {movement.ingredient.name}
                      </span>
                      <Badge tone={DIRECTION_TONE[movement.direction]}>
                        {STOCK_DIRECTION_LABEL[movement.direction]}
                      </Badge>
                    </p>
                    <p className="text-caption text-muted">
                      {formatDate(movement.date)}
                      {movement.note ? ` · ${movement.note}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-body font-semibold tabular-nums text-ink">
                    {movement.quantity}
                  </span>
                </div>
              ))}
            </Card>
            <Pagination page={page} totalPages={movements.data.totalPages} onPage={setPage} />
          </>
        ) : null}
      </section>

      {adjusting && kindergartenId ? (
        <AdjustmentDialog kindergartenId={kindergartenId} onClose={() => setAdjusting(false)} />
      ) : null}
    </div>
  );
}

function AdjustmentDialog({
  kindergartenId,
  onClose,
}: {
  kindergartenId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [ingredientId, setIngredientId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const ingredients = useQuery({
    queryKey: qk.kitchen.ingredients(kindergartenId, { all: true }),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/ingredients?page=1&pageSize=100`, ingredientsSchema),
  });

  const save = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/stock/adjustments`, z.unknown(), {
        method: "POST",
        body: { ingredientId, date, quantity, note: note.trim() || null },
      }),
    onSuccess: () => {
      toast.success("Нөөцийн тохируулга бүртгэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "stock"] });
      onClose();
    },
  });

  const errors = fieldErrors(save.error);
  const canSubmit = ingredientId && date && quantity.trim() && quantity.trim() !== "0";

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={save.isPending}
      title="Нөөцийн тохируулга"
      description="Тоолсон бодит нөөц бүртгэлээс өөр байвал зөрүүг энд оруулна. Эерэг тоо нэмэгдэл, сөрөг тоо хорогдол."
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
            form="adjustment-form"
            size="sm"
            disabled={!canSubmit || save.isPending}
          >
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <form
        id="adjustment-form"
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

        <Field label="Орц" error={errors.ingredientId} required>
          {({ id }) => (
            <Select id={id} value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
              <option value="">Сонгоно уу</option>
              {(ingredients.data?.items ?? []).map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>
                  {ingredient.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Огноо" error={errors.date} required>
            {({ id }) => (
              <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            )}
          </Field>
          <Field label="Хэмжээ (+/-)" error={errors.quantity} required>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Тэмдэглэл" error={errors.note}>
          {({ id }) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </form>
    </FormDialog>
  );
}
