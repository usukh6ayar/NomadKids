"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Download, Send } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import {
  FilterBar,
  GroupField,
  moneyText,
  MonthField,
  PrintButton,
} from "@/components/finance/finance-ui";

/*
  ★ The two drafts and the submit result — agreed with the backend on
  2026-10-02 and not yet served (`docs/FINANCE_BACKEND_REQUEST.md` §2).

  The figures are the kindergarten's own, composed by the API from its
  invoices, payments and attendance — never typed in here. The tab shows the
  statement exactly as it will be filed and files it on one confirmed press.
*/
const form1DraftSchema = z.object({
  month: z.string(),
  orgName: z.string(),
  studentCnt: z.number(),
  livelihoodCnt: z.number(),
  livelihoodBudget: z.string(),
  livelihoodAmount: z.string(),
  lastSubmittedAt: z.string().nullable(),
});

const form2DraftSchema = z.object({
  month: z.string(),
  orgName: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  rows: z.array(
    z.object({
      childId: z.string(),
      lastName: z.string().nullable(),
      firstName: z.string(),
      comingDays: z.number(),
      arrivalDays: z.number(),
      amountDue: z.string(),
      amountPaid: z.string(),
      livelihoodDiscount: z.string(),
    }),
  ),
  lastSubmittedAt: z.string().nullable(),
});

const submitResultSchema = z.object({
  status: z.enum(["SUCCEEDED", "FAILED"]),
  errorCode: z.string().nullable(),
  message: z.string().nullable(),
  submittedAt: z.string(),
});

type Form = "form1" | "form2";
type Form1Draft = z.infer<typeof form1DraftSchema>;
type Form2Draft = z.infer<typeof form2DraftSchema>;

const FORM1_COLUMNS = [
  "Д/д",
  "Байгууллагын нэр",
  "Нийт хүүхдийн тоо",
  "Зорилтот бүлгийн хүүхдийн тоо",
  "Нийт төвлөрүүлэх орлогын дүн /мян.төг/",
  "Нийт төвлөрүүлсэн орлогын дүн /мян.төг/",
];

const FORM2_COLUMNS = [
  "Д/д",
  "Суралцагчийн нэр",
  "Ирэх ёстой өдөр",
  "Ирсэн өдөр",
  "Төлөх дүн",
  "Төлсөн дүн",
  "Хөнгөлөлт",
];

function stamp(value: string): string {
  return value.replace("T", " ").slice(0, 19);
}

function todayLine(): string {
  const now = new Date();
  return `${now.getFullYear()} оны ${now.getMonth() + 1} сарын ${String(now.getDate()).padStart(2, "0")} өдөр`;
}

