"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { qpayInvoiceAttemptSchema, type QpayInvoiceAttempt } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/states";

/**
 * Paying one invoice through QPay — нэмэлт.md §8's guardian-facing half.
 *
 * ★ Same shape as `ReportDialog`: local state, a create mutation, a polling
 * read — because it is the same problem (start an async thing, follow it to
 * completion) applied to money instead of a PDF. The poll hits
 * `ChildInvoiceQpayController.status`, which re-asks QPay's own check API and
 * credits the payment the moment it sees PAID — the same `reconcile()` the
 * webhook calls, so this works correctly even on a deployment with no public
 * callback URL configured.
 *
 * ★★ `create` failing with "QPay холболт тохируулагдаагүй байна." is not a
 * crash — it is this deployment's normal state until a merchant account
 * exists (`docs/reference/QPAY_INTEGRATION.md`). Shown inline rather than a
 * toast, since the dialog is already open and about the failure.
 */
export function AccessPayDialog({
  childId,
  trigger,
  onPaid,
}: {
  childId: string;
  trigger: ReactNode;
  /** Called once, the moment a poll reports PAID — the gate has opened. */
  onPaid: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/access/qpay`, qpayInvoiceAttemptSchema, {
        method: "POST",
        body: {},
      }),
    onSuccess: (attempt) => {
      queryClient.setQueryData(qk.accessQpay(childId), attempt);
      setAttemptId(attempt.id);
    },
  });

  const { data: attempt } = useQuery({
    queryKey: qk.accessQpay(childId),
    queryFn: () =>
      get(`/children/${childId}/access/qpay`, qpayInvoiceAttemptSchema),
    enabled: Boolean(attemptId) && open,
    // Polls only while the attempt is still PENDING — the same rule
    // `ReportDialog` applies to a report job, here applied to a payment.
    refetchInterval: (query) => (query.state.data?.status === "PENDING" ? 3000 : false),
  });

  // Fires exactly once per attempt, the moment a poll first reports PAID.
  const paidNotified = useRef(false);
  useEffect(() => {
    if (attempt?.status === "PAID" && !paidNotified.current) {
      paidNotified.current = true;
      onPaid();
    }
  }, [attempt, onPaid]);

  function close() {
    setOpen(false);
    setAttemptId(null);
    paidNotified.current = false;
    create.reset();
  }

  function openAndStart() {
    setOpen(true);
    create.mutate();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? openAndStart() : close())}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-surface p-5 shadow-lg"
          aria-describedby="qpay-dialog-description"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lead font-semibold text-ink">QPay-ээр төлөх</Dialog.Title>
              <Dialog.Description id="qpay-dialog-description" className="mt-1 text-body text-muted">
                QR кодыг банкны аппаараа уншуулж төлнө үү.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Хаах">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <QpayProgress attempt={attempt} pending={create.isPending} onRetry={() => create.mutate()} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function QpayProgress({
  attempt,
  pending,
  onRetry,
}: {
  attempt?: QpayInvoiceAttempt;
  pending: boolean;
  onRetry: () => void;
}) {
  if (pending || !attempt) {
    return (
      <div role="status" className="flex items-center gap-3 rounded-control bg-canvas px-4 py-3.5">
        <span
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin rounded-pill border-2 border-primary border-t-transparent"
        />
        <span className="text-body text-ink">Бэлтгэж байна…</span>
      </div>
    );
  }

  if (attempt.status === "PAID") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-control bg-mint px-4 py-6 text-center">
        <CheckCircle2 size={32} className="text-mint-ink" aria-hidden="true" />
        <p role="status" className="text-body font-medium text-mint-ink">
          Төлбөр амжилттай хийгдлээ
        </p>
      </div>
    );
  }

  if (attempt.status === "EXPIRED" || attempt.status === "CANCELLED") {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger">
          QR кодын хугацаа дууссан байна.
        </p>
        <Button variant="secondary" block onClick={onRetry}>
          Дахин үүсгэх
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {attempt.qrImage ? (
        // A data URI, not a remote asset — same reasoning `media-image.tsx` gives for plain `<img>`.
        <img
          src={`data:image/png;base64,${attempt.qrImage}`}
          alt="QPay QR код"
          className="size-56 rounded-control border border-border-soft bg-white p-2"
        />
      ) : null}
      <p className="text-lead font-semibold tabular-nums text-ink">{money(attempt.amount)}</p>
      <div className="flex items-center gap-1.5 text-caption text-muted" role="status">
        <Clock size={14} aria-hidden="true" />
        Төлбөр хүлээгдэж байна…
      </div>
    </div>
  );
}

/** `"126900.00"` → `"126 900₮"` — same formatting `/invoices` uses. */
function money(value: string): string {
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return cents && cents !== "00" ? `${grouped}.${cents}₮` : `${grouped}₮`;
}
