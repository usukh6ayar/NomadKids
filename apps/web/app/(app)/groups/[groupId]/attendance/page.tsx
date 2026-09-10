"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Pencil, Save, Send, X } from "lucide-react";
import { z } from "zod";
import {
  attendanceRecordSchema,
  attendanceSubmissionSchema,
  esisAttendancePreviewSchema,
  groupAttendanceRangeSchema,
  groupAttendanceRowSchema,
  type EsisAttendancePreview,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { GroupSwitcher, useSwitchableGroups } from "@/components/shell/group-switcher";
import { qk } from "@/lib/api/keys";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Card, SectionHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableShell, Td, Th } from "@/components/ui/table";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { RegisterProgress } from "@/components/register/register-progress";
import {
  AttendanceRequestQueue,
  useAttendanceRequestCount,
} from "@/components/attendance/request-queue";
import { TeacherJournal } from "@/components/attendance/teacher-journal";
import { AttendanceMonthPanel } from "@/components/attendance/month-panel";
import { AttendanceWeekGrid } from "@/components/attendance/week-grid";
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
  return new Date().toISOString().slice(0, 10);
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
  const [from, setFrom] = useState(() => `${date.slice(0, 7)}-01`);
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
  function beginEdit() {
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
          ? "Mock client ирцийг хүлээн авлаа (DEMO_SUCCESS). Production ESIS рүү илгээгээгүй."
          : "Ирц ESIS рүү амжилттай илгээгдлээ.",
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
      <PageHeader
        title="Ирц"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={cancelEdit}
                  disabled={save.isPending}
                >
                  <X aria-hidden /> Болих
                </Button>
                <Button
                  size="sm"
                  onClick={() => save.mutate()}
                  disabled={save.isPending || dirtyEntries.length === 0}
                >
                  <Save aria-hidden />
                  {save.isPending ? "Бүртгэж байна…" : `Ирц бүртгэх (${dirtyEntries.length})`}
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={beginEdit}
                disabled={rows.length === 0}
              >
                <Pencil aria-hidden /> Засах
              </Button>
            )}
            {!editing ? (
              <Button
                size="sm"
                onClick={() => submitEsis.mutate()}
                disabled={!esisPreview.data || submitEsis.isPending}
              >
                <Send aria-hidden />
                {submitEsis.isPending
                  ? "Илгээж байна…"
                  : submitEsis.data
                    ? "Дахин илгээх"
                    : "ESIS рүү илгээх"}
              </Button>
            ) : null}
          </div>
        }
      />

      <GroupSwitcher
        groups={switchable.data?.items ?? []}
        activeGroupId={groupId}
        href={(id) => `/groups/${id}/attendance`}
      />

      {/*
        ★ Two columns from `lg`: today on the left, the month on the right.

        The card was a date field and a progress ring in its left third with
        about 900px of white beside them — on the screen a teacher opens every
        morning. The split is the honest one: the left half is the work in
        front of you, the right half is what that work has added up to. They
        stack on a phone, work first, because a register is filled in one
        thumb at a time and the month can wait for a scroll.
      */}
      {/*
        ★ One column again. The right half held `AttendanceMonthPanel`, which
        moved to the foot of the page — a chart about finished days was the
        first thing on the screen a teacher opens to fill today in.
      */}
      <Card className="px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3.5">
          {/*
            ★ A span, not one date — the client's sheet, 2026-09-10.

            The right-hand field is still the day being written; the left one
            only widens what the grid shows behind it. Both cancel an open
            edit, because a draft belongs to the day it was started on and
            carrying it to another date is how the wrong morning gets saved.
          */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Эхлэх огноо">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  max={date}
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    cancelEdit();
                  }}
                />
              )}
            </Field>
            <Field label="Дуусах огноо">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  max={today()}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    cancelEdit();
                  }}
                />
              )}
            </Field>
          </div>

          {sheet.data && rows.length > 0 ? (
            <RegisterProgress inset recorded={recorded} total={rows.length} breakdown={breakdown} />
          ) : null}
        </div>
      </Card>

      <FormError message={save.isError ? errorMessage(save.error) : null} />

      {!editing && rows.length > 0 && !savedComplete ? (
        <Card pad="compact" tone="sun">
          <p className="text-body font-medium text-ink">
            {rows.filter((row) => !row.record).length} хүүхдийн ирц хадгалагдаагүй байна. Засаж
            дууссаны дараа ESIS илгээх утга бэлтгэгдэнэ.
          </p>
        </Card>
      ) : null}

      {sheet.isLoading ? <LoadingState rows={6} shape="register" /> : null}

      {sheet.isError ? <ErrorState description={errorMessage(sheet.error)} /> : null}

      {sheet.data ? (
        <>
          <SectionHeader
            title="Бүлгийн ирц"
            action={<span className="text-body text-muted">{sheet.data.length} хүүхэд</span>}
          />

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
              {range.isLoading ? <LoadingState rows={6} shape="register" /> : null}
              {range.isError ? <ErrorState description={errorMessage(range.error)} /> : null}
              {range.data ? (
                <AttendanceWeekGrid
                  data={range.data}
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

          {!editing && esisPreview.data ? (
            <GroupEsisPayload
              preview={esisPreview.data}
              submittedAt={submitEsis.data?.submittedAt}
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
        <AttendanceMonthPanel groupId={groupId} month={date.slice(0, 7)} />
      </Card>
    </div>
  );
}

/**
 * Ирцийн дэлгэрэнгүй · Чөлөөний хүсэлт · Esis ирц.
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
  const [open, setOpen] = useState<"journal" | "requests" | "esis" | null>(null);
  const panelId = "register-panel";

  const doors = [
    { key: "journal" as const, label: "Ирцийн дэлгэрэнгүй", count: 0 },
    { key: "requests" as const, label: "Чөлөөний хүсэлт", count: pendingRequests },
    { key: "esis" as const, label: "Esis ирц", count: 0 },
  ];

  return (
    <section aria-labelledby="register-panels-heading" className="flex flex-col gap-4">
      <h2 id="register-panels-heading" className="sr-only">
        Ирцийн нэмэлт хэсгүүд
      </h2>

      <div className="flex flex-wrap gap-2.5">
        {doors.map((door) => {
          const active = open === door.key;
          return (
            <button
              key={door.key}
              type="button"
              aria-expanded={active}
              aria-controls={panelId}
              onClick={() => setOpen(active ? null : door.key)}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-pill border px-5 text-body font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-ink"
                  : "border-border bg-surface text-ink hover:bg-canvas",
              )}
            >
              {door.label}
              {door.count > 0 ? (
                <span
                  className={cn(
                    "grid min-w-6 place-items-center rounded-pill px-1.5 text-caption font-bold",
                    active ? "bg-primary-ink/20 text-primary-ink" : "bg-danger text-white",
                  )}
                >
                  {door.count}
                  <span className="sr-only">хүлээгдэж буй</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div id={panelId} hidden={open === null}>
        {open === "journal" ? <TeacherJournal groupId={groupId} initialMonth={month} /> : null}
        {open === "requests" ? <AttendanceRequestQueue heading="Эцэг эхийн мэдэгдэл" /> : null}
        {open === "esis" ? (
          <div className="flex flex-col gap-4">
            {/*
              The two halves of one exchange: the fields this screen sends when
              a confirmed day goes up, and the record that comes back when it is
              read again. Reading them apart is how a teacher ends up believing
              a day was filed because the button said so.

              Both are keyed by ESIS's `studentGroupId`, which the panel asks
              for — our group ids are uuids the ministry has never seen, and
              §15's external-id history is what would fill this in.
            */}
            <EsisDataPanel
              resource="saveAttendanceV3"
              title="Ирц хадгалах"
              description="Баталгаажсан өдрийн ирцээр ESIS рүү илгээх талбарууд"
            />
            <EsisDataPanel
              resource="groupAttendance"
              title="Ирц харах"
              description="Илгээсэн ирцийг ESIS-ээс буцааж уншсан нь"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function GroupEsisPayload({
  preview,
  submittedAt,
}: {
  preview: EsisAttendancePreview;
  submittedAt?: string;
}) {
  const request = preview.requests[0];
  if (!request) return null;

  return (
    <section aria-labelledby="group-esis-payload-heading">
      <SectionHeader
        id="group-esis-payload-heading"
        title="ESIS рүү илгээх утга"
        lede={`API-000269 · ID ${preview.apiId} · POST ${preview.endpoint}`}
        action={
          <Badge tone={preview.demo ? "sun" : "mint"}>
            {!preview.demo ? <CheckCircle2 size={13} aria-hidden /> : null}
            {submittedAt
              ? preview.demo
                ? `DEMO_SUCCESS ${submittedAt.slice(11, 16)}`
                : `Илгээсэн ${submittedAt.slice(11, 16)}`
              : preview.demo
                ? "MOCK · production руу илгээхгүй"
                : "ESIS бэлэн"}
          </Badge>
        }
      />
      <Card pad="roomy" className="flex flex-col gap-4">
        <dl className="grid gap-3 sm:grid-cols-4">
          <PayloadField label="institutionId" value={request.payload.institutionId} />
          <PayloadField label="studentGroupId" value={request.payload.studentGroupId} />
          <PayloadField label="dayDate" value={request.payload.dayDate} />
          <PayloadField
            label="attendanceList"
            value={`${request.payload.attendanceList.length} мөр`}
          />
        </dl>
        <TableShell caption="API-000269 attendanceList" minWidth="min-w-[680px]">
          <thead>
            <tr>
              <Th>personId</Th>
              <Th>attendReasonCode</Th>
              <Th numeric>tardyMinutes</Th>
              <Th>attendReasonList</Th>
            </tr>
          </thead>
          <tbody>
            {request.payload.attendanceList.map((item) => (
              <tr key={item.personId}>
                <Td className="font-mono text-caption">{item.personId}</Td>
                <Td>{item.attendReasonCode}</Td>
                <Td numeric>{item.tardyMinutes}</Td>
                <Td className="font-mono text-caption">[]</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>

        <section className="border-t border-border-soft pt-4" aria-label="ESIS ирцийн гаралт">
          <h3 className="text-body font-semibold text-primary">
            ESIS-ээс буцааж шалгах гаралтын утга
          </h3>
          <p className="mt-2 font-mono text-caption text-muted">
            api-22 · GET /svc/api/hub/v2/group/list/attendance/
            {request.payload.studentGroupId}/{request.payload.dayDate}
          </p>
          <TableShell className="mt-3" caption="ESIS attendance output" minWidth="min-w-[820px]">
            <thead>
              <tr>
                <Th>academicLevel</Th>
                <Th>personId</Th>
                <Th>dayDate</Th>
                <Th>attendanceReasonCode</Th>
                <Th>attendanceReasonName</Th>
                <Th numeric>tardyMinutes</Th>
              </tr>
            </thead>
            <tbody>
              {request.payload.attendanceList.map((item) => (
                <tr key={item.personId}>
                  <Td>2</Td>
                  <Td className="font-mono text-caption">{item.personId}</Td>
                  <Td>{request.payload.dayDate}</Td>
                  <Td>{item.attendReasonCode}</Td>
                  <Td>{reasonName(item.attendReasonCode)}</Td>
                  <Td numeric>{item.tardyMinutes}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </section>
      </Card>
    </section>
  );
}

function reasonName(code: string): string {
  if (code === "PRESENT") return "Ирсэн";
  if (code === "EXCUSED") return "Чөлөөтэй";
  if (code === "SICK") return "Өвчтэй";
  return "Тасалсан";
}

function PayloadField({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="font-mono text-caption text-muted">{label}</dt>
      <dd className="mt-1 text-body font-semibold text-ink">{value}</dd>
    </div>
  );
}
