"use client";

import { useIsPhone } from "@/lib/use-is-phone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MailQuestion,
  Search,
} from "lucide-react";
import { z } from "zod";
import {
  attendanceRecordSchema,
  attendanceSubmissionSchema,
  esisAttendancePreviewSchema,
  esisResourceReadSchema,
  groupAttendanceRangeSchema,
  groupAttendanceRowSchema,
  type EsisAttendancePreview,
  type GroupAttendanceRange,
  localDate,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { GroupSwitcher, useSwitchableGroups } from "@/components/shell/group-switcher";
import { qk } from "@/lib/api/keys";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import {
  AttendanceRequestQueue,
  useAttendanceRequestCount,
} from "@/components/attendance/request-queue";
import { TeacherJournal } from "@/components/attendance/teacher-journal";
import { AttendanceMonthPanel } from "@/components/attendance/month-panel";
import { AttendanceWeekGrid, isWeekend } from "@/components/attendance/week-grid";
import {
  ATTENDANCE_STATUS_CHART_TONE,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_ORDER,
} from "@/lib/attendance-meta";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const daySheetSchema = z.array(groupAttendanceRowSchema);

function today(): string {
  return localDate();
}

/**
 * The Monday of the week `iso` falls in.
 *
 * ★ Monday, not Sunday. A Mongolian kindergarten week runs Даваа–Баасан, and
 * `getUTCDay()` calls Sunday 0 — so Sunday has to reach *back* six days rather
 * than forward one, which is the off-by-one this exists to name.
 */
function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return date.toISOString().slice(0, 10);
}

