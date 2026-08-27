"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { z } from "zod";
import { attendanceRequestSchema, paginated, personRefSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

/** Process guardians' advance notices. Approving writes the Attendance rows. */
export default function AttendanceRequestReviewPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <ReviewQueue />
    </RequireRole>
  );
}

function ReviewQueue() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.attendanceReviewQueue(),
    queryFn: () => get("/attendance-requests/review-queue?page=1&pageSize=25", queueSchema),
  });

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Ирцийн мэдэгдэл — хянах"
        lede="Эцэг эхийн ирцийн мэдэгдэл, чөлөөний хүсэлтийг хянаж, ирцэд бүртгэнэ."
        actions={
          data ? (
            <p className="text-body text-muted" aria-live="polite">
              {data.total} хүлээгдэж буй
            </p>
          ) : null
        }
      />

      {isLoading ? <LoadingState rows={3} /> : null}

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
        <EmptyState
          title="Хянах зүйл алга"
          description="Эцэг эхээс ирц мэдэгдэл, чөлөөний хүсэлт ирвэл энд харагдана."
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {(data?.items ?? []).map((request) => (
          <RequestCard key={request.id} request={request} />
        ))}
      </div>
    </div>
  );
}

function RequestCard({ request }: { request: z.infer<typeof queueItemSchema> }) {
  const queryClient = useQueryClient();

  const review = useMutation({
    mutationFn: (decision: "APPROVED" | "REJECTED") =>
      mutate(`/attendance-requests/${request.id}/review`, attendanceRequestSchema, {
        method: "POST",
        body: { decision },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.attendanceReviewQueue() });
      if (request.child) {
        void queryClient.invalidateQueries({ queryKey: qk.child(request.child.id) });
      }
    },
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