function downloadCsv(name: string, header: string[], lines: (string | number)[][]) {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [header, ...lines].map((line) => line.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Маягт — the ministry's food-income statements, as a document.
 *
 * ★ 2026-10-02, the client's «Маягт» tab: a month and a form, the date it
 * was last filed, «ESIS илгээх», Excel and print — and the statement itself
 * laid out as the paper return is, title, table and signature lines, so the
 * printed page is the return.
 *
 * ★★ What ESIS already holds is one press away in the fold beneath — the
 * read panels this tab used to be.
 */
export function EsisForms({
  kindergartenId,
  month,
  onMonthChange,
}: {
  kindergartenId: string;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { session, primaryKindergartenId } = useSession();
  const kindergartenName =
    session?.kindergartens?.find((item) => item.id === primaryKindergartenId)?.name ?? "";
  const [form, setForm] = useState<Form>("form1");
  const [groupId, setGroupId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const base = `/kindergartens/${kindergartenId}/finance/esis-forms/${form}`;
  const params = new URLSearchParams({
    month,
    ...(form === "form2" && groupId ? { groupId } : {}),
  }).toString();
  const ready = form === "form1" || Boolean(groupId);

  const draft = useQuery({
    queryKey: ["esis-form-draft", kindergartenId, form, params],
    queryFn: () => get(`${base}/draft?${params}`, z.union([form1DraftSchema, form2DraftSchema])),
    enabled: ready,
    retry: false,
  });
  const form1 =
    form === "form1" && draft.data && "studentCnt" in draft.data
      ? (draft.data as Form1Draft)
      : undefined;
  const form2 =
    form === "form2" && draft.data && "rows" in draft.data ? (draft.data as Form2Draft) : undefined;
  const missing = draft.isError && isNotFound(draft.error);

  const submit = useMutation({
    mutationFn: () =>
      mutate(`${base}/submit`, submitResultSchema, {
        method: "POST",
        body: { month, ...(form === "form2" ? { groupId } : {}) },
      }),
    onSuccess: (result) => {
      setConfirming(false);
      if (result.status === "FAILED") {
        toast.error(result.message ?? "ЭСИС хүлээж авсангүй. Дахин оролдоно уу.");
        return;
      }
      toast.success(`${form === "form1" ? "Маягт-1" : "Маягт-2"} ЭСИС рүү илгээгдлээ.`);
      void queryClient.invalidateQueries({ queryKey: ["esis-form-draft", kindergartenId] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "esis"] });
    },
    onError: (error) => {
      setConfirming(false);
      toast.error(errorMessage(error));
    },
  });

  const monthNumber = Number(month.slice(5));
  const orgName = draft.data?.orgName ?? kindergartenName;
  const label = form === "form1" ? "Маягт - 1" : "Маягт - 2";

  const exportCsv = () => {
    if (form1) {
      downloadCsv(`maygt1-${month}.csv`, FORM1_COLUMNS, [
        [
          1,
          form1.orgName,
          form1.studentCnt,
          form1.livelihoodCnt,
          form1.livelihoodBudget,
          form1.livelihoodAmount,
        ],
      ]);
    } else if (form2) {
      downloadCsv(
        `maygt2-${month}-${form2.groupName}.csv`,
        FORM2_COLUMNS,
        form2.rows.map((row, index) => [
          index + 1,
          fullName(row),
          row.comingDays,
          row.arrivalDays,
          row.amountDue,
          row.amountPaid,
          row.livelihoodDiscount,
        ]),
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <MonthField value={month} onChange={onMonthChange} />
        <Field label="Маягт" labelHidden>
          {({ id }) => (
            <Select
              id={id}
              value={form}
              onChange={(event) => setForm(event.target.value as Form)}
              className="w-[150px]"
            >
              <option value="form1">Маягт-1</option>
              <option value="form2">Маягт-2</option>
            </Select>
          )}
        </Field>
        {form === "form2" ? (
          <GroupField value={groupId} onChange={setGroupId} allLabel="Бүлэг сонгоно уу" />
        ) : null}
        {draft.data?.lastSubmittedAt ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-mint-ink/40 px-3 py-1 text-caption font-medium text-mint-ink">
            <CalendarCheck size={14} aria-hidden="true" />
            Сүүлд илгээсэн: {stamp(draft.data.lastSubmittedAt)}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!draft.data || submit.isPending}
            onClick={() => setConfirming(true)}
          >
            <Send size={16} aria-hidden="true" />
            ESIS илгээх
          </Button>
          <Button size="sm" variant="secondary" disabled={!draft.data} onClick={exportCsv}>
            <Download size={16} aria-hidden="true" />
            Excel
          </Button>
          <PrintButton />
        </div>
      </FilterBar>

      {missing ? (
        <p className="rounded-card bg-sun/40 px-4 py-3 text-body text-ink">
          Маягтын дүнг цэцэрлэгийн бүртгэлээс бодох, ЭСИС рүү илгээх боломж сервер талд хийгдэж
          байна. Одоохондоо ЭСИС-ийн системээр илгээнэ үү.
        </p>
      ) : null}
      {draft.isError && !missing ? <ErrorState description={errorMessage(draft.error)} /> : null}

      {!ready ? (
        <EmptyState title="Бүлэг сонгоно уу" description="Маягт-2 бүлэг тус бүрээр илгээгдэнэ." />
      ) : draft.isLoading ? (
        <LoadingState rows={4} />
      ) : (
        <article
          aria-label={label}
          className="flex flex-col gap-5 rounded-card border border-border bg-surface p-5"
        >
          <header className="flex flex-col gap-3 text-center">
            <h2 className="text-lead font-semibold uppercase text-ink">
              {orgName} {monthNumber}-р сарын хоолны түүхий эдийн зардлын эцэг эх, асран
              хамгаалагчийн төвлөрүүлэх орлого
            </h2>
            <p className="font-semibold text-ink">
              ({label}){form2 ? ` — ${form2.groupName}` : ""}
            </p>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-center text-body">
              <caption className="sr-only">{label}</caption>
              <thead>
                <tr className="bg-sunken text-ink">
                  {(form === "form1" ? FORM1_COLUMNS : FORM2_COLUMNS).map((column) => (
                    <th
                      key={column}
                      className="border border-border-soft px-3 py-2.5 font-semibold"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {form === "form1" ? (
                  <tr>
                    <td className="border border-border-soft px-3 py-2.5">1</td>
                    <td className="border border-border-soft px-3 py-2.5">{orgName || "—"}</td>
                    <td className="border border-border-soft px-3 py-2.5 tabular-nums">
                      {form1?.studentCnt ?? "—"}
                    </td>
                    <td className="border border-border-soft px-3 py-2.5 tabular-nums">
                      {form1?.livelihoodCnt ?? "—"}
                    </td>
                    <td className="border border-border-soft px-3 py-2.5 tabular-nums">
                      {form1 ? moneyText(form1.livelihoodBudget) : "—"}
                    </td>
                    <td className="border border-border-soft px-3 py-2.5 tabular-nums">
                      {form1 ? moneyText(form1.livelihoodAmount) : "—"}
                    </td>
                  </tr>
                ) : form2 && form2.rows.length > 0 ? (
                  form2.rows.map((row, index) => (
                    <tr key={row.childId}>
                      <td className="border border-border-soft px-3 py-2">{index + 1}</td>
                      <td className="border border-border-soft px-3 py-2 text-left">
                        {fullName(row)}
                      </td>
                      <td className="border border-border-soft px-3 py-2 tabular-nums">
                        {row.comingDays}
                      </td>
                      <td className="border border-border-soft px-3 py-2 tabular-nums">
                        {row.arrivalDays}
                      </td>
                      <td className="border border-border-soft px-3 py-2 tabular-nums">
                        {moneyText(row.amountDue)}
                      </td>
                      <td className="border border-border-soft px-3 py-2 tabular-nums">
                        {moneyText(row.amountPaid)}
                      </td>
                      <td className="border border-border-soft px-3 py-2 tabular-nums">
                        {moneyText(row.livelihoodDiscount)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={FORM2_COLUMNS.length}
                      className="border border-border-soft px-3 py-4 text-muted"
                    >
                      {form2 ? "Энэ бүлэгт илгээх мөр алга." : "—"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mx-auto flex w-full max-w-[520px] flex-col gap-3 text-body text-ink">
            <p>Эрхлэгч ______________________________ /................/</p>
            <p>Төсвийн мэргэжилтэн ____________________ /................/</p>
          </div>
          <p className="text-center text-body text-muted">{todayLine()}</p>
        </article>
      )}

      <Disclosure title="ЭСИС-д бүртгэгдсэн маягт" hint="ЭСИС-ээс уншина">
        <div className="flex flex-col gap-5">
          <EsisDataPanel
            resource="livelihoodForm1"
            title="Хоолны төвлөрүүлэх орлого — маягт 1"
            description="Сарын нэгдсэн дүн: сурагчийн тоо, төвлөрүүлэх ба төвлөрүүлсэн орлого"
          />
          <EsisDataPanel
            resource="livelihoodForm2"
            title="Хоолны төвлөрүүлэх орлого — маягт 2"
            description="Бүлгийн хүүхэд тус бүрийн ирц, төлөх ба төлсөн дүн"
          />
        </div>
      </Disclosure>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`${label}-ийг ЭСИС рүү илгээх үү?`}
        description="ЭСИС-д туршилтын орчин байхгүй тул илгээсэн дүн яамны бүртгэлд шууд орно. Дүнг шалгасны дараа илгээнэ үү."
        confirmLabel="Илгээх"
        pendingLabel="Илгээж байна…"
        pending={submit.isPending}
        onConfirm={() => submit.mutate()}
      />
    </div>
  );
}
