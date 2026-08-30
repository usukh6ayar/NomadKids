"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { z } from "zod";
import { attendanceRequestSchema, paginated, personRefSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import {
  attendanceCompanionDisplay as companionDisplay,
  ATTENDANCE_STATUS_LABEL as STATUS_LABEL,
} from "@/lib/attendance-meta";
import { formatDate, fullName } from "@/lib/format";

const queueItemSchema = attendanceRequestSchema.extend({ child: personRefSchema.nullish() });
const queueSchema = paginated(queueItemSchema);

/** `HH:MM`, in the viewer's own timezone — same reasoning as
 * `child-attendance.tsx`'s own `toLocalTime`, not exported from there since
 * that file is `"use client"` component code, not a shared utility module. */
function toLocalTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
 * ★★ `/attendance-requests/review` still renders this, unchanged.
 *
 * The route is what a notification links to and what a bookmark points at.
 * Deleting it to make a menu shorter would break both.
 */
export function AttendanceRequestQueue({ heading }: { heading?: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.attendanceReviewQueue(),
    queryFn: () => get("/attendance-requests/review-queue?page=1&pageSize=25", queueSchema),
  });

  const pending = data?.total ?? 0;

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

      {data && data.items.length === 0 ? (
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

      <div className="flex flex-col gap-3">
        {(data?.items ?? []).map((request) => (
          <RequestCard key={request.id} request={request} />
        ))}
      </div>
    </section>
  );
}

function RequestCard({ request }: { request: z.infer<typeof queueItemSchema> }) {
  const queryClient = useQueryClient();

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

  const review = useMutation({
    mutationFn: (decision: "APPROVED" | "REJECTED") =>
      mutate(`/attendance-requests/${request.id}/review`, attendanceRequestSchema, {
        method: "POST",
        body: { decision },
      }),
    onSuccess: (_data, decision) => {
      toast.success(decision === "APPROVED" ? "Хүсэлт зөвшөөрөгдлөө." : "Хүсэлт татгалзагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.attendanceReviewQueue() });
      if (request.child) {
        void queryClient.invalidateQueries({ queryKey: qk.child(request.child.id) });
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card pad="roomy" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {request.child ? (
            <Link
              href={`/children/${request.child.id}/attendance`}
              className="inline-flex min-h-[44px] items-center font-medium text-ink underline-offset-4 hover:underline"
            >
              {fullName(request.child)}
            </Link>
          ) : (
            <span className="font-medium text-ink">—</span>
          )}
          <p className="text-body text-muted">
            {formatDate(request.dateFrom)}
            {request.dateFrom !== request.dateTo ? ` – ${formatDate(request.dateTo)}` : ""} ·{" "}
            {request.pickedUpWith && !request.arrivedWith
              ? "Явсан"
              : STATUS_LABEL[request.requestedStatus]}
            {request.arrivedWith
              ? ` · ${companionDisplay(request.arrivedWith, request.arrivedWithName)}${
                  request.arrivedAt ? `, ${toLocalTime(request.arrivedAt)}` : ""
                }`
              : ""}
            {request.pickedUpWith
              ? ` · ${companionDisplay(request.pickedUpWith, request.pickedUpWithName)}${
                  request.pickedUpAt ? `, ${toLocalTime(request.pickedUpAt)}` : ""
                }`
              : ""}
          </p>
        </div>
        <Badge tone="sun">Хүлээгдэж буй</Badge>
      </div>

      {request.reason ? (
        <p className="whitespace-pre-wrap rounded-control bg-canvas px-3.5 py-3 text-body text-ink">
          {request.reason}
        </p>
      ) : null}

      <FormError message={review.isError ? errorMessage(review.error) : null} />

      <div className="flex flex-wrap gap-2">
        <Button disabled={review.isPending} onClick={() => review.mutate("APPROVED")}>
          <Check size={18} />
          {review.isPending ? "Хадгалж байна…" : "Зөвшөөрөх"}
        </Button>
        <Button
          variant="secondary"
          disabled={review.isPending}
          onClick={() => review.mutate("REJECTED")}
        >
          <X size={18} />
          Татгалзах
        </Button>
      </div>
    </Card>
  );
}
