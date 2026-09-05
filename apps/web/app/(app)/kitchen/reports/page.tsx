"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import {
  consumptionReportRowSchema,
  nutritionReportRowSchema,
  purchaseReportRowSchema,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";

const consumptionSchema = z.array(consumptionReportRowSchema);
const nutritionSchema = z.array(nutritionReportRowSchema);
const purchasesSchema = z.array(purchaseReportRowSchema);

function money(value: string): string {
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}

function thisMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

const TABS = [
  { value: "consumption", label: "Хэрэглээ" },
  { value: "nutrition", label: "Шим тэжээл" },
  { value: "purchases", label: "Худалдан авалт" },
] as const;

/** Хоол үйлдвэрлэлийн тайлан — consumption, nutrition and purchase reports
 * over a date range, per §16's kitchen slice. */
export default function KitchenReportsPage() {
  return (
    <RequireRole roles={["COOK", "ADMIN"]}>
      <KitchenReports />
    </RequireRole>
  );
}

function KitchenReports() {
  const { session } = useSession();
  const kindergartenId = session?.memberships?.[0]?.kindergartenId ?? null;
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("consumption");
  const [range, setRange] = useState(thisMonthRange);

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Гал тогооны тайлан"
        lede="Орцны зарцуулалт, шим тэжээлийн дундаж, худалдан авалт."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Эхлэх">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  className="w-[160px]"
                />
              )}
            </Field>
            <Field label="Дуустал">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  className="w-[160px]"
                />
              )}
            </Field>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`min-h-[44px] rounded-pill border px-3.5 text-body font-medium transition-colors ${
              tab === t.value
                ? "border-primary bg-primary-soft text-primary"
                : "border-border bg-surface text-muted hover:bg-canvas"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {kindergartenId && tab === "consumption" ? (
        <ConsumptionReport kindergartenId={kindergartenId} range={range} />
      ) : null}
      {kindergartenId && tab === "nutrition" ? (
        <NutritionReport kindergartenId={kindergartenId} range={range} />
      ) : null}
      {kindergartenId && tab === "purchases" ? (
        <PurchaseReport kindergartenId={kindergartenId} range={range} />
      ) : null}
    </div>
  );
}

function ConsumptionReport({
  kindergartenId,
  range,
}: {
  kindergartenId: string;
  range: { from: string; to: string };
}) {
  const report = useQuery({
    queryKey: qk.kitchen.reportConsumption(kindergartenId, range.from, range.to),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/kitchen/reports/consumption?from=${range.from}&to=${range.to}`,
        consumptionSchema,
      ),
  });

  return (
    <section aria-labelledby="consumption-heading">
      <SectionHeader
        id="consumption-heading"
        title="Орцны зарцуулалт"
        lede="Сонгосон хугацаанд зарцуулсан орц."
      />
      {report.isLoading ? <LoadingState rows={4} /> : null}
      {report.isError ? <ErrorState description={errorMessage(report.error)} /> : null}
      {report.data && report.data.length === 0 ? (
        <EmptyState title="Зарцуулалт бүртгэгдээгүй байна" />
      ) : null}
      {report.data && report.data.length > 0 ? (
        <Card className="divide-y divide-border-soft">
          {report.data.map((row) => (
            <div
              key={row.ingredient.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="truncate text-body text-ink">{row.ingredient.name}</span>
              <span className="shrink-0 text-body font-semibold tabular-nums text-ink">
                {row.quantity}
              </span>
            </div>
          ))}
        </Card>
      ) : null}
    </section>
  );
}

function NutritionReport({
  kindergartenId,
  range,
}: {
  kindergartenId: string;
  range: { from: string; to: string };
}) {
  const report = useQuery({
    queryKey: qk.kitchen.reportNutrition(kindergartenId, range.from, range.to),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/kitchen/reports/nutrition?from=${range.from}&to=${range.to}`,
        nutritionSchema,
      ),
  });

  return (
    <section aria-labelledby="nutrition-heading">
      <SectionHeader
        id="nutrition-heading"
        title="Шим тэжээлийн дундаж"
        lede="Технологийн картаар холбогдсон, төлөвлөсөн порцоор бодов."
      />
      {report.isLoading ? <LoadingState rows={4} /> : null}
      {report.isError ? <ErrorState description={errorMessage(report.error)} /> : null}
      {report.data && report.data.length === 0 ? (
        <EmptyState title="Технологийн картаар холбогдсон цэс алга" />
      ) : null}
      {report.data && report.data.length > 0 ? (
        <Card className="divide-y divide-border-soft">
          {report.data.map((row) => (
            <div
              key={row.date}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="text-body font-medium text-ink">{formatDate(row.date)}</p>
                <p className="text-caption text-muted">{row.totalPortions} порц</p>
              </div>
              <div className="flex shrink-0 gap-4 tabular-nums text-body text-ink">
                <span>{row.perPortion.calories ?? "—"} ккал</span>
                <span className="text-muted">{row.perPortion.protein ?? "—"} г уураг</span>
                <span className="text-muted">{row.perPortion.fat ?? "—"} г өөх</span>
                <span className="text-muted">{row.perPortion.carbs ?? "—"} г нүүрс ус</span>
              </div>
            </div>
          ))}
        </Card>
      ) : null}
    </section>
  );
}

function PurchaseReport({
  kindergartenId,
  range,
}: {
  kindergartenId: string;
  range: { from: string; to: string };
}) {
  const report = useQuery({
    queryKey: qk.kitchen.reportPurchases(kindergartenId, range.from, range.to),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/kitchen/reports/purchases?from=${range.from}&to=${range.to}`,
        purchasesSchema,
      ),
  });

  return (
    <section aria-labelledby="purchases-heading">
      <SectionHeader
        id="purchases-heading"
        title="Худалдан авалт"
        lede="Хүлээн авсан захиалга, нийлүүлэгчээр."
      />
      {report.isLoading ? <LoadingState rows={3} /> : null}
      {report.isError ? <ErrorState description={errorMessage(report.error)} /> : null}
      {report.data && report.data.length === 0 ? (
        <EmptyState title="Худалдан авалт бүртгэгдээгүй байна" />
      ) : null}
      {report.data && report.data.length > 0 ? (
        <Card className="divide-y divide-border-soft">
          {report.data.map((row) => (
            <div
              key={row.supplier.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="text-body font-medium text-ink">{row.supplier.name}</p>
                <p className="text-caption text-muted">{row.orderCount} захиалга</p>
              </div>
              <span className="shrink-0 text-body font-semibold tabular-nums text-ink">
                {money(row.totalAmount)}
              </span>
            </div>
          ))}
        </Card>
      ) : null}
    </section>
  );
}