/** `iso` moved by `days`, as `YYYY-MM-DD`. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** `2026-09-30` → `9.30`: the phone's range label, short as a calendar writes it. */
function shortDay(iso: string): string {
  return `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;
}

function endOfMonth(iso: string): string {
  const [year, month] = iso.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
}

function mergeRanges(
  week: GroupAttendanceRange,
  month: GroupAttendanceRange,
): GroupAttendanceRange {
  const monthRows = new Map(month.rows.map((row) => [row.enrollmentId, row]));
  return {
    days: [...new Set([...week.days, ...month.days])].sort(),
    rows: week.rows.map((row) => {
      const monthRow = monthRows.get(row.enrollmentId);
      return { ...row, records: { ...monthRow?.records, ...row.records } };
    }),
  };
}

/**
 * The group's day sheet — every enrolled child, one day.
 *
 * ★ Attendance uses an explicit review flow: Засах → status changes →
 * Хадгалах. Once the saved day is complete, the exact ESIS payload appears
 * and Илгээх becomes available.
 */
export default function GroupAttendancePage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <GroupAttendance />
    </RequireRole>
  );
}

function GroupAttendance() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const queryClient = useQueryClient();
  const { session } = useSession();
  const pendingRequests = useAttendanceRequestCount();

  /*
   * ★ A director reads this sheet; they do not fill it in — 2026-09-06.
   *
   * The client was flat about it: "бүлэг рүү орохоор сурагчид чөлөөтэй гэх мэт
   * тэдгээрийг дарахгүй байх — захирал тэрийг хийхгүй, багш хийгээд тэр
   * дата-г л захирал харна". The register is the teacher's account of their
   * own morning, and a second person marking it from another screen is how it
   * stops being anybody's account: the funding claim is built on these rows,
   * and "who said this child was here" has to have one answer.
   *
   * ★★ Held against ADMIN-without-TEACHER, not against ADMIN.
   *
   * A director who also teaches a group is a teacher on the mornings they
   * teach, and locking them out would leave that group's register with nobody
   * who can write it. Their membership says which they are; this reads the
   * same `Membership` the API re-derives per request (§1.3), not a claim baked
   * into a token.
   *
   * ★★★ This is presentation, not authorization. `PUT /children/:id/attendance`
   * still authorizes the way it always has — a director *can* correct a
   * register, and there are days when somebody must. What is gone is the
   * screen that invited it by default. `/attendance/daily` is where a director
   * is sent, and it links each row here for reading.
   */
  /*
   * ★ `?date=` seeds the picker — 2026-09-04.
   *
   * The director's register (`/attendance/daily`) links each row here, and a
   * row is a group *on a day*: landing on today's sheet after clicking a row
   * about last Tuesday would silently answer a different question, and the
   * reader would have to notice the date field to find out. Seeded rather than
   * controlled, so changing the picker afterwards does not fight the URL.
   */
  const search = useSearchParams();
  const [date, setDate] = useState(() => {
    const requested = search.get("date");
    return requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today()
      ? requested
      : today();
  });
  /*
   * ★ The span the grid draws, and `date` is its last column — 2026-09-10.
   *
   * The client's sheet opens on "огноо" with two fields and shows the month so
   * far, which is what a teacher checks before filing: not "is today done" but
   * "is anything behind me missing". `date` keeps its old meaning — the one day
   * being written — and is simply the right-hand end of that span, so `?date=`
   * from the director's register still lands on the day it names.
   */
  /*
   * ★ The week the chosen day sits in — 2026-09-10, at the client's request
   * ("тухайн 7 хоног харагдахад л болох юм байна").
   *
   * It opened on the first of the month, so by the end of September the
   * register was twenty-two columns wide and a teacher scrolled sideways past
   * three weeks they had already filed to reach today. A week is what the
   * sheet is for; the month is `Ирцийн дэлгэрэнгүй` one button below.
   */
  const [from, setFrom] = useState(() => mondayOf(date));
  /*
   * What the two fields hold, which is not yet what the grid is showing.
   * "Хайх" copies them across — see the card below for why the range is not
   * live.
   */
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(date);
  const [editing, setEditing] = useState(() => search.get("edit") === "1");
  const [draft, setDraft] = useState<Record<string, string>>({});

  /*
   * ★ The same key the other two registers use, so switching from Ирц to
   * Үнэлгээ for the same group does not refetch the list of groups.
   */
  const switchable = useSwitchableGroups();

  const sheet = useQuery({
    queryKey: qk.groupAttendance(groupId, date),
    queryFn: () => get(`/groups/${groupId}/attendance?date=${date}`, daySheetSchema),
  });
  const range = useQuery({
    queryKey: qk.groupAttendanceRange(groupId, from, date),
    queryFn: () =>
      get(
        `/groups/${groupId}/attendance/range?from=${from}&to=${date}`,
        groupAttendanceRangeSchema,
      ),
  });
  const monthFrom = `${date.slice(0, 7)}-01`;
  const monthTo = endOfMonth(date);
  const monthRange = useQuery({
    queryKey: qk.groupAttendanceRange(groupId, monthFrom, monthTo),
    queryFn: () =>
      get(
        `/groups/${groupId}/attendance/range?from=${monthFrom}&to=${monthTo}`,
        groupAttendanceRangeSchema,
      ),
  });
  const responsiveRange =
    range.data && monthRange.data ? mergeRanges(range.data, monthRange.data) : null;
  const rows = sheet.data ?? [];
  const savedComplete = rows.length > 0 && rows.every((row) => row.record);

  const draftStatus = (childId: string, saved: string | null) => draft[childId] ?? saved;
  const dirtyEntries = rows.flatMap((row) => {
    const next = draft[row.child.id];
    if (!next || next === row.record?.status) return [];
    return [{ childId: row.child.id, status: next }];
  });

  /*
   * ★ Every outcome is announced. CLAUDE.md §5: "toast after save".
   *
   * This screen mutated silently — the list refreshed and nothing said whether
   * the write had landed, which on a phone with a slow connection is
   * indistinguishable from a tap that did not register. The report was that a
   * teacher "cannot tell whether it saved"; this is that, on the screens they
   * use daily.
   *
   * `onError` matters as much as `onSuccess`: a failed write previously left
   * the row looking unchanged with no explanation at all.
   */
  const toast = useToast();

  /*
   * ★ Ticking many children and marking them in one request — 2026-09-04.
   *
   * The register was one `PUT /children/:id/attendance/:date` per tap, so a
   * teacher with twenty-four children made twenty-four writes every morning
   * and could finish with a register that was half saved and looked complete.
   * The meal register beside it has taken a whole sitting in one call since it
   * shipped; `PUT /groups/:id/attendance` is that endpoint for this screen.
   *
   * ★★ The per-child buttons stay, and are still the fast path.
   *
   * Most of the register is "everybody came except two", which is two taps on
   * the exceptions after one bulk mark — not twenty-four ticks. The rows keep
   * their own status pills for that, and for the corrections that carry a note
   * or a drop-off, which the batch endpoint deliberately cannot send.
   */

  const save = useMutation({
    mutationFn: () =>
      mutate(`/groups/${groupId}/attendance`, z.array(attendanceRecordSchema), {
        method: "PUT",
        body: {
          date,
          entries: dirtyEntries,
        },
      }),
    onSuccess: (saved) => {
      toast.success(`${saved.length} хүүхдийн ирц хадгалагдлаа.`);
      setEditing(false);
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ["group", groupId, "attendance"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /*
   * ★ Opens with everybody marked Ирсэн — the client's instruction, and the
   * register's own shape.
   *
   * A kindergarten morning is "everybody came except two". Starting from an
   * empty sheet made the common case twenty taps and the exception two, which
   * is the wrong way round; starting from present makes it two taps either
   * way. A child already marked keeps what they were marked, so re-opening a
   * saved day never quietly overwrites a recorded absence with PRESENT.
   */
  /*
   * ★ Never on a weekend.
   *
   * The grid refuses to draw a control on a Saturday, but `beginEdit` fills
   * the draft for every child on the editable day — so opening the editor on
   * a closed day would queue a register nobody could see and the save button
   * would offer to write it.
   */
  const closedDay = isWeekend(date);

  function beginEdit() {
    if (closedDay) return;
    const saved: Record<string, string> = {};
    for (const row of rows) {
      saved[row.child.id] = row.record?.status ?? "PRESENT";
    }
    setDraft(saved);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft({});
  }

  /*
   * ★ Applying a span cancels an open edit.
   *
   * A draft belongs to the day it was started on, and carrying it to another
   * date is how the wrong morning gets saved. The fields themselves no longer
   * do this on every keystroke — only pressing Хайх does.
   */
  function applyRange() {
    setFrom(draftFrom);
    setDate(draftTo);
    cancelEdit();
  }

  /*
    ★ On a phone, the last seven days — client, 2026-10-06: "утас дээр
    сүүлийн 7 хоног", e.g. «9.30 – 10.6». Monday-to-today is two columns on a
    Tuesday and nothing to compare against; a rolling week always is. Moved
    with ‹ › a week at a time, never past today. The desktop keeps its two
    date fields and its Monday start.
  */
  const isPhone = useIsPhone();
  useEffect(() => {
    if (isPhone) setFrom(addDays(date, -6));
    // Only when the phone layout is first known — not on every `date` change,
    // which the arrows below already set together with `from`.
  }, [isPhone]);

  function shiftWeek(direction: -1 | 1) {
    const latest = today();
    const end = direction === 1 ? addDays(date, 7) : addDays(date, -7);
    const to = end > latest ? latest : end;
    setFrom(addDays(to, -6));
    setDate(to);
    setDraftFrom(addDays(to, -6));
    setDraftTo(to);
    cancelEdit();
  }

  const esisPreview = useQuery({
    queryKey: qk.groupAttendanceEsis(groupId, date),
    queryFn: () =>
      get(`/groups/${groupId}/attendance/esis-preview?date=${date}`, esisAttendancePreviewSchema),
    enabled: savedComplete && !editing,
    retry: false,
  });

  const submitEsis = useMutation({
    mutationFn: () =>
      mutate(`/groups/${groupId}/attendance/submit`, attendanceSubmissionSchema, {
        method: "POST",
        body: { date },
      }),
    onSuccess: () => {
      toast.success(
        esisPreview.data?.demo
          ? "Туршилтын горим: ирц ESIS рүү бодитоор илгээгдээгүй."
          : "Ирц ESIS рүү илгээгдлээ.",
      );
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /*
   * ★ Counted from the sheet on screen, not fetched.
   *
   * The rows are already here and every tap rewrites one of them, so a second
   * request for the same month's totals would be a number that lags the buttons
   * it sits above — a teacher marking a child present and watching the count
   * not move learns to distrust both.
   */
  const recorded = rows.filter((row) =>
    draftStatus(row.child.id, row.record?.status ?? null),
  ).length;

  /*
   * ★ Six statuses, not the five in `ATTENDANCE_STATUS_ORDER`.
   *
   * That constant predates `OTHER` (CLAUDE.md §7 records the sixth status
   * being half-built: the enum, the label map and the funding register had it
   * while the two schemas stopped at five). The buttons below this already
   * render all six — they map `ATTENDANCE_STATUS_LABEL`, which has always
   * named "Бусад" — and the schema accepts it since 2026-09-02. Only this
   * summary was still counting five, so a child marked "Бусад" saved
   * correctly and then vanished from the totals: `recorded` counted them,
   * the chips underneath did not, and the two disagreed by one on screen.
   *
   * `OTHER` is appended rather than added to the shared constant because the
   * other three readers of that constant each want the five deliberately —
   * `month-panel.tsx` says so in its own comment and special-cases the sixth
   * exactly like this, and the funding register's columns are a settled
   * report format.
   *
   * ★★ No zero-guard is needed here, unlike in `month-panel.tsx`.
   * `RegisterProgress` already drops a status with a count of nought
   * (`register-progress.test.tsx`: "shows only the statuses that happened"), so
   * "Бусад" appears on the days it was used and on no others.
   */
  const breakdown = [...ATTENDANCE_STATUS_ORDER, "OTHER" as const].map((status) => ({
    key: status,
    label: ATTENDANCE_STATUS_LABEL[status] ?? status,
    count: rows.filter((row) => draftStatus(row.child.id, row.record?.status ?? null) === status)
      .length,
    tone: ATTENDANCE_STATUS_CHART_TONE[status] ?? "sky",
  }));

  return (
    <div className="page-band">
      {/*
        ★ No actions here — 2026-09-10, at the client's request.

        Засах and ESIS рүү илгээх lived in the page header, a scroll above the
        register they act on: a teacher finished the last row of the sheet and
        had to go back to the top to save it. All three controls are under the
        grid now, in the order the work happens — засах, бүртгэх, илгээх.
      */}
      {/*
        ★ Буцах on the title row, and it points at the dashboard — 2026-09-16,
        at the client's request. Every other screen a teacher reaches from the
        sidebar opens the same way (`/assessment`, `/children`, `/documents`),
        and this one opened with a bare title, so the register was the one
        top-level screen whose only exit was the sidebar.
      */}
      <PageHeader title="Ирц" backHref="/dashboard" compact />

      <GroupSwitcher
        groups={switchable.data?.items ?? []}
        activeGroupId={groupId}
        href={(id) => `/groups/${id}/attendance`}
      />

      {/*
        ★ The span is *applied*, not live — 2026-09-10, at the client's request.

        Typing into a date field fires `onChange` per keystroke, so a live
        range asked the API for "2026-09-0", "2026-09-01" and every state in
        between while a teacher was still choosing. "Хайх" makes one request
        for the span they meant, and the fields below say what is being edited
        rather than what has been typed.

        The progress ring that used to sit under these fields moved into the
        month report at the foot of the page — the client asked for the two
        graphs to be one, and they were answering the same question a scroll
        apart.
      */}
      {/*
        ★ Quiet — 2026-09-10, at the client's request that this stop drawing
        the eye.

        It is how you change *which* week you are looking at, not the work, and
        two 48px fields under their own labels announced it as the first task
        on the screen. Two small controls on one line now, labels folded into
        `aria-label`, against the register below which is what the page is for.
      */}
      {/*
        Tight on a phone — client, 2026-10-06: "зай шахаад өг". Pulled up into
        the band's gap under the title, and the grid pulled up under it, so the
        three read as one block rather than three spaced sections.
      */}
      <div className="-my-5 flex items-center justify-center gap-0.5 sm:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label="Өмнөх 7 хоног"
          onClick={() => shiftWeek(-1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <span className="min-w-[6.5rem] text-center text-body font-medium tabular-nums text-ink">
          {shortDay(from)} – {shortDay(date)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label="Дараагийн 7 хоног"
          disabled={date >= today()}
          onClick={() => shiftWeek(1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <form
        // Tight on the desktop too — 2026-10-06: 4px to the title and the grid
        // instead of the band's 24/32px.
        className="hidden items-center gap-1.5 sm:-my-5 sm:flex lg:-my-7"
        onSubmit={(event) => {
          event.preventDefault();
          applyRange();
        }}
      >
        <input
          type="date"
          aria-label="Эхлэх огноо"
          max={draftTo}
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          className="min-w-0 flex-1 rounded-control border border-border-soft bg-canvas px-2 py-1.5 text-caption text-muted focus:bg-surface focus:text-ink focus-visible:outline-2 focus-visible:outline-primary"
        />
        <span aria-hidden="true" className="shrink-0 text-caption text-faint">
          —
        </span>
        <input
          type="date"
          aria-label="Дуусах огноо"
          max={today()}
          value={draftTo}
          onChange={(e) => setDraftTo(e.target.value)}
          className="min-w-0 flex-1 rounded-control border border-border-soft bg-canvas px-2 py-1.5 text-caption text-muted focus:bg-surface focus:text-ink focus-visible:outline-2 focus-visible:outline-primary"
        />
        <Button type="submit" variant="ghost" size="icon" className="shrink-0" aria-label="Хайх">
          <Search aria-hidden />
        </Button>
      </form>

      {sheet.isLoading ? <LoadingState rows={6} shape="register" /> : null}

      {sheet.isError ? <ErrorState description={errorMessage(sheet.error)} /> : null}

      {sheet.data ? (
        <>
          {/*
            ★ No "Бүлгийн ирц" heading — 2026-09-10, at the client's request.
            The grid under it is unmistakably the register, and the headcount
            it carried is the last row of the grid's own tally.
          */}
          {sheet.data.length === 0 ? (
            <EmptyState
              title="Бүлэгт хүүхэд алга"
              description="Энэ хичээлийн жилд идэвхтэй бүртгэлтэй хүүхэд байхгүй байна."
            />
          ) : (
            <Card className="px-2 py-3 sm:px-4">
              {/*
                ★ The week the chosen date sits in, one child per row — the
                client's own sheet, 2026-09-10. It replaced a list of the
                selected day alone, which could show a teacher that today was
                filled in without showing that Tuesday never was.

                Only `date`'s column takes input; see `AttendanceWeekGrid`.
              */}
              {range.isLoading || monthRange.isLoading ? (
                <LoadingState rows={6} shape="register" />
              ) : null}
              {range.isError || monthRange.isError ? (
                <ErrorState description={errorMessage(range.error ?? monthRange.error)} />
              ) : null}
              {responsiveRange && range.data && monthRange.data ? (
                <AttendanceWeekGrid
                  data={responsiveRange}
                  mobileDays={range.data.days}
                  desktopDays={monthRange.data.days}
                  editableDay={editing ? date : null}
                  draft={draft}
                  disabled={save.isPending}
                  onSet={(childId, status) =>
                    setDraft((current) => ({ ...current, [childId]: status }))
                  }
                />
              ) : null}
            </Card>
          )}

          {/*
            ★ Who gave this account of the morning — shown once the day is
            saved, at the client's request. The register is the teacher's own
            statement and the funding claim is built on it, so "who said this
            child was here" should be readable on the sheet rather than only
            in the audit log.
          */}
          {savedComplete && !editing ? (
            <p className="px-1 text-right text-caption italic text-muted">
              Ирц авсан бүлгийн багш {fullName(session?.user)}
            </p>
          ) : null}

          {/*
            ★ All three, always — the client asked for three buttons after a
            register is taken, not two that swap.

            Засах · Ирц бүртгэх · ESIS рүү илгээх is the order the work
            happens, and each is *disabled* rather than absent when its turn
            has not come: a control that appears only once some other condition
            is met is a control a teacher never learns they have. Болих is the
            one addition, and only while there is a draft to abandon.
          */}
          {rows.length > 0 ? (
            <div className="flex items-center justify-end gap-2">
              {editing ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-w-0 shrink"
                  onClick={cancelEdit}
                  disabled={save.isPending}
                >
                  <span className="truncate">Болих</span>
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-w-0 shrink"
                  onClick={beginEdit}
                  disabled={closedDay}
                >
                  <span className="truncate">Засах</span>
                </Button>
              )}

              <Button
                size="sm"
                className="min-w-0 shrink"
                onClick={() => save.mutate()}
                disabled={save.isPending || dirtyEntries.length === 0}
              >
                <span className="truncate">
                  {save.isPending
                    ? "Бүртгэж байна…"
                    : dirtyEntries.length > 0
                      ? `Ирц бүртгэх (${dirtyEntries.length})`
                      : "Ирц бүртгэх"}
                </span>
              </Button>

              <Button
                variant="secondary"
                size="sm"
                className="min-w-0 shrink"
                onClick={() => submitEsis.mutate()}
                disabled={editing || !esisPreview.data || submitEsis.isPending}
              >
                <span className="truncate">
                  {submitEsis.isPending
                    ? "Илгээж байна…"
                    : submitEsis.data
                      ? "Дахин илгээх"
                      : "ESIS илгээх"}
                </span>
              </Button>
            </div>
          ) : null}

          <FormError message={save.isError ? errorMessage(save.error) : null} />

          {!editing && esisPreview.data ? (
            <EsisStatus
              key={date}
              preview={esisPreview.data}
              submittedAt={submitEsis.data?.date === date ? submitEsis.data.submittedAt : undefined}
            />
          ) : null}
          {!editing && esisPreview.isError ? (
            <FormError message={errorMessage(esisPreview.error)} />
          ) : null}
        </>
      ) : null}

      {/*
        ★ Three doors, one panel — the client's sheet, 2026-09-10.

        All three of these were open on the page at once: the guardians' queue,
        which is usually empty, and two ESIS field tables that between them run
        to sixty rows. A teacher scrolled past all of it every morning to reach
        nothing. They are the same three destinations, now named on buttons and
        opened one at a time.

        Toggle buttons rather than `Disclosure`'s `<details>`: the client drew
        a row of three, and a stack of three summaries is a different shape. The
        cost is find-in-page, which `Disclosure` documents caring about for the
        accountant's hundred-row register — none of these three is a list
        somebody searches by name, so the trade lands the other way here.
      */}
      <RegisterPanels
        groupId={groupId}
        month={date.slice(0, 7)}
        pendingRequests={pendingRequests}
      />

      {/*
        ★ The month, at the foot of the register rather than beside the date.

        It sat in the header card's right half, above the sheet it summarises —
        so the first thing on the screen a teacher opens to fill in today was a
        chart about days already done. The client's own layout puts it last,
        which is also the reading order: fill the day in, then see what the
        month adds up to.
      */}
      <Card pad="roomy">
        <AttendanceMonthPanel
          groupId={groupId}
          month={date.slice(0, 7)}
          date={date}
          progress={{ recorded, total: rows.length, breakdown }}
        />
      </Card>
    </div>
  );
}

/**
 * Ирцийн дэлгэрэнгүй · Чөлөөний хүсэлт.
 *
 * ★ "Esis ирц" removed 2026-09-27 at the client's request: its two ESIS field
 * tables were technical and have no place on a teacher's daily screen. The
 * ESIS step now lives beside the register as Илгээх → Шалгах (`EsisStatus`).
 *
 * ★ One open at a time, and none open to begin with.
 *
 * The default matters more than the mechanism: this screen is opened to fill
 * in a morning, and every one of these three is something looked up
 * afterwards. Opening none of them is what puts the register back at the top
 * of the page.
 *
 * `aria-expanded`/`aria-controls` rather than a `tablist`: these are three
 * disclosures that happen to share a row, not three views of one thing, and a
 * tablist would promise arrow-key navigation between panels that have nothing
 * to do with one another.
 */
function RegisterPanels({
  groupId,
  month,
  pendingRequests,
}: {
  groupId: string;
  month: string;
  pendingRequests: number;
}) {
  const [open, setOpen] = useState<"journal" | "requests" | null>(null);
  const panelId = "register-panel";

  const doors = [
    { key: "journal" as const, label: "Ирцийн дэлгэрэнгүй", count: 0, icon: CalendarRange },
    {
      key: "requests" as const,
      label: "Чөлөөний хүсэлт",
      count: pendingRequests,
      icon: MailQuestion,
    },
  ];

  return (
    <section aria-labelledby="register-panels-heading" className="flex flex-col gap-4">
      <h2 id="register-panels-heading" className="sr-only">
        Ирцийн нэмэлт хэсгүүд
      </h2>

      {/*
        ★ The product's own `Button`, not a hand-rolled pill — 2026-09-10, at
        the client's request that these match everything else. The row had its
        own border, radius and hover written inline, which is how a screen ends
        up with two button languages a few pixels apart.

        ★★ One row at every width, with every word — 2026-09-10.

        They wrapped to a second line for a while, which the client did not
        want either. What makes three full labels fit a 390px row is dropping
        the icons below `sm` and stepping the type down to `text-compact`:
        "Ирцийн дэлгэрэнгүй · Чөлөөний хүсэлт · Esis ирц" is 41 characters, and
        at 11px with 6px of padding each that is about 360px. The icons return
        at `sm`, where there is room for both.

        The open one is `primary` and the rest are `secondary`: that is the
        same pair the register's own controls use above, so "this is the one
        you are looking at" reads the same way twice on one page.
      */}
      <div className="flex gap-1.5 sm:gap-2.5">
        {doors.map((door) => {
          const active = open === door.key;
          const Icon = door.icon;
          return (
            <Button
              key={door.key}
              variant={active ? "primary" : "secondary"}
              size="sm"
              className="min-w-0 flex-1 px-1.5 text-compact sm:flex-none sm:px-4 sm:text-body"
              aria-expanded={active}
              aria-controls={panelId}
              onClick={() => setOpen(active ? null : door.key)}
            >
              <Icon aria-hidden className="hidden sm:block" />
              {door.label}
              {door.count > 0 ? (
                <span
                  className={cn(
                    "grid min-w-4 shrink-0 place-items-center rounded-pill px-1 text-compact font-bold sm:min-w-6 sm:px-1.5 sm:text-caption",
                    active ? "bg-white/25 text-primary-ink" : "bg-danger text-white",
                  )}
                >
                  {door.count}
                  <span className="sr-only">хүлээгдэж буй</span>
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>

      <div id={panelId} hidden={open === null}>
        {open === "journal" ? <TeacherJournal groupId={groupId} initialMonth={month} /> : null}
        {open === "requests" ? <AttendanceRequestQueue heading="Эцэг эхийн мэдэгдэл" /> : null}
      </div>
    </section>
  );
}

/**
 * ESIS, in the teacher's words — client, 2026-09-27: "Илгээх → Шалгах →
 * Баталгаажсан / Зөрүүтэй", and no technical code, API name or person number
 * on screen.
 *
 * Шалгах reads the day back from ESIS (`groupAttendance`, the same read the
 * "ESIS-ээс татах" buttons use) and compares it with what was sent, child by
 * child: the same children, each with the same reason. Only the verdict and
 * how many differ are shown.
 *
 * ★ A MOCK read is never called Баталгаажсан or Зөрүүтэй. The demo fixture is
 * a fixed sample, not the day that was sent, so comparing against it would
 * invent a verdict either way.
 */
function EsisStatus({
  preview,
  submittedAt,
}: {
  preview: EsisAttendancePreview;
  submittedAt?: string;
}) {
  const { primaryKindergartenId } = useSession();
  const toast = useToast();
  const request = preview.requests[0];

  const check = useMutation({
    mutationFn: () => {
      const payload = request!.payload;
      const params = new URLSearchParams({
        resource: "groupAttendance",
        studentGroupId: String(payload.studentGroupId),
        dayDate: payload.dayDate,
      });
      return get(
        `/kindergartens/${primaryKindergartenId}/esis/resource?${params.toString()}`,
        esisResourceReadSchema,
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!request) return null;

  const sent = Boolean(submittedAt);
  const read = check.data;
  // ESIS has no demo mode any more (2026-09-14), so every read is a live one.
  const mismatches = read ? countMismatches(request.payload.attendanceList, read.rows) : 0;
  const verdict = !read ? null : mismatches === 0 ? "ok" : "diff";

  const steps = [
    { label: "Илгээх", done: sent },
    { label: "Шалгах", done: Boolean(read) },
    {
      label:
        verdict === "diff"
          ? "Зөрүүтэй"
          : verdict === "ok"
            ? "Баталгаажсан"
            : "Баталгаажсан / Зөрүүтэй",
      done: verdict !== null,
    },
  ];

  return (
    <section aria-label="ESIS төлөв">
      <Card pad="roomy" className="flex flex-col gap-3">
        <ol className="flex flex-wrap items-center gap-1.5 text-caption">
          {steps.map((step, index) => (
            <li key={index} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "rounded-pill px-2.5 py-1 font-semibold",
                  step.done
                    ? index === 2 && verdict === "diff"
                      ? "bg-danger-soft text-danger"
                      : "bg-mint text-mint-ink"
                    : "bg-sunken text-muted",
                )}
              >
                {step.label}
              </span>
              {index < steps.length - 1 ? (
                <ChevronRight size={14} aria-hidden className="text-faint" />
              ) : null}
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body text-ink" role="status">
            {verdict === "ok" ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-mint-ink">
                <CheckCircle2 size={16} aria-hidden /> Баталгаажсан — ESIS дээр зөв хадгалагдсан.
              </span>
            ) : verdict === "diff" ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
                <AlertTriangle size={16} aria-hidden /> Зөрүүтэй — {mismatches} хүүхдийн ирц ESIS
                дээр өөр байна.
              </span>
            ) : sent ? (
              <span className="text-muted">
                Илгээсэн {submittedAt!.slice(11, 16)}. ESIS дээр зөв хадгалагдсан эсэхийг шалгана
                уу.
              </span>
            ) : (
              <span className="text-muted">Ирц ESIS рүү илгээгдээгүй байна.</span>
            )}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => check.mutate()}
            disabled={!sent || check.isPending || !primaryKindergartenId}
          >
            {check.isPending ? "Шалгаж байна…" : read ? "Дахин шалгах" : "ESIS-ээс шалгах"}
          </Button>
        </div>
      </Card>
    </section>
  );
}

/** Children missing on either side, or read back with a different reason. */
function countMismatches(
  sent: EsisAttendancePreview["requests"][number]["payload"]["attendanceList"],
  rows: Record<string, string | null>[],
): number {
  const stored = new Map<string, string | null>();
  for (const row of rows) {
    if (row.personId) stored.set(row.personId, row.attendanceReasonCode ?? null);
  }
  let differ = 0;
  for (const item of sent) {
    const key = String(item.personId);
    if (stored.get(key) !== item.attendReasonCode) differ += 1;
    stored.delete(key);
  }
  return differ + stored.size;
}
