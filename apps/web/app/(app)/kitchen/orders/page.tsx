"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  FOOD_ORDER_STATUS_LABEL,
  foodOrderSummarySchema,
  ingredientSchema,
  paginated,
  supplierSchema,
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
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { SearchField } from "@/components/ui/search-field";
import { useDebounced } from "@/lib/use-debounced";

const ordersSchema = paginated(foodOrderSummarySchema);
const suppliersSchema = paginated(supplierSchema);
const ingredientsSchema = paginated(ingredientSchema);

const STATUS_TONE: Record<string, "neutral" | "sky" | "mint" | "danger"> = {
  DRAFT: "neutral",
  ORDERED: "sky",
  RECEIVED: "mint",
  CANCELLED: "danger",
};

const COLUMNS = [
  { key: "date", label: "Огноо", className: "md:w-[110px]" },
  { key: "status", label: "Төлөв", className: "md:w-[110px]" },
  { key: "total", label: "Дүн", className: "md:w-[130px] md:text-right" },
];

/** `"126900.00"` → `"126 900₮"`. */
function money(value: string): string {
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}

/** Хүнсний захиалга — orders placed with suppliers, and their receipt into stock. */
export default function FoodOrdersPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <FoodOrders />
    </RequireRole>
  );
}

function FoodOrders() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const q = useDebounced(query);

  const list = useQuery({
    enabled: Boolean(kindergartenId),
    queryKey: qk.kitchen.foodOrders(kindergartenId ?? "", { q }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "25" });
      if (q) params.set("q", q);
      return get(`/kindergartens/${kindergartenId}/food-orders?${params}`, ordersSchema);
    },
  });

  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Хүнсний захиалга"
        lede="Нийлүүлэгчид өгсөн захиалга. Хүлээн авахад нөөц автоматаар нэмэгдэнэ."
        actions={
          kindergartenId ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={18} />
              Захиалга үүсгэх
            </Button>
          ) : null
        }
      />

      {kindergartenId ? (
        <div className="flex flex-wrap items-end gap-3">
          <SearchField
            label="Нийлүүлэгч, тэмдэглэлээр хайх"
            placeholder="Нийлүүлэгчээр хайх"
            value={query}
            onChange={setQuery}
          />
        </div>
      ) : null}

      {list.isLoading ? <LoadingState rows={3} /> : null}
      {list.isError ? <ErrorState description={errorMessage(list.error)} /> : null}

      {list.data && items.length === 0 ? (
        <EmptyState
          title="Захиалга үүсгээгүй байна"
          description="Нийлүүлэгчээс хүнс захиалахын тулд эхлээд захиалга үүсгэнэ үү."
        />
      ) : null}

      {items.length > 0 ? (
        <DataList columns={COLUMNS} leadWidth={null} actionsWidth={null}>
          {items.map((order) => (
            <DataRow
              key={order.id}
              interactive
              title={
                <Link href={`/kitchen/orders/${order.id}`} className="hover:text-primary">
                  {order.supplier.name}
                </Link>
              }
              subtitle={order.note ?? undefined}
              cells={{
                date: <span className="text-body text-muted">{formatDate(order.orderDate)}</span>,
                status: (
                  <Badge tone={STATUS_TONE[order.status]}>
                    {FOOD_ORDER_STATUS_LABEL[order.status]}
                  </Badge>
                ),
                total: (
                  <span className="block text-body font-semibold tabular-nums text-ink md:text-right">
                    {money(order.totalAmount)}
                  </span>
                ),
              }}
            />
          ))}
        </DataList>
      ) : null}

      {creating && kindergartenId ? (
        <CreateOrderDialog kindergartenId={kindergartenId} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

interface OrderLineDraft {
  key: string;
  ingredientId: string;
  quantity: string;
  unitPrice: string;
}

function CreateOrderDialog({
  kindergartenId,
  onClose,
}: {
  kindergartenId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<OrderLineDraft[]>([]);

  const suppliers = useQuery({
    queryKey: qk.kitchen.suppliers(kindergartenId, { all: true }),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/suppliers?page=1&pageSize=100`, suppliersSchema),
  });
  const ingredients = useQuery({
    queryKey: qk.kitchen.ingredients(kindergartenId, { all: true }),
    queryFn: () =>
      get(`/kindergartens/${kindergartenId}/ingredients?page=1&pageSize=100`, ingredientsSchema),
  });

  const validLines = lines.filter((l) => l.ingredientId && l.quantity.trim() && l.unitPrice.trim());

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/food-orders`, foodOrderSummarySchema, {
        method: "POST",
        body: {
          supplierId,
          orderDate,
          note: note.trim() || null,
          lines: validLines.map((l) => ({
            ingredientId: l.ingredientId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Захиалга үүслээ.");
      void queryClient.invalidateQueries({ queryKey: ["kitchen", "food-orders"] });
      onClose();
    },
  });

  const errors = fieldErrors(create.error);
  const canSubmit = supplierId && orderDate && validLines.length > 0;

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={create.isPending}
      title="Хүнсний захиалга үүсгэх"
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
            form="order-form"
            size="sm"
            disabled={!canSubmit || create.isPending}
          >
            {create.isPending ? "Үүсгэж байна…" : "Үүсгэх"}
          </Button>
        </>
      }
    >
      <form
        id="order-form"
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

        {suppliers.data && suppliers.data.items.length === 0 ? (
          <p className="rounded-control bg-sun px-3 py-2 text-body text-sun-ink">
            Нийлүүлэгч бүртгэгдээгүй байна. Эхлээд «Нийлүүлэгч» хэсгээс нэмнэ үү.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Нийлүүлэгч" error={errors.supplierId} required>
            {({ id }) => (
              <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Сонгоно уу</option>
                {(suppliers.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Огноо" error={errors.orderDate} required>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Захиалгын орц" error={errors.lines} required>
          {() =>
            ingredients.isLoading ? (
              <LoadingState rows={1} />
            ) : (
              <OrderLinesEditor
                lines={lines}
                onChange={setLines}
                ingredients={ingredients.data?.items ?? []}
              />
            )
          }
        </Field>

        <Field label="Тэмдэглэл" error={errors.note}>
          {({ id }) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </form>
    </FormDialog>
  );
}

export function OrderLinesEditor({
  lines,
  onChange,
  ingredients,
}: {
  lines: OrderLineDraft[];
  onChange: (lines: OrderLineDraft[]) => void;
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
            className="w-[100px] shrink-0"
            placeholder="Хэмжээ"
          />
          <Input
            aria-label={`${index + 1}-р орцны нэгж үнэ`}
            type="number"
            min={0}
            step="0.01"
            value={line.unitPrice}
            onChange={(e) =>
              onChange(
                lines.map((l) => (l.key === line.key ? { ...l, unitPrice: e.target.value } : l)),
              )
            }
            className="w-[110px] shrink-0"
            placeholder="Нэгж үнэ"
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
          onChange([
            ...lines,
            { key: crypto.randomUUID(), ingredientId: "", quantity: "", unitPrice: "" },
          ])
        }
        className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-body font-medium text-primary hover:text-primary-strong"
      >
        <Plus size={16} aria-hidden="true" />
        Орц нэмэх
      </button>
    </div>
  );
}
