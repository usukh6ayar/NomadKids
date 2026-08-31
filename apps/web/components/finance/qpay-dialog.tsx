"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { qpayInvoiceSchema, qpaySyncSchema, type QpayInvoice } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { money } from "./money";

/**
 * The QPay payment sheet — `нэмэлт.md` §8.
 *
 * ★ **Bank deeplinks first, the QR second.** A parent opening this is already
 * holding the phone that shows it, so scanning the code with that same phone's
 * camera is impossible. The buttons hand off to the banking app directly; the
 * QR is for the case where the payer is at a second device — a laptop, or a
 * grandparent's phone held up to the screen.
 *
 * ★★ There is no polling loop. A callback settles the invoice server-side
 * within seconds, but a lost callback is common enough that QPay's own note
 * asks for verification — so the parent gets a **"Төлснөө шалгах"** button
 * which runs `/qpay/sync`. Polling every two seconds would hammer QPay through
 * our own rate limiter for a result that usually arrives on its own, and it
 * would keep running in a backgrounded tab.
 */
export function QpayDialog({
  invoiceId,
  childId,
  qpay,
  onClose,
}: {
  invoiceId: string;
  childId: string;
  qpay: QpayInvoice;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [checked, setChecked] = useState(false);

  // Escape closes it, like every other dismissible surface in the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sync = useMutation({
    mutationFn: () =>
      mutate(`/invoices/${invoiceId}/qpay/sync`, qpaySyncSchema, { method: "POST" }),
    onSuccess: async (result) => {
      setChecked(true);

      await queryClient.invalidateQueries({ queryKey: qk.invoice(invoiceId) });
      await queryClient.invalidateQueries({ queryKey: qk.child(childId) });

      if (result.status === "PAID") {
        toast.success("Төлбөр амжилттай хийгдлээ");
        onClose();
        return;
      }
      if (result.applied > 0) {
        toast.success(`${money(result.paidAmount)} хүлээн авлаа`);
        return;
      }
      // Not an error: the parent may simply not have paid yet, and calling it
      // a failure would read as "your payment was rejected".
      toast.info("Төлбөр хараахан ирээгүй байна. Хэсэг хүлээгээд дахин шалгана уу.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qpay-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-card bg-surface p-5 shadow-lg sm:max-w-md sm:rounded-card">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="qpay-title" className="text-h3 font-semibold text-ink">
              QPay-ээр төлөх
            </h2>
            <p className="mt-1 text-body-sm text-muted">
              Төлөх дүн: <span className="font-semibold text-ink">{money(qpay.amount)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="grid size-9 shrink-0 place-items-center rounded-pill text-muted hover:bg-canvas"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {qpay.links.length > 0 && (
          <section className="mb-5">
            <h3 className="mb-2 text-body-sm font-medium text-ink">Банкны аппаар төлөх</h3>
            <ul className="grid gap-2">
              {qpay.links.map((link) => (
                <li key={link.name}>
                  {/*
                    A real anchor, not a router push: these are `khanbank://`
                    style schemes that the OS hands to another app, and
                    Next's router would try to treat them as in-app routes.
                  */}
                  <a
                    href={link.link}
                    className="flex items-center justify-between gap-3 rounded-row border border-border px-4 py-3 text-body-sm font-medium text-ink transition-colors hover:bg-canvas"
                  >
                    <span>{link.description || link.name}</span>
                    <ExternalLink size={16} aria-hidden="true" className="shrink-0 text-muted" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mb-5">
          <h3 className="mb-2 text-body-sm font-medium text-ink">Эсвэл QR кодыг уншуулах</h3>
          <div className="grid place-items-center rounded-row border border-border bg-canvas p-4">
            {/*
              A plain `<img>`, and deliberately so: this is a base64 data URI,
              not a remote asset. `next/image` would want a loader and a domain
              allowlist for a string that never leaves the response, and there
              is nothing for it to optimise in bytes that are already inline.
            */}
            <img
              src={`data:image/png;base64,${qpay.qrImage}`}
              alt="QPay төлбөрийн QR код"
              className="size-48 max-w-full"
            />
          </div>
        </section>

        <Button block onClick={() => sync.mutate()} disabled={sync.isPending} variant="secondary">
          <RefreshCw
            size={18}
            aria-hidden="true"
            className={sync.isPending ? "animate-spin" : undefined}
          />
          {sync.isPending ? "Шалгаж байна…" : "Төлснөө шалгах"}
        </Button>

        <p className="mt-3 text-caption text-muted">
          {checked
            ? "Төлбөр хийсний дараа энэ товчийг дарж шалгана уу. Ихэвчлэн хэдхэн секундэд автоматаар шинэчлэгддэг."
            : "Төлбөр хийсний дараа автоматаар шинэчлэгдэнэ. Хэрэв удаж байвал дээрх товчийг дарна уу."}
        </p>
      </div>
    </div>
  );
}

/** Starts a QPay payment. Returns the QR to hand to `QpayDialog`. */
export function useStartQpayPayment(invoiceId: string) {
  const toast = useToast();

  return useMutation({
    mutationFn: () => mutate(`/invoices/${invoiceId}/qpay`, qpayInvoiceSchema, { method: "POST" }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
