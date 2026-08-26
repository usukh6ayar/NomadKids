"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useEffect, useState } from "react";
import { z } from "zod";
import { attendanceRecordSchema, attendanceRequestSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const recordsSchema = z.array(attendanceRecordSchema);
const requestsSchema = z.array(attendanceRequestSchema);

const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Ирсэн",
  HALF_DAY: "Хагас өдөр",
  EXCUSED: "Чөлөөтэй",
  SICK: "Өвчтэй",
  ABSENT: "Тасалсан",
};

const STATUS_TONE: Record<string, "mint" | "sky" | "peach" | "danger"> = {
  PRESENT: "mint",
  HALF_DAY: "sky",
  EXCUSED: "sky",
  SICK: "peach",
  ABSENT: "danger",
};

const REVIEW_LABEL: Record<string, string> = {
  PENDING: "Хүлээгдэж буй",
  APPROVED: "Зөвшөөрсөн",
  REJECTED: "Татгалзсан",
};

const REVIEW_TONE: Record<string, "sun" | "mint" | "danger"> = {
  PENDING: "sun",
  APPROVED: "mint",
  REJECTED: "danger",
};

/** `YYYY-MM` for the current month, in the viewer's own timezone. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The "Ирц" tab.
 *
 * ★ Staff record; guardians request. A parent never writes an `Attendance` row
 * directly — RFP appendix gives attendance-taking to the kindergarten, so the
 * "Ирц" a family submits is an `AttendanceRequest`, reviewed like a parent
 * observation. Approving one is what turns it into the record staff sees.
 */
