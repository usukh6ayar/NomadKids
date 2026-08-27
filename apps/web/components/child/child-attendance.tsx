"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { Check, LogOut, Megaphone } from "lucide-react";
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
import { AttendanceCalendar } from "@/components/child/attendance-calendar";
import { formatDate } from "@/lib/format";
import {
  ATTENDANCE_COMPANION_ICON as COMPANION_ICON,
  ATTENDANCE_COMPANION_LABEL as COMPANION_LABEL,
  ATTENDANCE_COMPANION_ORDER as COMPANION_ORDER,
  ATTENDANCE_STATUS_LABEL as STATUS_LABEL,
  attendanceCompanionDisplay as companionDisplay,
  attendanceCompanionSuffix as companionSuffix,
} from "@/lib/attendance-meta";
import { cn } from "@/lib/utils";

const recordsSchema = z.array(attendanceRecordSchema);
const requestsSchema = z.array(attendanceRequestSchema);
type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;

/** `HH:MM` right now, in the viewer's own timezone. */
function nowTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** An ISO timestamp to `HH:MM`, in the viewer's own timezone — not a slice of
 * the raw string, which would read the server's UTC hour instead. */
function toLocalTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** `today` (`YYYY-MM-DD`) + `time` (`HH:MM`) to a full ISO instant, read back
 * in the browser's own timezone rather than assumed UTC. */
