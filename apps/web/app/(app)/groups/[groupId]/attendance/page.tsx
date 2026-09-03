"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { attendanceRecordSchema, groupAttendanceRowSchema, groupSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { GroupSwitcher, useSwitchableGroups } from "@/components/shell/group-switcher";
import { qk } from "@/lib/api/keys";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
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
 * ★ Each tap saves immediately, unlike the assessment column's batch save.
 * Attendance is a fact about right now, usually corrected in the moment
 * ("no, she just arrived") — a pending-changes bar would ask a teacher to
 * remember to press a second button for something that already happened.
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
  const [date, setDate] = useState(today());

  /*
   * ★ The same key the other two registers use, so switching from Ирц to
   * Үнэлгээ for the same group does not refetch the list of groups.
   */
  const switchable = useSwitchableGroups();

  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupSchema),
  });

  const sheet = useQuery({
    queryKey: qk.groupAttendance(groupId, date),
    queryFn: () => get(`/groups/${groupId}/attendance?date=${date}`, daySheetSchema),
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

  const record = useMutation({
    mutationFn: ({ childId, status }: { childId: string; status: string }) =>
      mutate(`/children/${childId}/attendance/${date}`, attendanceRecordSchema, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      toast.success("Ирц бүртгэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: qk.groupAttendance(groupId, date) });
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
  const rows = sheet.data ?? [];
  const recorded = rows.filter((row) => row.record).length;

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
    count: rows.filter((row) => row.record?.status === status).length,
    tone: ATTENDANCE_STATUS_CHART_TONE[status] ?? "sky",
  }));

  return (
    <div className="page-band">
      <PageHeader title="Ирц" lede={group.data?.name} />

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
                onChange={(e) => setDate(e.target.value)}
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

      <FormError message={record.isError ? errorMessage(record.error) : null} />

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
            <Card className="divide-y divide-border">
              {sheet.data.map((row) => (
                <ChildRow
                  key={row.enrollmentId}
                  child={row.child}
                  status={row.record?.status ?? null}
                  pending={record.isPending && record.variables?.childId === row.child.id}
                  onSelect={(status) => record.mutate({ childId: row.child.id, status })}
                />
              ))}
            </Card>
          )}
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
    </div>
  );
}

function ChildRow({
  child,
  status,
  pending,
  onSelect,
}: {
  child: { id: string; lastName: string; firstName: string };
  status: string | null;
  pending: boolean;
  onSelect: (status: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-sunken sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ChildAvatar child={child} size={40} />
        <span className="min-w-0 truncate text-lead font-semibold text-ink">{fullName(child)}</span>
      </div>

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
    </div>
  );
}
