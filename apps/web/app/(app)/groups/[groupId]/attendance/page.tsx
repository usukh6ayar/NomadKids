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
import { ChildAvatar } from "@/components/media/media-image";
import { SelectBox, SelectionBar, useSelection } from "@/components/ui/selection";
import { RegisterProgress } from "@/components/register/register-progress";
import { AttendanceRequestQueue } from "@/components/attendance/request-queue";
import { AttendanceMonthPanel } from "@/components/attendance/month-panel";
import { TONE_SURFACE } from "@/components/ui/tone";
import {
  ATTENDANCE_STATUS_CHART_TONE,
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_ORDER,
} from "@/lib/attendance-meta";
import { fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const daySheetSchema = z.array(groupAttendanceRowSchema);

/*
 * ★ The five statuses come from `lib/attendance-meta.ts`, not from a copy here.
 *
 * This file kept its own map, which is how the day sheet came to be the one
 * screen where the summary strip above the list could disagree with the buttons
 * inside it. The order is fixed there too — best to worst, never sorted by
 * count — and the tones are the product's own status palette, so a red count in
 * this strip is the same red as the calendar on the child's page.
 */
const STATUS_LABEL = ATTENDANCE_STATUS_LABEL;

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
  // Nothing to select when nothing can be written — the bulk bar's only
  // controls are the six status buttons.
  const selection = useSelection(editing ? rows.map((row) => row.child.id) : []);

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
      selection.clear();
      void queryClient.invalidateQueries({ queryKey: ["group", groupId, "attendance"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function beginEdit() {
    const saved: Record<string, string> = {};
    for (const row of rows) {
      if (row.record) saved[row.child.id] = row.record.status;
    }
    setDraft(saved);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft({});
    selection.clear();
  }

  function setSelectedStatus(status: string) {
    setDraft((current) => ({
      ...current,
      ...Object.fromEntries(selection.ids.map((childId) => [childId, status])),
    }));
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
                  {save.isPending ? "Хадгалж байна…" : `Хадгалах (${dirtyEntries.length})`}
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
      <Card className="grid gap-5 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col gap-3.5">
          <Field label="Огноо">
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

          {sheet.data && rows.length > 0 ? (
            <RegisterProgress inset recorded={recorded} total={rows.length} breakdown={breakdown} />
          ) : null}
        </div>

        {/*
          The month the chosen date falls in, so moving the date picker to
          July shows July's shape rather than always this month's.
        */}
        <AttendanceMonthPanel groupId={groupId} month={date.slice(0, 7)} />
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
            action={
              <span className="flex items-center gap-2">
                <span className="text-body text-muted">{sheet.data.length} хүүхэд</span>
                {sheet.data.length > 0 && editing ? (
                  <SelectBox
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    onChange={selection.toggleAll}
                    label="Бүх хүүхдийг сонгох"
                  />
                ) : null}
              </span>
            }
          />

          {sheet.data.length === 0 ? (
            <EmptyState
              title="Бүлэгт хүүхэд алга"
              description="Энэ хичээлийн жилд идэвхтэй бүртгэлтэй хүүхэд байхгүй байна."
            />
          ) : (
            <Card className="divide-y divide-border">
              {sheet.data.map((row) => (
                <ChildRow
                  key={row.enrollmentId}
                  child={row.child}
                  status={draftStatus(row.child.id, row.record?.status ?? null)}
                  readOnly={!editing}
                  pending={save.isPending}
                  onSelect={(status) =>
                    setDraft((current) => ({ ...current, [row.child.id]: status }))
                  }
                  checked={selection.has(row.child.id)}
                  onToggle={() => selection.toggle(row.child.id)}
                />
              ))}
            </Card>
          )}

          {/*
            ★ The same six statuses as the rows, in the same order and the same
            tints, because they mean the same thing.

            A second, shorter set here — "Ирсэн" and nothing else — would be the
            common case at the cost of making the register's other half (a
            correction pass: three sick, one excused) go back to one tap per
            child. `ATTENDANCE_STATUS_LABEL` is the one source both read.
          */}
          <SelectionBar count={editing ? selection.count : 0} onClear={selection.clear}>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={save.isPending}
                onClick={() => setSelectedStatus(value)}
                className={cn(
                  "min-h-11 rounded-control border border-transparent px-3 text-body font-semibold transition-all duration-150 active:translate-y-[1px] disabled:opacity-60",
                  TONE_SURFACE[ATTENDANCE_STATUS_CHART_TONE[value] ?? "sky"],
                )}
              >
                {label}
              </button>
            ))}
          </SelectionBar>

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
        ★ The guardians' notices, under the sheet they are about.

        Approving one writes the `Attendance` rows for those days, so it is the
        same register seen from the other end. It had a sidebar entry of its
        own, which asked a teacher to know that the absence they were about to
        mark by hand might already have been explained on a different screen.
      */}
      <AttendanceRequestQueue heading="Эцэг эхийн мэдэгдэл" />

      {/*
        ★ The two ESIS attendance services, on the sheet they are about —
        2026-09-09, at the client's request ("ирц хадгалах", "ирц харах").

        They are the two halves of one exchange and belong together: the fields
        this screen *sends* when a confirmed day goes up, and the record that
        comes back when it is read again. Reading them apart is how a teacher
        ends up believing a day was filed because the button said so.

        ★★ `saveAttendanceV3` is the catalog's only write service, so its panel
        shows the request payload rather than a response — the eight fields
        `API-000269` takes. Nothing here submits: the submit is
        `GroupEsisPayload` above, which is this screen's own control and writes
        an `AttendanceSubmission` when it succeeds.

        ★★★ Both are keyed by ESIS's `studentGroupId`, which the panel asks
        for: our group ids are uuids the ministry has never seen, and §15's
        external-id history is what would let this be filled in automatically.
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

function ChildRow({
  child,
  status,
  readOnly,
  pending,
  onSelect,
  checked,
  onToggle,
}: {
  child: { id: string; lastName: string; firstName: string };
  status: string | null;
  /** Saved view until the user explicitly enters edit mode. */
  readOnly: boolean;
  pending: boolean;
  onSelect: (status: string) => void;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-sunken sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/*
          Leading the row, before the avatar: a column of boxes down the left
          edge is scannable as a column, and one tucked between the face and
          the name is not.
        */}
        {readOnly ? null : (
          <SelectBox checked={checked} onChange={onToggle} label={`${fullName(child)} — сонгох`} />
        )}
        <ChildAvatar child={child} size={40} />
        <span className="min-w-0 truncate text-lead font-semibold text-ink">{fullName(child)}</span>
      </div>

      {/*
        ★ One tinted chip instead of six buttons, when this is being read.

        Not six disabled buttons: a greyed-out row of controls still says "you
        may press these, but not now", and there is no "now" in which a
        director may. The chip carries the same tone the selected button would
        have, so the sheet scans identically — the exceptions stand out in the
        same colours — and it simply has nothing to press.
      */}
      {readOnly ? (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {status ? (
            <span
              className={cn(
                "inline-flex min-h-9 items-center rounded-control px-3 text-body font-semibold",
                TONE_SURFACE[ATTENDANCE_STATUS_CHART_TONE[status] ?? "sky"],
              )}
            >
              {STATUS_LABEL[status] ?? status}
            </span>
          ) : (
            <span className="inline-flex min-h-9 items-center rounded-control border border-dashed border-border px-3 text-body text-faint">
              Бүртгээгүй
            </span>
          )}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={`${fullName(child)} — ирц`}
          className="flex flex-wrap gap-2"
        >
          {Object.entries(STATUS_LABEL).map(([value, label]) => {
            const selected = value === status;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={pending}
                onClick={() => onSelect(value)}
                className={cn(
                  /*
                  ★ REDESIGN 2026-09-03 — the chosen status is coloured for what
                  it *means*, not filled with the brand blue.

                  Every selected pill was `bg-primary`, so a register of thirty
                  children read as thirty identical blue buttons and the one
                  fact a teacher scans this sheet for — who is missing — could
                  only be got by reading each label. The tint ramp is what the
                  design direction asks for ("Ирсэн filled mint, Өвчтэй filled
                  peach") and it makes the exceptions findable at a glance.

                  `ATTENDANCE_STATUS_CHART_TONE` is reused rather than a second
                  map: the same status must not be mint on the register and
                  peach on the month panel beside it. `TONE_SURFACE` pairs each
                  tint with an ink measured at 4.5:1 or better
                  (`ui-foundation.test.tsx`), which a hand-picked pastel would
                  not be.

                  Colour is not the only signal — `aria-checked` carries the
                  state, and the selected pill also takes a heavier weight and
                  a matching border.
                */
                  "min-h-11 rounded-control border px-3 text-body font-medium transition-all duration-150 active:translate-y-[1px] disabled:opacity-60",
                  selected
                    ? cn(
                        TONE_SURFACE[ATTENDANCE_STATUS_CHART_TONE[value] ?? "sky"],
                        "border-transparent font-semibold shadow-sm",
                      )
                    : "border-border bg-surface text-muted hover:border-faint hover:bg-canvas hover:text-ink",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
