"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, X } from "lucide-react";
import { useState } from "react";
import { downloadUrlSchema, reportJobSchema, type ReportJob } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/format";
import { PORTFOLIO } from "@/lib/vocabulary";

/**
 * Request a PDF and follow it to completion.
 *
 * ★ Reports have no route of their own. Generating one is an action taken *on a
 * child*, from that child's page — an index of past reports would be a list of
 * things you already navigated away from.
 *
 * Generation is asynchronous (BullMQ), so this polls. There is no realtime
 * channel in the MVP, and polling a single job for the seconds it takes is
 * exactly the case where that decision costs nothing.
 */
export function ReportDialog({
  childId,
  trigger,
  /**
   * The child's current school year, if the page knows it.
   *
   * ★ Without it the annual option is not offered at all, rather than offered
   * and refused: RFP §6.5 compares one year's four terms, so the API requires a
   * `schoolYearId` and answers 400 without one. A button that always fails
   * teaches people the feature is broken.
   */
  schoolYearId,
}: {
  childId: string;
  trigger: React.ReactNode;
  schoolYearId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: (type: "CHILD_PORTFOLIO" | "ANNUAL_REPORT") =>
      mutate("/reports", reportJobSchema, {
        method: "POST",
        body:
          type === "ANNUAL_REPORT"
            ? { childId, type, schoolYearId }
            : { childId, type: "CHILD_PORTFOLIO" },
      }),
    onSuccess: (job) => {
      setJobId(job.id);
      void queryClient.invalidateQueries({ queryKey: qk.childReports(childId) });
    },
  });

  const { data: job } = useQuery({
    queryKey: qk.report(jobId ?? ""),
    queryFn: () => get(`/reports/${jobId}`, reportJobSchema),
    enabled: Boolean(jobId),
    // Polls only while the job is unfinished. Returning `false` once it is DONE
    // or FAILED stops the interval — otherwise the tab keeps requesting a
    // finished job for as long as it stays open.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "QUEUED" || status === "RUNNING" ? 2000 : false;
    },
  });

  function close() {
    setOpen(false);
    // Reset so reopening starts fresh rather than showing the previous
    // download, which may by then have expired.
    setJobId(null);
    create.reset();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-surface p-5 shadow-lg"
          aria-describedby="report-dialog-description"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lead font-semibold text-ink">
                {PORTFOLIO} PDF
              </Dialog.Title>
              <Dialog.Description
                id="report-dialog-description"
                className="mt-1 text-body text-muted"
              >
                {PORTFOLIO} эсвэл жилийн тайланг PDF болгон бэлтгэнэ. Хэдэн секунд болно.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Хаах">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <div className="mt-3">
            {!jobId ? (
              <div className="flex flex-col gap-2">
                <Button
                  block
                  size="lg"
                  disabled={create.isPending}
                  onClick={() => create.mutate("CHILD_PORTFOLIO")}
                >
                  <FileText size={18} />
                  {create.isPending ? "Илгээж байна…" : PORTFOLIO}
                </Button>

                {/* RFP §6.5 — offered only when the year is known. See above. */}
                {schoolYearId ? (
                  <Button
                    block
                    variant="secondary"
                    size="lg"
                    disabled={create.isPending}
                    onClick={() => create.mutate("ANNUAL_REPORT")}
                  >
                    <FileText size={18} />
                    Жилийн нэгдсэн тайлан
                  </Button>
                ) : null}
              </div>
            ) : (
              <ReportProgress job={job} onRetry={() => create.mutate("CHILD_PORTFOLIO")} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The four states a job can be in.
 *
 * All four are rendered, including FAILED — a report that quietly stops
 * updating is indistinguishable from one still running, and the user waits
 * indefinitely for something that already failed.
 */
function ReportProgress({ job, onRetry }: { job?: ReportJob; onRetry: () => void }) {
  /**
   * ★ The tab is opened **synchronously, before the request**.
   *
   * Safari — and iOS Safari in particular — only permits `window.open` while a
   * user gesture is still on the stack. Calling it in `onSuccess`, after an
   * `await`, is off the gesture and gets blocked as a popup: the parent taps
   * "Татаж авах", nothing happens, and there is no error to explain it. That is
   * the primary parent action failing silently on the primary parent device.
   *
   * So a blank tab is opened first and its location set once the presigned URL
   * arrives. If the request fails, the tab is closed again rather than left
   * sitting on `about:blank`.
   *
   * `noopener` matters: without it the opened page can reach back through
   * `window.opener` and navigate this one.
   */
  const download = useMutation({
    mutationFn: async () => {
      const tab = window.open("", "_blank", "noopener,noreferrer");

      try {
        const result = await get(`/reports/${job!.id}/download`, downloadUrlSchema);

        if (tab) {
          // The URL is a bearer credential with a short life. It is handed to
          // the browser and never rendered into the page or stored.
          tab.location.href = result.url;
        } else {
          // A popup blocker refused even the synchronous open. Navigating this
          // tab still delivers the file, and the dialog is transient anyway.
          window.location.href = result.url;
        }

        return result;
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
  });

  if (!job || job.status === "QUEUED" || job.status === "RUNNING") {
    /*
      ★ REDESIGN 2026-09-03 — the two waiting states now look different.

      A PDF is a queued job (constraint 16), and it passes through two stages
      that mean genuinely different things: waiting for a worker to pick it up,
      and a worker actually rendering it. Both drew the same spinner and one
      line of grey text, so the only way to tell "the queue is backed up" from
      "it is being made right now" was to read the sentence — and on a slow
      afternoon that sentence changing was the sole evidence anything was
      happening at all.

      A determinate two-step strip carries it instead: the first segment fills
      on QUEUED, both fill on RUNNING. The stage is named beside it, so the
      progress is not the only signal, and `role="status"` still announces the
      wording rather than the bars.
    */
    const running = job?.status === "RUNNING";

    return (
      <div role="status" className="flex flex-col gap-2.5 rounded-row bg-sunken px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin rounded-pill border-2 border-primary border-t-transparent"
          />
          <span className="text-body font-medium text-ink">
            {running ? "Бэлтгэж байна…" : "Дараалалд орлоо…"}
          </span>
        </div>

        <div aria-hidden="true" className="flex gap-1.5">
          <span className="h-1.5 flex-1 rounded-pill bg-primary" />
          <span
            className={cn(
              "h-1.5 flex-1 rounded-pill transition-colors duration-300",
              running ? "bg-primary" : "bg-track",
            )}
          />
        </div>

        <p className="text-caption text-muted">Тайлан бэлэн болмогц энд татах холбоос гарч ирнэ.</p>
      </div>
    );
  }

  if (job.status === "FAILED") {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger">
          {job.errorMessage || "Тайлан үүсгэхэд алдаа гарлаа."}
        </p>
        <Button variant="secondary" block onClick={onRetry}>
          Дахин оролдох
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="rounded-control bg-mint px-4 py-3 text-body text-mint-ink">
        Бэлэн боллоо
        {job.pageCount ? ` · ${job.pageCount} хуудас` : ""}
        {job.fileSize ? ` · ${formatFileSize(job.fileSize)}` : ""}
      </p>

      <FormError message={download.isError ? errorMessage(download.error) : null} />

      <Button block size="lg" disabled={download.isPending} onClick={() => download.mutate()}>
        <Download size={18} />
        {download.isPending ? "Түр хүлээнэ үү…" : "Татаж авах"}
      </Button>
    </div>
  );
}