function toIso(today: string, time: string): string {
  return new Date(`${today}T${time}:00`).toISOString();
}

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
export function ChildAttendance({
  childId,
  isStaff,
  childFirstName,
}: {
  childId: string;
  isStaff: boolean;
  /** For the arrival panel's confirmation line ("Оюун ... ирлээ"). Omitted
   * entirely when the caller has no name handy — the sentence still reads
   * without it, just less personally. */
  childFirstName?: string;
}) {
  const requests = useQuery({
    queryKey: qk.attendanceRequests(childId),
    queryFn: () => get(`/children/${childId}/attendance-requests`, requestsSchema),
  });

  /*
   * ★ Which of today's two claims is next — decided from `requests.data`,
   * not a second fetch. A day is "arrived" once any of today's PRESENT
   * requests carries `arrivedWith` (pending or already approved — the
   * button's job is "have you told us", not "has staff confirmed it"), and
   * "picked up" the same way. `dateFrom === dateTo === today` because a
   * multi-day PRESENT request is not what either dialog ever creates.
   */
  const today = new Date().toISOString().slice(0, 10);
  const isToday = (r: { dateFrom: string; dateTo: string }) =>
    r.dateFrom.slice(0, 10) === today && r.dateTo.slice(0, 10) === today;
  const arrivedToday = requests.data?.some(
    (r) => r.requestedStatus === "PRESENT" && isToday(r) && r.arrivedWith,
  );
  const pickedUpToday = requests.data?.some(
    (r) => r.requestedStatus === "PRESENT" && isToday(r) && r.pickedUpWith,
  );

  return (
    <div className="flex flex-col gap-6">
      {isStaff ? <TodayAttendanceRecorder childId={childId} childFirstName={childFirstName} /> : null}

      {/*
        ★ A calendar, not the flat "Энэ сарын ирц" list this tab used to end
        with. Same data (`AttendanceCalendar` reads the identical
        `GET .../attendance?month=` this list did), just the grid shape the
        parent asked this screen to match instead of a column of date rows —
        see the "Гараас гарт" screenshot's own "Ирцийн хуанли" card, which is
        this exact component already shipped on `/overview`. One component,
        two screens, rather than the month rendered two different ways.
      */}
      <AttendanceCalendar childId={childId} />

      {!isStaff ? (
        <section aria-labelledby="attendance-requests-heading">
          <SectionHeader
            id="attendance-requests-heading"
            title="Ирцийн мэдэгдэл"
            lede="Ирснийг мэдэгдэх эсвэл чөлөө хүсэх — багш хянаад ирцэд бүртгэнэ."
            action={
              <div className="flex flex-wrap items-center gap-2">
                {!arrivedToday ? (
                  <ReportAttendanceDialog
                    childId={childId}
                    mode="arrival"
                    trigger={
                      <Button size="sm">
                        <Megaphone size={16} />
                        Ирц мэдэгдэх
                      </Button>
                    }
                  />
                ) : !pickedUpToday ? (
                  <ReportAttendanceDialog
                    childId={childId}
                    mode="pickup"
                    trigger={
                      <Button size="sm">
                        <LogOut size={16} />
                        Гарсныг мэдэгдэх
                      </Button>
                    }
                  />
                ) : (
                  <span className="flex items-center gap-1.5 text-body text-mint-ink">
                    <Check size={16} className="shrink-0" aria-hidden="true" />
                    Өнөөдрийн ирц бүрэн мэдэгдсэн
                  </span>
                )}
                <RequestLeaveDialog
                  childId={childId}
                  trigger={
                    <Button size="sm" variant="secondary">
                      Чөлөө хүсэх
                    </Button>
                  }
                />
              </div>
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
                    {req.pickedUpWith && !req.arrivedWith ? "Явсан" : STATUS_LABEL[req.requestedStatus]}
                    {req.arrivedWith
                      ? ` · ${companionDisplay(req.arrivedWith, req.arrivedWithName)}${req.arrivedAt ? `, ${toLocalTime(req.arrivedAt)}` : ""}`
                      : ""}
                    {req.pickedUpWith
                      ? ` · ${companionDisplay(req.pickedUpWith, req.pickedUpWithName)}${req.pickedUpAt ? `, ${toLocalTime(req.pickedUpAt)}` : ""}`
                      : ""}
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
 * `TodayRecorder`, fetching its own "today" — the piece `/children/:id`'s
 * "Ирц" tab (`ChildAttendance`) and `/children/:id/overview` both mount,
 * exported so the recorder is one component rather than two screens each
 * growing their own copy of "find today's row in this month's records".
 *
 * The month query shares `ChildAttendance`'s own cache key
 * (`qk.attendance`), so on the tab (which fetches the same month for its own
 * list) this costs no second request — only `/overview`, which has no other
 * reason to fetch attendance, pays for one.
 *
 * ★ Staff-only by omission, not a prop: the caller (both of them) already
 * knows the viewer's role for other reasons and renders this behind its own
 * `isStaff` check, the same way `ChildAttendance` always has.
 */
export function TodayAttendanceRecorder({
  childId,
  childFirstName,
}: {
  childId: string;
  childFirstName?: string;
}) {
  const month = currentMonth();
  const today = new Date().toISOString().slice(0, 10);

  const records = useQuery({
    queryKey: qk.attendance(childId, month),
    queryFn: () => get(`/children/${childId}/attendance?month=${month}`, recordsSchema),
  });

  if (records.isPending) return <LoadingState rows={2} />;
  if (records.isError) return <ErrorState description={errorMessage(records.error)} />;

  const todayRecord = records.data.find((r) => r.date.slice(0, 10) === today);

  return (
    <TodayRecorder
      childId={childId}
      month={month}
      today={today}
      todayRecord={todayRecord}
      childFirstName={childFirstName}
    />
  );
}

/**
 * The quick "today" recorder — staff only.
 *
 * A single row of status buttons, matching the group day sheet's affordance
 * (`groups/[groupId]/attendance`) so the same tap pattern works whether a
 * teacher is marking one child from their own page or the whole group at once.
 *
 * ★ "Ирсэн" alone does not save. Every other status is a single fact and
 * saves on tap, same as before — but PRESENT carries two more questions
 * ("Хэнтэй ирсэн бэ?", what time) the mock-up asks before it counts as
 * recorded, so tapping it only opens `ArrivalDetails`; that panel's own
 * button is what actually writes `status: "PRESENT"` together with
 * `arrivedWith`/`arrivedAt` in one call, rather than creating a bare PRESENT
 * row first and patching it a second later.
 */
function TodayRecorder({
  childId,
  month,
  today,
  todayRecord,
  childFirstName,
}: {
  childId: string;
  month: string;
  today: string;
  todayRecord: AttendanceRecord | undefined;
  childFirstName?: string;
}) {
  const queryClient = useQueryClient();
  const [arrivalOpen, setArrivalOpen] = useState(todayRecord?.status === "PRESENT");

  const record = useMutation({
    mutationFn: (body: {
      status: string;
      arrivedWith?: string | null;
      arrivedWithName?: string | null;
      arrivedAt?: string | null;
    }) =>
      mutate(`/children/${childId}/attendance/${today}`, attendanceRecordSchema, {
        method: "PUT",
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.attendance(childId, month) });
    },
  });

  const currentStatus = todayRecord?.status;
  const showArrival = arrivalOpen || currentStatus === "PRESENT";

  return (
    <Card className="flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-col gap-3">
        <p className="font-medium text-ink">Өнөөдрийн ирц</p>
        <div role="radiogroup" aria-label="Өнөөдрийн ирц" className="flex flex-wrap gap-2">
          {Object.entries(STATUS_LABEL).map(([status, label]) => {
            const active = currentStatus ? currentStatus === status : status === "PRESENT" && arrivalOpen;
            return (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={record.isPending}
                onClick={() => {
                  if (status === "PRESENT") {
                    setArrivalOpen(true);
                    return;
                  }
                  setArrivalOpen(false);
                  record.mutate({ status });
                }}
                className={cn(
                  "min-h-11 rounded-control border px-3 text-body font-medium transition-colors disabled:opacity-60",
                  active
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <FormError message={record.isError ? errorMessage(record.error) : null} />
      </div>

      {showArrival ? (
        <ArrivalDetails
          today={today}
          childFirstName={childFirstName}
          pending={record.isPending}
          savedWith={currentStatus === "PRESENT" ? (todayRecord?.arrivedWith ?? null) : null}
          savedWithName={currentStatus === "PRESENT" ? (todayRecord?.arrivedWithName ?? null) : null}
          savedAt={currentStatus === "PRESENT" ? (todayRecord?.arrivedAt ?? null) : null}
          onConfirm={(arrivedWith, arrivedWithName, arrivedAt) =>
            record.mutate({ status: "PRESENT", arrivedWith, arrivedWithName, arrivedAt })
          }
        />
      ) : null}

      {currentStatus === "PRESENT" ? (
        <PickupDetails
          childId={childId}
          month={month}
          today={today}
          childFirstName={childFirstName}
          pickedUpWith={todayRecord?.pickedUpWith ?? null}
          pickedUpWithName={todayRecord?.pickedUpWithName ?? null}
          pickedUpAt={todayRecord?.pickedUpAt ?? null}
        />
      ) : null}
    </Card>
  );
}

/**
 * "Хэнтэй ирсэн бэ?" — the companion + time a `status: "PRESENT"` write
 * carries. Its own confirm button, not autosave-per-tap like the status
 * row above: picking a companion and a time is one decision, not two, and
 * saving after every tap would fire a request per option the teacher tries.
 */
function ArrivalDetails({
  today,
  childFirstName,
  savedWith,
  savedWithName,
  savedAt,
  pending,
  onConfirm,
}: {
  today: string;
  childFirstName?: string;
  savedWith: string | null | undefined;
  savedWithName: string | null | undefined;
  savedAt: string | null | undefined;
  pending: boolean;
  onConfirm: (arrivedWith: string, arrivedWithName: string | null, arrivedAt: string) => void;
}) {
  const [companion, setCompanion] = useState<string>(savedWith ?? "MOTHER");
  const [name, setName] = useState(savedWithName ?? "");
  const [time, setTime] = useState(savedAt ? toLocalTime(savedAt) : nowTime());
  const isOther = companion === "OTHER";

  return (
    <div className="flex flex-col gap-3 rounded-control bg-canvas p-3.5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-body font-medium text-ink">Хэнтэй ирсэн бэ?</legend>
        <div className="grid grid-cols-3 gap-2">
          {COMPANION_ORDER.map((value) => {
            const Icon = COMPANION_ICON[value]!;
            const active = companion === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCompanion(value)}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border px-1 text-caption font-medium transition-colors",
                  active
                    ? "border-mint bg-mint text-mint-ink"
                    : "border-border bg-surface text-muted hover:text-ink",
                )}
              >
                <Icon size={18} aria-hidden="true" />
                {COMPANION_LABEL[value]}
              </button>
            );
          })}
        </div>
      </fieldset>

      {isOther ? (
        <Field label="Хэн бэ?" hint="Жишээ нь: жолооч, эмээ, ах">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
            />
          )}
        </Field>
      ) : null}

      {savedWith ? (
        <p className="flex items-center gap-1.5 text-body text-mint-ink">
          <Check size={16} className="shrink-0" aria-hidden="true" />
          {childFirstName ? `${childFirstName} ` : "Хүүхэд "}
          {companionSuffix(savedWith, savedWithName)} цэцэрлэгтээ{" "}
          {savedAt ? toLocalTime(savedAt) : "—"} цагт ирлээ.
        </p>
      ) : null}

      <Field label="Ирсэн цаг">
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-[140px]"
          />
        )}
      </Field>

      <Button
        type="button"
        size="sm"
        disabled={pending || (isOther && !name.trim())}
        onClick={() => onConfirm(companion, isOther ? name.trim() : null, toIso(today, time))}
        className="self-start"
      >
        <Check size={16} />
        {pending ? "Бүртгэж байна…" : "Ирц бүртгэв"}
      </Button>
    </div>
  );
}

/**
 * "Гараас гарт" — who picked the child up, recorded independently of the
 * morning's arrival (`PATCH .../pickup`, not the same `PUT` `record` uses),
 * so this never has to resend the day's status.
 */
function PickupDetails({
  childId,
  month,
  today,
  childFirstName,
  pickedUpWith,
  pickedUpWithName,
  pickedUpAt,
}: {
  childId: string;
  month: string;
  today: string;
  childFirstName?: string;
  pickedUpWith: string | null | undefined;
  pickedUpWithName: string | null | undefined;
  pickedUpAt: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const [companion, setCompanion] = useState<string>(pickedUpWith ?? "MOTHER");
  const [name, setName] = useState(pickedUpWithName ?? "");
  const [time, setTime] = useState(pickedUpAt ? toLocalTime(pickedUpAt) : nowTime());
  const isOther = companion === "OTHER";

  const pickup = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/attendance/${today}/pickup`, attendanceRecordSchema, {
        method: "PATCH",
        body: {
          pickedUpWith: companion,
          pickedUpWithName: isOther ? name.trim() : null,
          pickedUpAt: toIso(today, time),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.attendance(childId, month) });
    },
  });

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <p className="flex items-center gap-1.5 font-medium text-ink">
        <LogOut size={16} className="shrink-0 text-muted" aria-hidden="true" />
        Гараас гарт
      </p>

      <FormError message={pickup.isError ? errorMessage(pickup.error) : null} />

      <div className="grid grid-cols-3 gap-2">
        {COMPANION_ORDER.map((value) => {
          const Icon = COMPANION_ICON[value]!;
          const active = companion === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setCompanion(value)}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border px-1 text-caption font-medium transition-colors",
                active
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-muted hover:text-ink",
              )}
            >
              <Icon size={18} aria-hidden="true" />
              {COMPANION_LABEL[value]}
            </button>
          );
        })}
      </div>

      {isOther ? (
        <Field label="Хэн бэ?" hint="Жишээ нь: жолооч, эмээ, ах">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
            />
          )}
        </Field>
      ) : null}

      {pickedUpWith ? (
        <p className="flex items-center gap-1.5 text-body text-primary">
          <Check size={16} className="shrink-0" aria-hidden="true" />
          {childFirstName ? `${childFirstName} ` : "Хүүхэд "}
          {companionSuffix(pickedUpWith, pickedUpWithName)}{" "}
          {pickedUpAt ? toLocalTime(pickedUpAt) : "—"} цагт явлаа.
        </p>
      ) : null}

      <Field label="Явсан цаг">
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-[140px]"
          />
        )}
      </Field>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pickup.isPending || (isOther && !name.trim())}
        onClick={() => pickup.mutate()}
        className="self-start"
      >
        <LogOut size={16} />
        {pickup.isPending ? "Бүртгэж байна…" : "Гарсныг бүртгэх"}
      </Button>
    </div>
  );
}

/** Copy that differs between the two moments `ReportAttendanceModal` covers —
 * everything else about the dialog (the companion grid, the time field, the
 * request it sends) is identical. */
const ATTENDANCE_REPORT_COPY = {
  arrival: {
    title: "Ирц мэдэгдэх",
    description: "Багш хүлээн авч баталгаажуулсны дараа өнөөдрийн ирцэд бүртгэгдэнэ.",
    question: "Хэнтэй ирсэн бэ?",
    timeLabel: "Ирсэн цаг",
  },
  pickup: {
    title: "Гарсныг мэдэгдэх",
    description: "Багш хүлээн авч баталгаажуулсны дараа өнөөдрийн ирцэд гарсан гэж бүртгэгдэнэ.",
    question: "Хэнтэй авав?",
    timeLabel: "Явсан цаг",
  },
} as const;

/**
 * "Ирц мэдэгдэх" / "Гарсныг мэдэгдэх" — a guardian's own two claims for one
 * day: drop-off, then — hours later, once the child is already checked in —
 * pickup ("Гараас гарт"). Same shape as `RequestDialog`'s leave notice below
 * (a `POST` to `.../attendance-requests`, reviewed before it becomes a real
 * `Attendance` fact — "staff record; guardians request" holds exactly as it
 * always has), but with `requestedStatus: "PRESENT"` fixed and the
 * companion+time picker instead of a reason field. Always today — a
 * guardian reports the day that is already happening, not a future or past
 * one. Which of the two this is comes from `mode`, decided by the caller
 * (`ChildAttendance`) from whether today's arrival has already been claimed.
 */
function ReportAttendanceDialog({
  childId,
  mode,
  trigger,
}: {
  childId: string;
  mode: "arrival" | "pickup";
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      {open ? (
        <ReportAttendanceModal childId={childId} mode={mode} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function ReportAttendanceModal({
  childId,
  mode,
  onClose,
}: {
  childId: string;
  mode: "arrival" | "pickup";
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [companion, setCompanion] = useState<string>("MOTHER");
  const [name, setName] = useState("");
  const [time, setTime] = useState(nowTime());
  const copy = ATTENDANCE_REPORT_COPY[mode];
  const isOther = companion === "OTHER";

  const create = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/attendance-requests`, attendanceRequestSchema, {
        method: "POST",
        body: {
          dateFrom: today,
          dateTo: today,
          requestedStatus: "PRESENT",
          ...(mode === "arrival"
            ? {
                arrivedWith: companion,
                arrivedWithName: isOther ? name.trim() : null,
                arrivedAt: toIso(today, time),
              }
            : {
                pickedUpWith: companion,
                pickedUpWithName: isOther ? name.trim() : null,
                pickedUpAt: toIso(today, time),
              }),
        },
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
      aria-label={copy.title}
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
            <h2 className="text-title font-semibold text-ink">{copy.title}</h2>
            <p className="mt-0.5 text-body text-muted">{copy.description}</p>
          </div>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-body font-medium text-ink">{copy.question}</legend>
            <div className="grid grid-cols-3 gap-2">
              {COMPANION_ORDER.map((value) => {
                const Icon = COMPANION_ICON[value]!;
                const active = companion === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setCompanion(value)}
                    className={cn(
                      "flex min-h-16 flex-col items-center justify-center gap-1 rounded-control border px-1 text-caption font-medium transition-colors",
                      active
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border bg-surface text-muted hover:text-ink",
                    )}
                  >
                    <Icon size={18} aria-hidden="true" />
                    {COMPANION_LABEL[value]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {isOther ? (
            <Field label="Хэн бэ?" hint="Жишээ нь: жолооч, эмээ, ах">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  autoFocus
                />
              )}
            </Field>
          ) : null}

          <Field label={copy.timeLabel}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-[140px]"
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={create.isPending || (isOther && !name.trim())}>
              {create.isPending ? "Илгээж байна…" : "Мэдэгдэх"}
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
