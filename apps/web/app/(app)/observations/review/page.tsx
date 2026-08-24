"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { Check, Undo2 } from "lucide-react";
import { observationSchema, paginated, personRefSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { formatDate, fullName } from "@/lib/format";

// The queue includes the child, which the plain observation schema does not.
const queueItemSchema = observationSchema.extend({ child: personRefSchema.nullish() });
const queueSchema = paginated(queueItemSchema);

/**
 * Process parent submissions.
 *
 * ★ The only true queue in the product, and the one screen where a teacher acts
 * on a batch rather than on one child.
 *
 * Approving and publishing happen in **one** action. The API accepts
 * `visibleToParents` alongside the decision precisely so this screen does not
 * need a second request — and a teacher who has to remember a follow-up step
 * will not take it, leaving families unable to see notes they wrote themselves.
 */
export default function ReviewQueuePage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <ReviewQueue />
    </RequireRole>
  );
}

function ReviewQueue() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.reviewQueue(),
    queryFn: () => get("/observations/review-queue?page=1&pageSize=25", queueSchema),
  });

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader
        title="Эцэг эхийн ажиглалт — хянах"
        lede="Гэрээс хуваалцсан бичлэгүүдийг хянаж, хавтаст нэмнэ."
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
          description="Эцэг эхээс шинэ ажиглалт ирвэл энд харагдана."
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {(data?.items ?? []).map((observation) => (
          <ReviewCard key={observation.id} observation={observation} />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({ observation }: { observation: z.infer<typeof queueItemSchema> }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [publish, setPublish] = useState(true);
  const [returning, setReturning] = useState(false);

  const review = useMutation({
    mutationFn: (decision: "APPROVED" | "RETURNED") =>
      mutate(`/observations/${observation.id}/review`, observationSchema, {
        method: "POST",
        body: {
          decision,
          reviewNote: note.trim() || undefined,
          // Only meaningful on approval; sending it on a return would be noise
          // the API has to ignore.
          ...(decision === "APPROVED" ? { visibleToParents: publish } : {}),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.reviewQueue() });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.teacher() });
      if (observation.child) {
        void queryClient.invalidateQueries({ queryKey: qk.child(observation.child.id) });
      }
    },
  });

  return (
    <Card className="flex flex-col gap-4 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {observation.child ? (
            <Link
              href={`/children/${observation.child.id}`}
              // Inline in a sentence, so the box is grown rather than the text:
              // measured at 18px, which is not a target a thumb finds.
              className="inline-flex min-h-[44px] items-center font-medium text-ink underline-offset-4 hover:underline"
            >
              {fullName(observation.child)}
            </Link>
          ) : (
            <span className="font-medium text-ink">—</span>
          )}
          <p className="text-body text-muted">
            {[fullName(observation.author), formatDate(observation.observedOn)]
              .filter((v) => v !== "—")
              .join(" · ")}
          </p>
        </div>
        <Badge tone="sun">Хүлээгдэж буй</Badge>
      </div>

      <div className="flex flex-col gap-2 rounded-control bg-canvas px-3.5 py-3 text-body text-ink">
        {observation.situation ? (
          <p className="whitespace-pre-wrap">{observation.situation}</p>
        ) : null}
        {observation.childDid ? (
          <p className="whitespace-pre-wrap">
            <span className="font-medium">Хийсэн: </span>
            {observation.childDid}
          </p>
        ) : null}
        {observation.childSaid ? (
          <p className="whitespace-pre-wrap">
            <span className="font-medium">Хэлсэн: </span>
            {observation.childSaid}
          </p>
        ) : null}
        {!observation.situation && !observation.childDid && !observation.childSaid ? (
          <p className="text-muted">Бичвэргүй.</p>
        ) : null}
      </div>

      <FormError message={review.isError ? errorMessage(review.error) : null} />

      {returning ? (
        <Field
          label="Буцаах шалтгаан"
          hint="Эцэг эхэд харагдана. Юуг тодруулах шаардлагатайг бичнэ үү."
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
          )}
        </Field>
      ) : (
        <Checkbox
          label="Батлаад эцэг эхэд харуулах"
          description="Тэмдэглэхгүй бол зөвшөөрөгдөх боловч зөвхөн багш нар харна."
          checked={publish}
          onChange={(e) => setPublish(e.target.checked)}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {returning ? (
          <>
            <Button
              variant="danger"
              disabled={review.isPending}
              onClick={() => review.mutate("RETURNED")}
            >
              <Undo2 size={18} />
              {review.isPending ? "Илгээж байна…" : "Буцаах"}
            </Button>
            <Button variant="secondary" onClick={() => setReturning(false)}>
              Цуцлах
            </Button>
          </>
        ) : (
          <>
            <Button disabled={review.isPending} onClick={() => review.mutate("APPROVED")}>
              <Check size={18} />
              {review.isPending ? "Хадгалж байна…" : "Батлах"}
            </Button>
            <Button variant="secondary" onClick={() => setReturning(true)}>
              Буцаах
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
