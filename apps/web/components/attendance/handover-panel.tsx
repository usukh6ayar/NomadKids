"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ATTENDANCE_STATUS_LABEL, attendanceStatusSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { todayLocal } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { YearMonthSelect } from "@/components/ui/year-month-select";

/**
 * «Гараас гарт» — who brought each child and when, who took them home and
 * when. Client, 2026-10-06: beside «Чөлөөний хүсэлт»; the class as a numbered
 * table; the time and the companion in each cell; the teacher fills in what a
 * parent did not, as easily as the register; a week at a time; a month to
 * Excel.
 *
 * ★ No new data. `Attendance` has carried `arrivedWith`/`arrivedAt` and
 * `pickedUpWith`/`pickedUpAt` all along, and the group's range read returns
 * the whole row — the contract schema simply dropped the four fields, so this
 * screen parses its own wider shape. Drop-off is written through the child's
 * `PUT …/attendance/:date` (with the day's status and note sent back
 * unchanged — that call replaces both), pick-up through `PATCH …/pickup`.
 */

export const COMPANION = { MOTHER: "Ээж", FATHER: "Аав", OTHER: "Бусад" } as const;
type Companion = keyof typeof COMPANION;
const companionSchema = z.enum(["MOTHER", "FATHER", "OTHER"]);

const recordSchema = z.object({
  id: z.string(),
  status: attendanceStatusSchema,
  note: z.string().nullish(),
  arrivedWith: companionSchema.nullish(),
  arrivedWithName: z.string().nullish(),
  arrivedAt: z.string().nullish(),
  pickedUpWith: companionSchema.nullish(),
  pickedUpWithName: z.string().nullish(),
  pickedUpAt: z.string().nullish(),
});
type DayRecord = z.infer<typeof recordSchema>;

const rangeSchema = z.object({
  days: z.array(z.string()),
  rows: z.array(
    z.object({
      child: z.object({ id: z.string(), lastName: z.string().nullish(), firstName: z.string() }),
      records: z.record(z.string(), recordSchema),
    }),
  ),
});
type HandoverRange = z.infer<typeof rangeSchema>;

/** Statuses a child can have been handed over on. Anything else is an absence. */
const PRESENT_LIKE = new Set(["PRESENT", "HALF_DAY"]);

const WEEKDAY = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"];

export function addDays(day: string, n: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + n);
  return localIso(date);
}

function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function who(companion: Companion | null | undefined, name: string | null | undefined) {
  if (!companion) return "";
  return companion === "OTHER" ? name?.trim() || COMPANION.OTHER : COMPANION[companion];
}

const childName = (child: { lastName?: string | null; firstName: string }) =>
  `${child.lastName ?? ""} ${child.firstName}`.trim();

function rangeQuery(groupId: string, from: string, to: string) {
  return {
    queryKey: ["group", groupId, "attendance", "handover", from, to] as const,
    queryFn: () => get(`/groups/${groupId}/attendance/range?from=${from}&to=${to}`, rangeSchema),
  };
}

type Editing = {
  side: "in" | "out";
  childId: string;
  name: string;
  day: string;
  record: DayRecord | undefined;
};

