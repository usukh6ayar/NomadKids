"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, CheckCheck, ChevronLeft, ChevronRight, X } from "lucide-react";
import { z } from "zod";
import { attendanceRequestSchema, paginated, personRefSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import {
  attendanceCompanionDisplay as companionDisplay,
  ATTENDANCE_STATUS_BG as STATUS_BG,
  ATTENDANCE_STATUS_LABEL as STATUS_LABEL,
  ATTENDANCE_STATUS_LETTER as STATUS_LETTER,
} from "@/lib/attendance-meta";
import { formatDayMonth, fullName, todayLocal } from "@/lib/format";
import { cn } from "@/lib/utils";

const queueItemSchema = attendanceRequestSchema.extend({ child: personRefSchema.nullish() });
const queueSchema = paginated(queueItemSchema);
/** Every waiting notice, so a week's table is never missing one past the first page. */
const QUEUE_URL = "/attendance-requests/review-queue?page=1&pageSize=100";

/** `HH:MM`, in the viewer's own timezone — same reasoning as
 * `child-attendance.tsx`'s own `toLocalTime`, not exported from there since
 * that file is `"use client"` component code, not a shared utility module. */
function toLocalTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * How many notices are waiting, for a caller that only wants the number.
 *
 * ★ The same query key as the queue below, so the two share one request.
 * React Query dedupes by key, which is why this is a hook rather than a prop
 * threaded down from a parent that would have to fetch it first.
 */
export function useAttendanceRequestCount(): number {
  const { data } = useQuery({
    queryKey: qk.attendanceReviewQueue(),
    queryFn: () => get(QUEUE_URL, queueSchema),
  });
  return data?.total ?? 0;
}

/**
 * Guardians' advance notices, waiting to be decided.
 *
 * ★ It lives on the attendance register now, not on a menu row of its own.
 *
 * A leave request *is* attendance: approving one writes the `Attendance` rows
 * for those days. Reaching it through a separate sidebar entry asked a teacher
 * to know that the thing they were about to mark by hand had already been
 * asked for on another screen — so the register and the requests disagreed
 * about the same morning until somebody thought to check both.
 *
 * Below the day sheet rather than above it: the sheet is what the screen is
 * for, and a queue that is usually empty must not push it down the page. The
 * heading carries the count, so an empty queue is one quiet line.
 *
 * ★ A week's table, not a stack of cards — 2026-10-07, the client: "7
 * хоногоор цэвэрхэн ойлгомжтой", decided "ирц бүртгэдэг шиг хялбар". See
 * `RequestRow`.
 *
 * ★★ `/attendance-requests/review` still renders this, unchanged.
 *
 * The route is what a notification links to and what a bookmark points at.
 * Deleting it to make a menu shorter would break both.
 */
export function AttendanceRequestQueue({ heading }: { heading?: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.attendanceReviewQueue(),
    queryFn: () => get(QUEUE_URL, queueSchema),
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const pending = data?.total ?? 0;

  /*
    ★ Opens on the week that has something to decide: this one when it does,
    otherwise the earliest week a notice falls in. A teacher should never
    land on an empty week while a notice waits in the next one.
  */
  const thisWeek = mondayOf(todayLocal());
  const [chosenWeek, setChosenWeek] = useState<string | null>(null);
  const firstWeek = useMemo(() => {
    if (items.some((request) => overlapsWeek(request, thisWeek))) return thisWeek;
    const earliest = items.map((request) => mondayOf(request.dateFrom.slice(0, 10))).sort()[0];
    return earliest ?? thisWeek;
  }, [items, thisWeek]);
  const week = chosenWeek ?? firstWeek;
  const days = weekDays(week);

  const shown = items
    .filter((request) => overlapsWeek(request, week))
    .sort(
      (a, b) =>
        a.dateFrom.localeCompare(b.dateFrom) ||
        (a.child ? fullName(a.child) : "").localeCompare(b.child ? fullName(b.child) : "", "mn"),
    );
  const elsewhere = items.length - shown.length;

  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: Decision }) =>
      mutate(`/attendance-requests/${id}/review`, attendanceRequestSchema, {
        method: "POST",
        body: { decision },
      }),
    onSuccess: (_data, { decision }) => {
      toast.success(decision === "APPROVED" ? "Хүсэлт зөвшөөрөгдлөө." : "Хүсэлт татгалзагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.attendanceReviewQueue() });
      void queryClient.invalidateQueries({ queryKey: ["child"] });
    },
    onError: (failure) => toast.error(errorMessage(failure)),
  });

  /*
    ★ «Бүгдийг зөвшөөрөх» — the register's own "everyone present" for the
    week on screen. One request after another, so a refusal stops the run at
    the notice it refused and says why, rather than half-succeeding silently.
  */
  const approveAll = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await mutate(`/attendance-requests/${id}/review`, attendanceRequestSchema, {
          method: "POST",
          body: { decision: "APPROVED" },
        });
      }
      return ids.length;
    },
    onSuccess: (count) => toast.success(`${count} хүсэлт зөвшөөрөгдлөө.`),
    onError: (failure) => toast.error(errorMessage(failure)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.attendanceReviewQueue() });
      void queryClient.invalidateQueries({ queryKey: ["child"] });
    },
  });

  const busy = review.isPending || approveAll.isPending;

  return (
    <section aria-label="Эцэг эхийн ирцийн мэдэгдэл" className="flex flex-col gap-3">
      {heading ? (
        <SectionHeader
          title={heading}
          as="h2"
          action={
            data ? (
              <span className="text-body text-muted" aria-live="polite">
                {pending} хүлээгдэж буй
              </span>
            ) : null
          }
        />
      ) : null}

      {isLoading ? <LoadingState rows={2} /> : null}

      {isError ? (
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {data && items.length === 0 ? (
        /*
          ★ One line, not the product's centred mascot.

          This queue is empty most days and sits under a register somebody is
          working through. A 96px illustration for "nothing to do" would be the
          tallest thing on the screen on the days it is doing the least.
        */
        heading ? (
          <p className="rounded-row border border-border-soft bg-canvas px-4 py-3 text-body text-muted">
            Хянах хүсэлт алга.
          </p>
        ) : (
          <EmptyState
            title="Хянах зүйл алга"
            description="Эцэг эхээс ирц мэдэгдэл, чөлөөний хүсэлт ирвэл энд харагдана."
          />
        )
      ) : null}

      {data && items.length > 0 ? (
        <Card pad="none" className="overflow-hidden">
          {/* The week, and the way to the one either side. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft px-3 py-2.5">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Өмнөх 7 хоног"
                onClick={() => setChosenWeek(shiftDays(week, -7))}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span className="min-w-[7.5rem] text-center text-body font-semibold tabular-nums text-ink">
                {formatDayMonth(days[0]!)} – {formatDayMonth(days[6]!)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Дараах 7 хоног"
                onClick={() => setChosenWeek(shiftDays(week, 7))}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            {shown.length > 1 ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => approveAll.mutate(shown.map((request) => request.id))}
              >
                <CheckCheck size={16} aria-hidden="true" />
                {approveAll.isPending ? "Хадгалж байна…" : "Бүгдийг зөвшөөрөх"}
              </Button>
            ) : null}
          </div>

          {shown.length === 0 ? (
            <p className="px-4 py-5 text-center text-body text-muted">Энэ 7 хоногт хүсэлт алга.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body">
                <caption className="sr-only">Чөлөөний хүсэлт, 7 хоногоор</caption>
                <thead className="bg-sunken">
                  <tr>
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-caption font-semibold text-muted"
                    >
                      Хүүхэд
                    </th>
                    {days.map((day, index) => (
                      <th
                        key={day}
                        scope="col"
                        className={cn(
                          "w-8 px-0.5 py-2 text-center text-caption font-semibold sm:w-11",
                          day === todayLocal() ? "text-primary" : "text-muted",
                        )}
                      >
                        <span className="block">{WEEKDAY_SHORT[index]}</span>
                        <span className="block tabular-nums">{Number(day.slice(8))}</span>
                      </th>
                    ))}
                    <th
                      scope="col"
                      className="px-2 py-2 text-right text-caption font-semibold text-muted"
                    >
                      Шийдвэр
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((request) => (
                    <RequestRow
                      key={request.id}
                      request={request}
                      days={days}
                      busy={busy}
                      onDecide={(decision) => review.mutate({ id: request.id, decision })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {elsewhere > 0 ? (
            <p className="border-t border-border-soft px-4 py-2 text-caption text-muted">
              Бусад 7 хоногт {elsewhere} хүсэлт хүлээгдэж байна.
            </p>
          ) : null}
        </Card>
      ) : null}
    </section>
  );
}

type Decision = "APPROVED" | "REJECTED";
type QueueItem = z.infer<typeof queueItemSchema>;

/**
 * One notice, one row: the child, the days it covers marked the way the
 * register marks them, and two presses to decide it.
 *
 * ★ The register's grammar on purpose — client, 2026-10-07: deciding a
 * notice should be as easy as marking attendance. The same letters (И, Ө, Ч,
 * Т) in the same colours, and ✓ / ✗ as two 44px targets at the row's end.
 */
function RequestRow({
  request,
  days,
  busy,
  onDecide,
}: {
  request: QueueItem;
  days: string[];
  busy: boolean;
  onDecide: (decision: Decision) => void;
}) {
  const from = request.dateFrom.slice(0, 10);
  const to = request.dateTo.slice(0, 10);
  const pickup = Boolean(request.pickedUpWith && !request.arrivedWith);
  const status = pickup ? "Явсан" : (STATUS_LABEL[request.requestedStatus] ?? "");
  const name = request.child ? fullName(request.child) : "—";
  const detail = [
    request.arrivedWith
      ? `${companionDisplay(request.arrivedWith, request.arrivedWithName)}${
          request.arrivedAt ? `, ${toLocalTime(request.arrivedAt)}` : ""
        }`
      : null,
    request.pickedUpWith
      ? `${companionDisplay(request.pickedUpWith, request.pickedUpWithName)}${
          request.pickedUpAt ? `, ${toLocalTime(request.pickedUpAt)}` : ""
        }`
      : null,
    request.reason,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr className="border-t border-border-soft align-middle">
      <td className="max-w-[9rem] px-3 py-2 sm:max-w-none">
        {request.child ? (
          <Link
            href={`/children/${request.child.id}/attendance`}
            className="block truncate font-semibold text-ink underline-offset-4 hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="font-semibold text-ink">—</span>
        )}
        <span className="block truncate text-caption text-muted" title={detail || undefined}>
          {status}
          {detail ? ` · ${detail}` : ""}
        </span>
      </td>
      {days.map((day) => {
        const covered = day >= from && day <= to;
        return (
          <td key={day} className="px-0.5 py-2 text-center">
            {covered ? (
              <span
                aria-label={`${formatDayMonth(day)} ${status}`}
                className={cn(
                  "mx-auto grid size-7 place-items-center rounded-control text-caption font-bold sm:size-8",
                  pickup ? "bg-sky text-ink" : (STATUS_BG[request.requestedStatus] ?? "bg-canvas"),
                  !pickup && request.requestedStatus === "ABSENT" ? "text-white" : "text-ink",
                )}
              >
                {pickup ? "Я" : (STATUS_LETTER[request.requestedStatus] ?? "•")}
              </span>
            ) : (
              <span aria-hidden="true" className="text-faint">
                ·
              </span>
            )}
          </td>
        );
      })}
      <td className="px-2 py-2">
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            disabled={busy}
            aria-label={`${name} — зөвшөөрөх`}
            title="Зөвшөөрөх"
            onClick={() => onDecide("APPROVED")}
          >
            <Check size={18} aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            disabled={busy}
            aria-label={`${name} — татгалзах`}
            title="Татгалзах"
            onClick={() => onDecide("REJECTED")}
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

const WEEKDAY_SHORT = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"] as const;

/** `YYYY-MM-DD` arithmetic in UTC, so a timezone never moves a day. */
function shiftDays(date: string, by: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + by)).toISOString().slice(0, 10);
}

/** The Monday of the week `date` falls in. */
function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  return shiftDays(date, -((weekday + 6) % 7));
}

function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftDays(monday, index));
}

function overlapsWeek(request: QueueItem, monday: string): boolean {
  const sunday = shiftDays(monday, 6);
  return request.dateFrom.slice(0, 10) <= sunday && request.dateTo.slice(0, 10) >= monday;
}
