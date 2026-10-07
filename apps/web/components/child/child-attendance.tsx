"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  Clock3,
  FileText,
  LogIn,
  LogOut,
  Paperclip,
  UserRound,
  X,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { z } from "zod";
import { attendanceRecordSchema, attendanceRequestSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { AttendanceCalendar } from "@/components/child/attendance-calendar";
import { formatDate, todayLocal } from "@/lib/format";
import {
  ATTENDANCE_COMPANION_ICON as COMPANION_ICON,
  ATTENDANCE_COMPANION_LABEL as COMPANION_LABEL,
  ATTENDANCE_COMPANION_ORDER as COMPANION_ORDER,
  ATTENDANCE_STATUS_LABEL as STATUS_LABEL,
  attendanceCompanionDisplay as companionDisplay,
  attendanceCompanionSuffix as companionSuffix,
  attendanceEventSentence,
} from "@/lib/attendance-meta";
import { cn } from "@/lib/utils";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";
import { GuardianHandover } from "@/components/child/guardian-handover";

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

/** `YYYY-MM` for the current month, in the viewer's own timezone. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const WEEKDAY_LABEL = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

/** A local calendar date, kept at midday so parsing never rolls it into the
 * previous date in Mongolia (or any other positive UTC offset). */
function localCalendarDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

function todayLabel(value: string): string {
  const date = localCalendarDate(value);
  return `${date.getFullYear()} оны ${date.getMonth() + 1}-р сарын ${date.getDate()} · ${WEEKDAY_LABEL[date.getDay()]}`;
}

function eventSentence(record: AttendanceRecord | undefined): string {
  if (!record) return "Өнөөдрийн ирц хараахан бүртгэгдээгүй байна.";

  if (record.pickedUpWith) {
    return `${record.pickedUpAt ? `${toLocalTime(record.pickedUpAt)}-д ` : ""}${companionSuffix(record.pickedUpWith, record.pickedUpWithName)} цэцэрлэгээс явлаа.`;
  }
  if (record.arrivedWith) {
    return `${record.arrivedAt ? `${toLocalTime(record.arrivedAt)}-д ` : ""}${companionSuffix(record.arrivedWith, record.arrivedWithName)} цэцэрлэгтээ ирлээ.`;
  }
  return `Өнөөдрийн төлөв: ${STATUS_LABEL[record.status]}.`;
}

/**
 * The family's own version of the same line — the child named, and the date in
 * it. 2026-09-12: "Б. Бат аавтайгаа 2026. 9. 11-нд 10:23 минутад цэцэрлэгтээ
 * ирлээ гэж өгүүлбэрээр харагд."
 *
 * The register row wins over the family's own report when both exist: a teacher
 * may have corrected the time, and the corrected one is the fact.
 */
function guardianSentence(
  childName: string | undefined,
  today: string,
  record: AttendanceRecord | undefined,
  request: z.infer<typeof attendanceRequestSchema> | undefined,
): string {
  for (const source of [record, request]) {
    if (!source) continue;
    if (source.pickedUpWith) {
      return attendanceEventSentence({
        mode: "pickup",
        childName,
        companion: source.pickedUpWith,
        companionName: source.pickedUpWithName,
        date: today,
        time: source.pickedUpAt ? toLocalTime(source.pickedUpAt) : null,
      });
    }
    if (source.arrivedWith) {
      return attendanceEventSentence({
        mode: "arrival",
        childName,
        companion: source.arrivedWith,
        companionName: source.arrivedWithName,
        date: today,
        time: source.arrivedAt ? toLocalTime(source.arrivedAt) : null,
      });
    }
  }

  if (record) return `Өнөөдрийн төлөв: ${STATUS_LABEL[record.status]}.`;
  return "Өнөөдрийн ирц хараахан бүртгэгдээгүй байна.";
}

function LastRegistration({ record }: { record: AttendanceRecord | undefined }) {
  if (!record) {
    return (
      <div className="border-t border-border pt-3">
        <p className="text-caption font-medium text-muted">Сүүлийн бүртгэл</p>
        <p className="mt-1 text-body text-muted">Ирцийн бүртгэл алга.</p>
      </div>
    );
  }

  const time = record.pickedUpAt ?? record.arrivedAt;
  const companion = record.pickedUpWith ?? record.arrivedWith;
  const companionName = record.pickedUpWithName ?? record.arrivedWithName;

  return (
    <div className="grid gap-2 border-t border-border pt-3 text-body sm:grid-cols-3">
      <div className="flex items-center gap-2 text-muted">
        <CalendarDays size={16} aria-hidden="true" />
        <span>{formatDate(record.date)}</span>
      </div>
      <div className="flex items-center gap-2 text-muted">
        <Clock3 size={16} aria-hidden="true" />
        <span>{time ? toLocalTime(time) : "Цаггүй"}</span>
      </div>
      <div className="flex items-center gap-2 text-muted">
        <UserRound size={16} aria-hidden="true" />
        <span>
          {companion ? companionDisplay(companion, companionName) : "Хүлээн авсан хүнгүй"}
        </span>
      </div>
    </div>
  );
}

/**
 * The "Ирц" tab.
 *
 * ★ Staff record; guardians request. A parent never writes an `Attendance` row
 * directly — RFP appendix gives attendance-taking to the kindergarten, so the
 * "Ирц" a family submits is an `AttendanceRequest`, reviewed like a parent
 * observation. Approving one is what turns it into the record staff sees.
 */
/**
 * The phone shape the three attendance buttons share.
 *
 * ★ Glyph over label below `sm`, an ordinary button from `sm` up.
 *
 * "Чөлөө хүсэх" is eleven characters and an icon; at a third of a 375px screen
 * there is no line that holds both side by side. Stacking them keeps every
 * label whole, which truncating to "Чөлөө х…" would not.
 */
/*
  ★ Words only — client, 2026-10-06: the arrow and page glyphs are gone, and a
  ✓ before the word says the step is done. With no glyph to stack over the
  label, the three are ordinary one-line buttons at every width.
*/
const STACKED = "h-[48px] gap-1 px-1 text-compact sm:h-[44px] sm:text-body";

export function ChildAttendance({
  childId,
  isStaff,
  childName,
}: {
  childId: string;
  isStaff: boolean;
  /** For the arrival panel's confirmation line ("Оюун ... ирлээ"). Omitted
   * entirely when the caller has no name handy — the sentence still reads
   * without it, just less personally. */
  childName?: string;
}) {
  const requests = useQuery({
    queryKey: qk.attendanceRequests(childId),
    queryFn: () => get(`/children/${childId}/attendance-requests`, requestsSchema),
  });

  return (
    <div className="flex flex-col gap-6">
      {isStaff ? (
        <TodayAttendanceRecorder childId={childId} childName={childName} />
      ) : (
        <GuardianTodayAttendance
          childId={childId}
          childName={childName}
          requests={requests.data ?? []}
          requestsPending={requests.isPending}
        />
      )}

      {isStaff ? (
        /*
          ★ A calendar, not the flat "Энэ сарын ирц" list this tab used to end
          with — same data, the grid shape `/overview` already ships.
        */
        <AttendanceCalendar childId={childId} />
      ) : (
        <GuardianAttendanceTabs childId={childId} requests={requests} />
      )}
    </div>
  );
}

const GUARDIAN_TABS = [
  { key: "handover", label: "Гараас гарт" },
  { key: "summary", label: "Ирцийн нэгтгэл" },
  { key: "calendar", label: "Календар" },
] as const;

/**
 * ★ One of three at a time — client, 2026-10-07: «Гараас гарт», then
 * «Ирцийн нэгтгэл», then «Календар», chosen rather than stacked. Quiet text
 * tabs like «Нэхэмжлэх»'s; each tab names its panel, so the panels draw no
 * section header (and no accent bar) of their own.
 */
function GuardianAttendanceTabs({
  childId,
  requests,
}: {
  childId: string;
  requests: { data?: z.infer<typeof attendanceRequestSchema>[]; isError: boolean; error: unknown };
}) {
  const [tab, setTab] = useState<(typeof GUARDIAN_TABS)[number]["key"]>("handover");
  const id = useId();

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Ирцийн хэсэг"
        className="-mx-4 flex gap-5 overflow-x-auto border-b border-border-soft px-4 sm:mx-0 sm:px-0"
      >
        {GUARDIAN_TABS.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              id={`${id}-${item.key}-tab`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${id}-${item.key}-panel`}
              onClick={() => setTab(item.key)}
              className={cn(
                "-mb-px min-h-[40px] shrink-0 whitespace-nowrap border-b-2 text-body transition-colors",
                active
                  ? "border-ink font-semibold text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${id}-${tab}-panel`}
        aria-label={GUARDIAN_TABS.find((item) => item.key === tab)!.label}
      >
        {tab === "handover" ? (
          requests.isError ? (
            <ErrorState description={errorMessage(requests.error)} />
          ) : (
            <GuardianHandover childId={childId} requests={requests.data ?? []} />
          )
        ) : (
          <AttendanceCalendar childId={childId} view={tab} />
        )}
      </div>
    </div>
  );
}

/** The parent's task-first card. Reporting still creates a reviewable request;
 * only staff can write the attendance record itself. */
function GuardianTodayAttendance({
  childId,
  childName,
  requests,
  requestsPending,
}: {
  childId: string;
  childName?: string;
  requests: z.infer<typeof attendanceRequestSchema>[];
  requestsPending: boolean;
}) {
  const month = currentMonth();
  const today = todayLocal();
  const records = useQuery({
    queryKey: qk.attendance(childId, month),
    queryFn: () => get(`/children/${childId}/attendance?month=${month}`, recordsSchema),
  });

  if (records.isPending) return <LoadingState rows={2} />;
  if (records.isError) return <ErrorState description={errorMessage(records.error)} />;

  const todayRecord = records.data.find((record) => record.date.slice(0, 10) === today);
  const todayRequests = requests.filter(
    (request) =>
      request.requestedStatus === "PRESENT" &&
      request.dateFrom.slice(0, 10) === today &&
      request.dateTo.slice(0, 10) === today &&
      request.reviewStatus !== "REJECTED",
  );
  const arrivalSent = Boolean(todayRecord?.arrivedWith || todayRequests.some((r) => r.arrivedWith));
  const pickupSent = Boolean(
    todayRecord?.pickedUpWith || todayRequests.some((r) => r.pickedUpWith),
  );
  /* A leave request covering today and not turned down — «✓ Чөлөө хүсэх». */
  const leaveSent = requests.some(
    (request) =>
      request.requestedStatus !== "PRESENT" &&
      request.dateFrom.slice(0, 10) <= today &&
      request.dateTo.slice(0, 10) >= today &&
      request.reviewStatus !== "REJECTED",
  );
  const pendingArrival = todayRequests.find((r) => r.arrivedWith);
  const pendingPickup = todayRequests.find((r) => r.pickedUpWith);
  const requestForSentence = pendingPickup ?? pendingArrival;
  const sentence = guardianSentence(childName, today, todayRecord, requestForSentence);

  /*
    ★ Saturday and Sunday the family's three buttons are closed — 2026-09-12,
    at the client's instruction: "бямба ням гарагт ирлээ явлаа чөлөөний
    хүснэгтийг ажиллуул болохгүй, учир нь цэцэрлэг амрах өдөр."

    Only the family's controls. A teacher correcting a mistake writes through
    their own day sheet, which the staff half of this file renders and which is
    deliberately left open — the same sentence of the client's says so ("багш
    алдааг залруулж засаж болно").

    ★★ The three greyed buttons say it on their own. A line of explanation under
    them was removed the same day it was added, at the client's instruction
    ("энэ бичгийг арилгаад өгөөч") — a weekend needs no announcing to a family
    who already knows the kindergarten is shut.
  */
  const weekday = localCalendarDate(today).getDay();
  const closed = weekday === 0 || weekday === 6;

  return (
    <section aria-labelledby="today-attendance-heading">
      <Card pad="roomy" className="overflow-hidden">
        <div className="flex flex-col gap-1">
          <h2 id="today-attendance-heading" className="text-title font-semibold text-ink">
            Өнөөдрийн ирц
          </h2>
          <p className="text-body text-muted">{todayLabel(today)}</p>
        </div>

        {/*
          ★ Three across on a phone too — 2026-09-12, at the client's request.

          It was one column below `sm`, so the three commonest actions a parent
          takes were three full-width buttons stacked down the screen, pushing
          the month's calendar under the fold. Three abreast at 375px leaves
          about 110px each, which a worded button cannot hold on one line — so
          on a phone the glyph sits above the label and the row is 56px tall,
          and from `sm` up they are ordinary buttons again.
        */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {closed || arrivalSent || requestsPending ? (
            <Button disabled block className={cn(STACKED, !closed && "bg-mint text-mint-ink")}>
              {arrivalSent && !closed ? <Check size={17} aria-hidden="true" /> : null}
              Ирлээ
            </Button>
          ) : (
            <ReportAttendanceDialog
              childId={childId}
              childName={childName}
              mode="arrival"
              trigger={
                <Button block className={cn(STACKED, "bg-mint text-mint-ink hover:bg-mint/80")}>
                  Ирлээ
                </Button>
              }
            />
          )}

          {closed || pickupSent || requestsPending || !arrivalSent ? (
            <Button disabled block className={STACKED}>
              {pickupSent && !closed ? <Check size={17} aria-hidden="true" /> : null}
              Явлаа
            </Button>
          ) : (
            <ReportAttendanceDialog
              childId={childId}
              childName={childName}
              mode="pickup"
              trigger={
                <Button block className={STACKED}>
                  Явлаа
                </Button>
              }
            />
          )}

          {closed ? (
            <Button disabled block variant="secondary" className={STACKED}>
              Чөлөө хүсэх
            </Button>
          ) : (
            <RequestLeaveDialog
              childId={childId}
              trigger={
                <Button block variant="secondary" className={STACKED}>
                  {leaveSent ? <Check size={17} aria-hidden="true" /> : null}
                  Чөлөө хүсэх
                </Button>
              }
            />
          )}
        </div>

        {/*
          ★ Under the buttons, not over them — 2026-09-12, at the client's
          instruction: "Ирлээ Явлаа Чөлөө хүсэх товчны доор [өгүүлбэр]".

          It sat between the date and the button row, which put a line that only
          changes *after* an action above the action itself. Read top to bottom
          the card now says what day it is, what you can do, and then what has
          happened.
        */}
        <p
          aria-live="polite"
          className="mt-3 flex items-start gap-2 text-body font-medium text-ink"
        >
          <span className="mt-[7px] size-2 shrink-0 rounded-pill bg-mint-ink" aria-hidden="true" />
          {sentence}
        </p>

        {/*
          ★ No "Сүүлийн бүртгэл" footer here — 2026-09-12, at the client's
          instruction ("энийг хас").

          It repeated the date, the time and the companion the sentence above it
          had just said in words, as three labelled cells. The family's card
          carries one reading of today, and the month's own grid
          (`AttendanceCalendar`, directly below) is where earlier days live. The
          staff recorder keeps the block: a teacher marking a register does read
          the last row as data rather than as a sentence.
        */}
      </Card>
    </section>
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
  childName,
}: {
  childId: string;
  childName?: string;
}) {
  const month = currentMonth();
  const today = todayLocal();

  const records = useQuery({
    queryKey: qk.attendance(childId, month),
    queryFn: () => get(`/children/${childId}/attendance?month=${month}`, recordsSchema),
  });

  if (records.isPending) return <LoadingState rows={2} />;
  if (records.isError) return <ErrorState description={errorMessage(records.error)} />;

  const todayRecord = records.data.find((r) => r.date.slice(0, 10) === today);
  const latestRecord = [...records.data].sort((a, b) => b.date.localeCompare(a.date))[0];

  return (
    <TodayRecorder
      childId={childId}
      month={month}
      today={today}
      todayRecord={todayRecord}
      latestRecord={latestRecord}
      childName={childName}
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
  latestRecord,
  childName,
}: {
  childId: string;
  month: string;
  today: string;
  todayRecord: AttendanceRecord | undefined;
  latestRecord: AttendanceRecord | undefined;
  childName?: string;
}) {
  const queryClient = useQueryClient();
  const [arrivalOpen, setArrivalOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);

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

  return (
    <section aria-labelledby="today-attendance-heading">
      <Card pad="roomy" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="today-attendance-heading" className="text-title font-semibold text-ink">
            Өнөөдрийн ирц
          </h2>
          <p className="text-body text-muted">{todayLabel(today)}</p>
          <p className="mt-1 flex items-start gap-2 text-body font-medium text-ink">
            <span
              className="mt-[7px] size-2 shrink-0 rounded-pill bg-mint-ink"
              aria-hidden="true"
            />
            {eventSentence(todayRecord)}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            block
            disabled={record.isPending}
            onClick={() => {
              setArrivalOpen((open) => !open);
              setPickupOpen(false);
            }}
            className={cn(currentStatus === "PRESENT" && "bg-mint text-mint-ink hover:bg-mint/80")}
          >
            {currentStatus === "PRESENT" ? <Check size={17} /> : <LogIn size={17} />}
            Ирлээ
          </Button>
          <Button
            block
            disabled={record.isPending || currentStatus !== "PRESENT"}
            onClick={() => {
              setPickupOpen((open) => !open);
              setArrivalOpen(false);
            }}
          >
            {todayRecord?.pickedUpWith ? <Check size={17} /> : <LogOut size={17} />}
            Явлаа
          </Button>
          <Button
            block
            variant="secondary"
            disabled={record.isPending}
            onClick={() => {
              setArrivalOpen(false);
              setPickupOpen(false);
              record.mutate({ status: "EXCUSED" });
            }}
          >
            <FileText size={17} />
            Чөлөөтэй
          </Button>
        </div>

        <FormError message={record.isError ? errorMessage(record.error) : null} />

        <LastRegistration record={latestRecord} />

        {arrivalOpen ? (
          <ArrivalDetails
            today={today}
            childName={childName}
            pending={record.isPending}
            savedWith={currentStatus === "PRESENT" ? (todayRecord?.arrivedWith ?? null) : null}
            savedWithName={
              currentStatus === "PRESENT" ? (todayRecord?.arrivedWithName ?? null) : null
            }
            savedAt={currentStatus === "PRESENT" ? (todayRecord?.arrivedAt ?? null) : null}
            onConfirm={(arrivedWith, arrivedWithName, arrivedAt) =>
              record.mutate(
                { status: "PRESENT", arrivedWith, arrivedWithName, arrivedAt },
                { onSuccess: () => setArrivalOpen(false) },
              )
            }
          />
        ) : null}

        {pickupOpen && currentStatus === "PRESENT" ? (
          <PickupDetails
            childId={childId}
            month={month}
            today={today}
            childName={childName}
            pickedUpWith={todayRecord?.pickedUpWith ?? null}
            pickedUpWithName={todayRecord?.pickedUpWithName ?? null}
            pickedUpAt={todayRecord?.pickedUpAt ?? null}
          />
        ) : null}
      </Card>
    </section>
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
  childName,
  savedWith,
  savedWithName,
  savedAt,
  pending,
  onConfirm,
}: {
  today: string;
  childName?: string;
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
          {childName ? `${childName} ` : "Хүүхэд "}
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
  childName,
  pickedUpWith,
  pickedUpWithName,
  pickedUpAt,
}: {
  childId: string;
  month: string;
  today: string;
  childName?: string;
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
          {childName ? `${childName} ` : "Хүүхэд "}
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
  childName,
  mode,
  trigger,
}: {
  childId: string;
  childName?: string;
  mode: "arrival" | "pickup";
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className="block" onClick={() => setOpen(true)}>
        {trigger}
      </span>
      {open ? (
        <ReportAttendanceModal
          childId={childId}
          childName={childName}
          mode={mode}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ReportAttendanceModal({
  childId,
  childName,
  mode,
  onClose,
}: {
  childId: string;
  childName?: string;
  mode: "arrival" | "pickup";
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const today = todayLocal();
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

  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      {...backdrop}
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

          {/*
            ★ The sentence itself, written out as the form is filled —
            2026-09-12: "ирлээ гэдэг дээр дарахаар … 2026. 9. 11-нд 10:23
            минутад цэцэрлэгтээ ирлээ гэж өгүүлбэрээр харагд."

            It reads back what is about to be sent, in the words a parent would
            use, rather than leaving them to assemble three separate controls in
            their head. The same builder writes the card's line afterwards, so
            sending changes nothing about the wording.
          */}
          <p
            aria-live="polite"
            className="rounded-row bg-sunken px-3 py-2.5 text-body font-medium text-ink"
          >
            {attendanceEventSentence({
              mode,
              childName,
              companion,
              companionName: isOther ? name.trim() : null,
              date: today,
              time,
            })}
          </p>

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
      <span className="block" onClick={() => setOpen(true)}>
        {trigger}
      </span>
      {open ? <RequestDialog childId={childId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RequestDialog({ childId, onClose }: { childId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = todayLocal();
  const attachmentId = useId();
  const attachmentRef = useRef<HTMLInputElement>(null);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [requestedStatus, setRequestedStatus] = useState<"EXCUSED" | "SICK">("EXCUSED");
  const [reason, setReason] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const invalidRange = dateFrom > dateTo;

  const create = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("dateFrom", dateFrom);
      form.append("dateTo", dateTo);
      form.append("requestedStatus", requestedStatus);
      if (reason.trim()) form.append("reason", reason.trim());
      if (attachment) form.append("attachment", attachment);

      return mutate(`/children/${childId}/attendance-requests`, attendanceRequestSchema, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.attendanceRequests(childId) });
      onClose();
    },
  });

  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Чөлөөний хүсэлт"
      {...backdrop}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[540px] rounded-card border border-border bg-surface p-5 shadow-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending && !invalidRange && !attachmentError) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-title font-semibold text-ink">Чөлөөний хүсэлт</h2>
              <p className="mt-0.5 text-body text-muted">
                Өвчтэй эсвэл чөлөөтэй байх хугацааг багшид мэдэгдэнэ.
              </p>
            </div>
            <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Хаах">
              <X size={18} />
            </Button>
          </div>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <Field label="Чөлөөний төрөл" required>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={requestedStatus}
                onChange={(event) => setRequestedStatus(event.target.value as "EXCUSED" | "SICK")}
              >
                <option value="EXCUSED">Чөлөөтэй</option>
                <option value="SICK">Өвчтэй</option>
              </Select>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Эхлэх огноо"
              error={invalidRange ? "Огнооны дарааллыг шалгана уу" : null}
              required
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
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

          <Field label="Тайлбар" hint="Шалтгаан болон багшид дамжуулах нэмэлт мэдээллээ бичнэ үү.">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Тайлбар оруулах"
                maxLength={2000}
              />
            )}
          </Field>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={attachmentId} className="text-body font-medium text-ink">
              Эмчийн бичиг хавсаргах
            </label>
            <input
              ref={attachmentRef}
              id={attachmentId}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setAttachmentError(null);
                if (!file) {
                  setAttachment(null);
                  return;
                }
                if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
                  setAttachment(null);
                  setAttachmentError("Зөвхөн PDF, JPG, PNG файл хавсаргана уу.");
                  return;
                }
                if (file.size > 25 * 1024 * 1024) {
                  setAttachment(null);
                  setAttachmentError("Файлын хэмжээ 25 MB-аас их байж болохгүй.");
                  return;
                }
                setAttachment(file);
              }}
            />
            <label
              htmlFor={attachmentId}
              className="flex min-h-20 cursor-pointer items-center gap-3 rounded-control border border-dashed border-faint bg-sunken px-4 py-3 text-body transition-colors hover:border-primary hover:bg-primary-soft"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-pill text-primary">
                <Paperclip size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">
                  {attachment?.name ?? "Файл сонгох"}
                </span>
                <span className="block text-caption text-muted">PDF, JPG, PNG · 25 MB хүртэл</span>
              </span>
            </label>
            {attachment ? (
              <button
                type="button"
                onClick={() => {
                  setAttachment(null);
                  setAttachmentError(null);
                  if (attachmentRef.current) attachmentRef.current.value = "";
                }}
                className="self-start text-caption font-medium text-primary hover:underline"
              >
                Хавсралтыг арилгах
              </button>
            ) : null}
            {attachmentError ? (
              <p role="alert" className="text-caption font-medium text-danger">
                {attachmentError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              type="submit"
              disabled={create.isPending || invalidRange || Boolean(attachmentError)}
            >
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