export function HandoverPanel({ groupId, groupName }: { groupId: string; groupName?: string }) {
  const today = todayLocal();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [day, setDay] = useState(today);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const queryClient = useQueryClient();
  const toast = useToast();

  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const range = useQuery(rangeQuery(groupId, weekStart, weekEnd));

  const moveWeek = (n: number) => {
    const next = addDays(weekStart, 7 * n);
    setWeekStart(next);
    setDay(next <= today && today <= addDays(next, 6) ? today : next);
  };

  const exportMonth = async () => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const from = `${month}-01`;
    const last = new Date(y, m, 0).getDate();
    const to = `${month}-${String(last).padStart(2, "0")}`;
    try {
      const data = await queryClient.fetchQuery(rangeQuery(groupId, from, to));
      downloadCsv(data, `Гараас-гарт-${groupName ?? "бүлэг"}-${month}.csv`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const rows = range.data?.rows ?? [];

  return (
    <section aria-labelledby="handover-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="handover-heading" className="text-body font-semibold text-ink">
          Гараас гарт
        </h2>
        <div className="flex items-center gap-1.5">
          <YearMonthSelect value={month} onValueChange={setMonth} max={today.slice(0, 7)} />
          <Button size="sm" variant="secondary" onClick={() => void exportMonth()}>
            <Download size={16} aria-hidden="true" />
            Excel
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Өмнөх 7 хоног" onClick={() => moveWeek(-1)}>
          <ChevronLeft size={18} aria-hidden="true" />
        </Button>
        <div role="tablist" aria-label="Өдөр" className="grid flex-1 grid-cols-7 gap-1">
          {days.map((d) => {
            const active = d === day;
            const future = d > today;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={future}
                onClick={() => setDay(d)}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center rounded-control text-caption tabular-nums transition-colors disabled:opacity-40",
                  active
                    ? "bg-primary text-primary-ink"
                    : "text-muted hover:bg-canvas hover:text-ink",
                )}
              >
                <span>{WEEKDAY[new Date(`${d}T12:00:00`).getDay()]}</span>
                <span className="font-semibold">{Number(d.slice(8))}</span>
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Дараах 7 хоног"
          disabled={addDays(weekStart, 7) > today}
          onClick={() => moveWeek(1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </Button>
      </div>

      {range.isLoading ? <LoadingState rows={4} /> : null}
      {range.isError ? <ErrorState description={errorMessage(range.error)} /> : null}
      {range.data && rows.length === 0 ? <EmptyState title="Бүлэгт хүүхэд алга" /> : null}

      {rows.length > 0 ? (
        <TableShell caption="Гараас гарт" minWidth="min-w-0">
          <thead>
            <tr>
              <Th className="w-8 px-2 py-2 text-caption">№</Th>
              <Th className="px-2 py-2 text-caption">Хүүхэд</Th>
              <Th className="px-2 py-2 text-caption">Ирсэн</Th>
              <Th className="px-2 py-2 text-caption">Явсан</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const record = row.records[day];
              const name = childName(row.child);
              const absent = record && !PRESENT_LIKE.has(record.status);
              const open = (side: "in" | "out") =>
                setEditing({ side, childId: row.child.id, name, day, record });
              return (
                <tr key={row.child.id}>
                  <Td className="px-2 py-1.5 text-caption tabular-nums text-muted">{index + 1}</Td>
                  <Td className="px-2 py-1.5 text-caption text-ink">{name}</Td>
                  {absent ? (
                    <Td colSpan={2} className="px-2 py-1.5 text-caption text-muted">
                      {ATTENDANCE_STATUS_LABEL[record.status] ?? record.status}
                    </Td>
                  ) : (
                    <>
                      <Td className="px-1 py-1">
                        <Cell
                          label={`${name} — ирсэн`}
                          time={hhmm(record?.arrivedAt)}
                          companion={who(record?.arrivedWith, record?.arrivedWithName)}
                          onClick={() => open("in")}
                        />
                      </Td>
                      <Td className="px-1 py-1">
                        <Cell
                          label={`${name} — явсан`}
                          time={hhmm(record?.pickedUpAt)}
                          companion={who(record?.pickedUpWith, record?.pickedUpWithName)}
                          disabled={!record}
                          onClick={() => open("out")}
                        />
                      </Td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      ) : null}

      {editing ? (
        <HandoverDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ["group", groupId, "attendance"] });
          }}
        />
      ) : null}
    </section>
  );
}

/** One cell: the time and the companion once recorded, a quiet «+» before. */
function Cell({
  label,
  time,
  companion,
  disabled = false,
  onClick,
}: {
  label: string;
  time: string;
  companion: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-10 w-full flex-col items-start justify-center rounded-control px-1.5 text-left text-caption transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
    >
      {time ? (
        <>
          <span className="font-semibold tabular-nums text-ink">{time}</span>
          <span className="text-muted">{companion}</span>
        </>
      ) : (
        <span className="text-faint">+ Тэмдэглэх</span>
      )}
    </button>
  );
}

function HandoverDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { side, record, day, childId, name } = editing;
  const isIn = side === "in";
  const savedWith = isIn ? record?.arrivedWith : record?.pickedUpWith;
  const savedName = isIn ? record?.arrivedWithName : record?.pickedUpWithName;
  const savedAt = isIn ? record?.arrivedAt : record?.pickedUpAt;

  const now = new Date();
  const [companion, setCompanion] = useState<Companion | null>(savedWith ?? null);
  const [other, setOther] = useState(savedName ?? "");
  const [time, setTime] = useState(
    hhmm(savedAt) ||
      (day === todayLocal()
        ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
        : isIn
          ? "08:00"
          : "18:00"),
  );

  const save = useMutation({
    mutationFn: () => {
      const at = new Date(`${day}T${time}:00`).toISOString();
      const otherName = companion === "OTHER" ? other.trim() || null : null;
      return isIn
        ? mutate(`/children/${childId}/attendance/${day}`, z.unknown(), {
            method: "PUT",
            body: {
              // The call replaces status and note; send the day's own back.
              status: record?.status ?? "PRESENT",
              note: record?.note ?? null,
              arrivedWith: companion,
              arrivedWithName: otherName,
              arrivedAt: at,
            },
          })
        : mutate(`/children/${childId}/attendance/${day}/pickup`, z.unknown(), {
            method: "PATCH",
            body: { pickedUpWith: companion, pickedUpWithName: otherName, pickedUpAt: at },
          });
    },
    onSuccess: () => {
      toast.success(isIn ? "Ирснийг тэмдэглэлээ." : "Явсныг тэмдэглэлээ.");
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const ready = companion !== null && time !== "" && (companion !== "OTHER" || other.trim() !== "");

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={save.isPending}
      title={`${name} — ${isIn ? "ирсэн" : "явсан"}`}
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Болих
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!ready || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div
          role="radiogroup"
          aria-label={isIn ? "Хэнтэй ирсэн" : "Хэн авсан"}
          className="flex gap-2"
        >
          {(Object.keys(COMPANION) as Companion[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={companion === key}
              onClick={() => setCompanion(key)}
              className={cn(
                "min-h-11 flex-1 rounded-control border text-body font-medium transition-colors",
                companion === key
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-ink hover:bg-canvas",
              )}
            >
              {COMPANION[key]}
            </button>
          ))}
        </div>
        {companion === "OTHER" ? (
          <Field label="Хэн" required>
            {({ id }) => (
              <Input id={id} value={other} onChange={(e) => setOther(e.target.value)} autoFocus />
            )}
          </Field>
        ) : null}
        <Field label="Цаг">
          {({ id }) => (
            <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

/**
 * The month as one row per child per day — `Огноо, №, Хүүхэд, Ирсэн цаг,
 * Хэнтэй ирсэн, Явсан цаг, Хэн авсан` — as a CSV with a BOM, which Excel opens
 * with Cyrillic intact. Built from the same range read the screen draws.
 */
function downloadCsv(data: HandoverRange, filename: string) {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [
    ["Огноо", "№", "Хүүхэд", "Төлөв", "Ирсэн цаг", "Хэнтэй ирсэн", "Явсан цаг", "Хэн авсан"]
      .map(cell)
      .join(","),
  ];
  for (const d of data.days) {
    data.rows.forEach((row, index) => {
      const r = row.records[d];
      lines.push(
        [
          d,
          String(index + 1),
          childName(row.child),
          r ? (ATTENDANCE_STATUS_LABEL[r.status] ?? r.status) : "",
          hhmm(r?.arrivedAt),
          who(r?.arrivedWith, r?.arrivedWithName),
          hhmm(r?.pickedUpAt),
          who(r?.pickedUpWith, r?.pickedUpWithName),
        ]
          .map(cell)
          .join(","),
      );
    });
  }
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
