"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { attendanceRecordSchema, groupAttendanceRowSchema, groupSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const daySheetSchema = z.array(groupAttendanceRowSchema);

const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Ирсэн",
  HALF_DAY: "Хагас өдөр",
  EXCUSED: "Чөлөөтэй",
  SICK: "Өвчтэй",
  ABSENT: "Тасалсан",
};

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

  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupSchema),
  });

  const sheet = useQuery({
    queryKey: qk.groupAttendance(groupId, date),
    queryFn: () => get(`/groups/${groupId}/attendance?date=${date}`, daySheetSchema),
  });

  const record = useMutation({
    mutationFn: ({ childId, status }: { childId: string; status: string }) =>
      mutate(`/children/${childId}/attendance/${date}`, attendanceRecordSchema, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.groupAttendance(groupId, date) });
    },
  });

  return (
    <div className="flex flex-col gap-5 py-2">
      <header>
        <h1 className="text-heading font-semibold text-ink">Ирц</h1>
        <p className="mt-0.5 text-body text-muted">{group.data?.name}</p>
      </header>

      <Card className="px-4 py-4 sm:px-5">
        <Field label="Огноо">
          {({ id }) => (
            <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
      </Card>

      <FormError message={record.isError ? errorMessage(record.error) : null} />

      {sheet.isLoading ? <LoadingState rows={5} /> : null}

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
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ChildAvatar child={child} size={40} />
        <span className="min-w-0 truncate font-medium text-ink">{fullName(child)}</span>
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
                "min-h-11 rounded-control border px-3 text-body font-medium transition-colors disabled:opacity-60",
                selected
                  ? "border-primary bg-primary text-primary-ink"
                  : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
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
