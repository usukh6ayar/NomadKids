"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";

/**
 * The families' portal access fee in one kindergarten — counts only,
 * 2026-10-20, the user: "хэдэн хүүхдийн төлбөр орсон". No names: the operator
 * does not read children (`authz/platform-access.service.ts`); a single
 * payment is looked up on «Төлбөр шалгах».
 *
 * ★ Built ahead of `GET /platform/kindergartens/:id/access-fees` (asked of
 * the admin). Counted over the current school year's ACTIVE enrolments, so a
 * child who graduated or was deleted is neither paid nor unpaid.
 */
const accessFeesSchema = z.object({
  /** `false` when `ACCESS_FEE_AMOUNT` is 0 — the gate is off. */
  required: z.boolean(),
  schoolYear: z.string().nullish(),
  paid: z.number().int(),
  unpaid: z.number().int(),
  /** What the paid fees took, ₮. */
  amount: z.number(),
  groups: z
    .array(z.object({ id: z.string(), name: z.string(), paid: z.number(), children: z.number() }))
    .default([]),
});

export function KindergartenAccessFees({ kindergartenId }: { kindergartenId: string }) {
  const fees = useQuery({
    queryKey: ["platform", "kindergartens", kindergartenId, "access-fees"],
    queryFn: () => get(`/platform/kindergartens/${kindergartenId}/access-fees`, accessFeesSchema),
    retry: false,
  });

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <SectionHeader
        title="Эцэг эхийн хандалтын төлбөр"
        lede={fees.data?.schoolYear ? `${fees.data.schoolYear} хичээлийн жил` : undefined}
      />
      {fees.isLoading ? <LoadingState rows={2} /> : null}
      {fees.isError && isNotFound(fees.error) ? (
        <p className="text-caption text-muted">
          Удахгүй нэмэгдэнэ — сервер талд бэлэн болмогц төлсөн, төлөөгүй хүүхдийн тоо энд гарна.
        </p>
      ) : null}
      {fees.isError && !isNotFound(fees.error) ? (
        <ErrorState description={errorMessage(fees.error)} />
      ) : null}
      {fees.data && !fees.data.required ? (
        <p className="text-body text-muted">Хандалтын төлбөр унтраалттай байна.</p>
      ) : null}
      {fees.data?.required ? (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <Figure label="Төлсөн" value={String(fees.data.paid)} tone="text-mint-ink" />
            <Figure label="Төлөөгүй" value={String(fees.data.unpaid)} tone="text-sun-ink" />
            <Figure label="Нийт" value={`${fees.data.amount.toLocaleString("en-US")}₮`} />
          </dl>
          {fees.data.groups.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {fees.data.groups.map((group) => {
                const share = group.children > 0 ? (group.paid / group.children) * 100 : 0;
                return (
                  <li key={group.id} className="flex items-center gap-3 text-caption">
                    <span className="w-32 shrink-0 truncate text-ink">{group.name}</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-border-soft">
                      <span
                        className="block h-full rounded-pill bg-primary"
                        style={{ width: `${Math.round(share)}%` }}
                      />
                    </span>
                    <span className="w-12 shrink-0 text-right tabular-nums text-muted">
                      {group.paid}/{group.children}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-control bg-canvas px-3 py-2">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className={`text-lead font-bold tabular-nums ${tone ?? "text-ink"}`}>{value}</dd>
    </div>
  );
}