export function ChildAttendance({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  const month = currentMonth();

  const records = useQuery({
    queryKey: qk.attendance(childId, month),
    queryFn: () => get(`/children/${childId}/attendance?month=${month}`, recordsSchema),
  });

  const requests = useQuery({
    queryKey: qk.attendanceRequests(childId),
    queryFn: () => get(`/children/${childId}/attendance-requests`, requestsSchema),
  });

  if (records.isPending) return <LoadingState rows={3} />;
  if (records.isError) return <ErrorState description={errorMessage(records.error)} />;

  return (
    <div className="flex flex-col gap-6">
      {isStaff ? <TodayRecorder childId={childId} month={month} /> : null}

      <section aria-labelledby="attendance-month-heading">
        <SectionHeader id="attendance-month-heading" title="Энэ сарын ирц" />

        {records.data.length === 0 ? (
          <EmptyState
            icon={<Image src="/background/mascot-girl-teal-a.webp" alt="" width={96} height={96} />}
            title="Одоогоор бүртгэл алга"
            description={
              isStaff
                ? "Өнөөдрийн ирцээс эхлээд бүртгэж эхэлнэ үү."
                : "Багш ирц бүртгэсний дараа энд харагдана."
            }
          />
        ) : (
          <Card className="divide-y divide-border">
            {records.data.map((record) => (
              <div
                key={record.id}
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{formatDate(record.date)}</p>
                  {record.note ? (
                    <p className="mt-0.5 text-body text-muted">{record.note}</p>
                  ) : null}
                </div>
                <Badge tone={STATUS_TONE[record.status]}>{STATUS_LABEL[record.status]}</Badge>
              </div>
            ))}
          </Card>
        )}
      </section>

      {!isStaff ? (
        <section aria-labelledby="attendance-requests-heading">
          <SectionHeader
            id="attendance-requests-heading"
            title="Чөлөөний хүсэлт"
            action={
              <RequestLeaveDialog
                childId={childId}
                trigger={
                  <Button size="sm" variant="secondary">
                    Чөлөө хүсэх
                  </Button>
                }
              />
            }
          />

          {requests.isPending ? <LoadingState rows={2} /> : null}
          {requests.isError ? <ErrorState description={errorMessage(requests.error)} /> : null}

          {requests.data && requests.data.length === 0 ? (
            <EmptyState
              icon={
                <Image src="/background/mascot-girl-teal-b.webp" alt="" width={96} height={96} />
              }
              title="Хүсэлт алга"
              description="Хүүхэд чөлөөтэй байх өдрөө урьдчилан мэдэгдэхийг хүсвэл энд бичнэ үү."
            />
          ) : null}

          {requests.data && requests.data.length > 0 ? (
            <Card className="divide-y divide-border">
              {requests.data.map((req) => (
                <div key={req.id} className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-ink">
                      {formatDate(req.dateFrom)}
                      {req.dateFrom !== req.dateTo ? ` – ${formatDate(req.dateTo)}` : ""}
                    </p>
                    <Badge tone={REVIEW_TONE[req.reviewStatus]}>
                      {REVIEW_LABEL[req.reviewStatus]}
                    </Badge>
                  </div>
                  <p className="text-body text-muted">
                    {STATUS_LABEL[req.requestedStatus]}
                    {req.reason ? ` · ${req.reason}` : ""}
                  </p>
                </div>
              ))}
            </Card>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * The quick "today" recorder — staff only.
 *
 * A single row of status buttons, matching the group day sheet's affordance
 * (`groups/[groupId]/attendance`) so the same tap pattern works whether a
 * teacher is marking one child from their own page or the whole group at once.
 */
function TodayRecorder({ childId, month }: { childId: string; month: string }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const record = useMutation({
    mutationFn: (status: string) =>
      mutate(`/children/${childId}/attendance/${today}`, attendanceRecordSchema, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.attendance(childId, month) });
    },
  });

  return (
    <Card className="flex flex-col gap-3 px-4 py-4">
      <p className="font-medium text-ink">Өнөөдрийн ирц</p>
      <div role="radiogroup" aria-label="Өнөөдрийн ирц" className="flex flex-wrap gap-2">
        {Object.entries(STATUS_LABEL).map(([status, label]) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={false}
            disabled={record.isPending}
            onClick={() => record.mutate(status)}
            className={cn(
              "min-h-11 rounded-control border border-border bg-surface px-3 text-body font-medium text-muted transition-colors",
              "hover:bg-canvas hover:text-ink disabled:opacity-60",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <FormError message={record.isError ? errorMessage(record.error) : null} />
    </Card>
  );
}

function RequestLeaveDialog({ childId, trigger }: { childId: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      {open ? <RequestDialog childId={childId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RequestDialog({ childId, onClose }: { childId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [requestedStatus, setRequestedStatus] = useState<"EXCUSED" | "SICK">("EXCUSED");
  const [reason, setReason] = useState("");

  const create = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/attendance-requests`, attendanceRequestSchema, {
        method: "POST",
        body: { dateFrom, dateTo, requestedStatus, reason: reason.trim() || null },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.attendanceRequests(childId) });
      onClose();
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Чөлөөний хүсэлт"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[480px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <div>
            <h2 className="text-title font-semibold text-ink">Чөлөөний хүсэлт</h2>
            <p className="mt-0.5 text-body text-muted">
              Багш хүсэлтийг хүлээн авсны дараа ирцэд бүртгэгдэнэ.
            </p>
          </div>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Эхлэх огноо" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="date"
                  required
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              )}
            </Field>
            <Field label="Дуусах огноо" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="date"
                  required
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              )}
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-body font-medium text-ink">Төрөл</legend>
            <div className="flex gap-2">
              {(["EXCUSED", "SICK"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  role="radio"
                  aria-checked={requestedStatus === status}
                  onClick={() => setRequestedStatus(status)}
                  className={cn(
                    "min-h-11 rounded-control border px-3 text-body font-medium transition-colors",
                    requestedStatus === status
                      ? "border-primary bg-primary text-primary-ink"
                      : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
                  )}
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          </fieldset>

          <Field label="Тайлбар" hint="Заавал биш.">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Илгээж байна…" : "Хүсэлт илгээх"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
              Болих
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
