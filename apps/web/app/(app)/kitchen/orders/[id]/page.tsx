"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { FOOD_ORDER_STATUS_LABEL, foodOrderSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

/** `"126900.00"` → `"126 900₮"`. */
function money(value: string): string {
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}

const STATUS_TONE: Record<string, "neutral" | "sky" | "mint" | "danger"> = {
  DRAFT: "neutral",
  ORDERED: "sky",
  RECEIVED: "mint",
  CANCELLED: "danger",
};

export default function FoodOrderDetailPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <FoodOrderDetail />
    </RequireRole>
  );
}

function FoodOrderDetail() {
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [receiving, setReceiving] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const order = useQuery({
    queryKey: qk.kitchen.foodOrder(params.id),
    queryFn: () => get(`/food-orders/${params.id}`, foodOrderSchema),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.kitchen.foodOrder(params.id) });
    void queryClient.invalidateQueries({ queryKey: ["kitchen", "food-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["kitchen", "stock"] });
  };

  const receive = useMutation({
    mutationFn: () =>
      mutate(`/food-orders/${params.id}/receive`, foodOrderSchema, {
        method: "POST",
        body: {
          lines: Object.entries(overrides)
            .filter(([, value]) => value.trim())
            .map(([lineId, receivedQuantity]) => ({ lineId, receivedQuantity })),
        },
      }),
    onSuccess: () => {
      toast.success("Захиалга хүлээн авагдаж, нөөцөд бүртгэгдлээ.");
      setReceiving(false);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const cancel = useMutation({
    mutationFn: () =>
      mutate(`/food-orders/${params.id}`, foodOrderSchema, {
        method: "PATCH",
        body: { status: "CANCELLED" },
      }),
    onSuccess: () => {
      toast.success("Захиалга цуцлагдлаа.");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (order.isLoading) return <LoadingState rows={4} />;
  if (order.isError) return <ErrorState description={errorMessage(order.error)} />;
  if (!order.data) return null;

  const data = order.data;
  const canReceive = data.status === "ORDERED" || data.status === "DRAFT";
  const canCancel = data.status !== "RECEIVED" && data.status !== "CANCELLED";

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title={data.supplier.name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[data.status]}>{FOOD_ORDER_STATUS_LABEL[data.status]}</Badge>
            {canReceive ? (
              <Button size="sm" onClick={() => setReceiving(true)}>
                <PackageCheck size={16} aria-hidden="true" />
                Хүлээн авах
              </Button>
            ) : null}
            {canCancel ? (
              <ConfirmDialog
                title="Захиалга цуцлах"
                description={`"${data.supplier.name}"-д өгсөн захиалгыг цуцлах уу?`}
                confirmLabel="Цуцлах"
                pendingLabel="Цуцалж байна…"
                tone="danger"
                pending={cancel.isPending}
                onConfirm={() => cancel.mutate()}
                trigger={
                  <Button variant="secondary" size="sm" disabled={cancel.isPending}>
                    <X size={16} aria-hidden="true" />
                    Цуцлах
                  </Button>
                }
              />
            ) : null}
          </div>
        }
      />

      {data.note ? <p className="text-body text-muted">{data.note}</p> : null}

      <section aria-labelledby="lines-heading">
        <SectionHeader id="lines-heading" title="Орцны жагсаалт" />
        <Card className="divide-y divide-border-soft">
          {data.lines.map((line) => (
            <div
              key={line.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-ink">{line.ingredient.name}</p>
                <p className="text-caption text-muted">
                  {line.quantity} × {money(line.unitPrice)}
                  {line.receivedQuantity ? ` · Хүлээн авсан: ${line.receivedQuantity}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-body font-semibold tabular-nums text-ink">
                {money(line.totalPrice)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-body font-semibold text-ink">Нийт дүн</span>
            <span className="text-lead font-semibold tabular-nums text-primary">
              {money(data.totalAmount)}
            </span>
          </div>
        </Card>
      </section>

      {receiving ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Захиалга хүлээн авах"
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
        >
          <div className="w-full max-w-[480px] rounded-card border border-border bg-surface p-5">
            <h2 className="text-title font-semibold text-ink">Захиалга хүлээн авах</h2>
            <p className="mt-1 text-body text-muted">
              Хэрэв бодит хэмжээ захиалснаас өөр бол доор засна уу. Хоосон орхивол захиалсан
              хэмжээгээр бүртгэнэ.
            </p>

            {receive.isError ? (
              <p className="mt-3 text-caption text-danger">{errorMessage(receive.error)}</p>
            ) : null}

            <div className="mt-4 flex flex-col gap-3">
              {data.lines.map((line) => (
                <label key={line.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-body text-ink">
                    {line.ingredient.name}{" "}
                    <span className="text-caption text-muted">({line.quantity})</span>
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={line.quantity}
                    value={overrides[line.id] ?? ""}
                    onChange={(e) =>
                      setOverrides((prev) => ({ ...prev, [line.id]: e.target.value }))
                    }
                    className="w-[110px] shrink-0"
                  />
                </label>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={receive.isPending}
                onClick={() => setReceiving(false)}
              >
                Болих
              </Button>
              <Button size="sm" disabled={receive.isPending} onClick={() => receive.mutate()}>
                {receive.isPending ? "Бүртгэж байна…" : "Хүлээн авах"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
