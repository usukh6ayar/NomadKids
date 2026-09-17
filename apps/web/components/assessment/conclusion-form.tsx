"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, X } from "lucide-react";
import { z } from "zod";
import { termReportSchema, termSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { MediaThumb } from "@/components/media/media-image";
import { ReadOnlyReport } from "@/components/assessment/report-archive";
import { formatDayMonthLong } from "@/lib/format";
import type { ConclusionNote } from "@/components/assessment/conclusion-notes";

/**
 * What the client's design allows in the main box. The contract permits 4000;
 * this is the narrower promise the screen makes, so the counter can never
 * count up to a number the server would then refuse.
 */
const BODY_LIMIT = 1000;

/**
 * Дүгнэлт бичих — the conclusion, and the notes it is drawn from.
 *
 * ★ One content box, not four — the client's 2026-09-14 design.
 *
 * The term report carries four paragraphs (давуу тал, дэмжлэг, зорилт,
 * зөвлөмж) and the PDF prints all four. Asking for four before anything is
 * written is what made the old screen feel like a form to be filled rather
 * than a conclusion to be written, so the main box is the conclusion and the
 * other three are one press away under Дэлгэрэнгүй — present for the teacher
 * who wants the structure, absent for the one who does not. Nothing was
 * dropped from the record: the PDF still finds whatever was filled in.
 *
 * ★★ Дүгнэлт хадгалах saves **and** finalises, behind one confirmation.
 *
 * It used to be two presses — Ноорог хадгалах, then Баталгаажуулах, which was
 * refused until a draft existed. Finalising is still one-way and still
 * confirmed; what is gone is the failure where the second press rejects work
 * the teacher believed they had just done.
 */
export function ConclusionForm({
  childId,
  term,
  report,
  citedNotes,
  citedIds,
  onRemove,
  onClear,
}: {
  childId: string;
  term: z.infer<typeof termSchema>;
  report: z.infer<typeof termReportSchema> | undefined;
  /** The ticked notes, resolved for display and in the order they happened. */
  citedNotes: ConclusionNote[];
  citedIds: string[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const termId = term.id;
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const [form, setForm] = useState({
    strengths: "",
    needsSupport: "",
    nextGoals: "",
    adviceForParents: "",
  });

  // Seeded from the server, and re-seeded when the term changes — otherwise
  // switching terms would show the previous term's text in the new one's form.
  useEffect(() => {
    setForm({
      strengths: report?.strengths ?? "",
      needsSupport: report?.needsSupport ?? "",
      nextGoals: report?.nextGoals ?? "",
      adviceForParents: report?.adviceForParents ?? "",
    });
  }, [report, termId]);

  const body = {
    termId,
    strengths: form.strengths.trim() || null,
    needsSupport: form.needsSupport.trim() || null,
    nextGoals: form.nextGoals.trim() || null,
    adviceForParents: form.adviceForParents.trim() || null,
    // Always sent, so unticking the last note is expressible. The API treats an
    // omitted field as "leave the citation alone".
    observationIds: citedIds,
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: qk.termReport(childId, termId) });

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/term-report`, termReportSchema, { method: "PUT", body }),
    onSuccess: invalidate,
  });

  const finalize = useMutation({
    mutationFn: async () => {
      // Saved first: the text on screen is what gets finalised, which is what
      // pressing "Дүгнэлт хадгалах" says it does.
      await mutate(`/children/${childId}/term-report`, termReportSchema, { method: "PUT", body });
      await mutate(`/children/${childId}/term-report/finalize`, z.unknown(), {
        method: "POST",
        body: { termId },
      });
    },
    onSuccess: invalidate,
  });

  const busy = save.isPending || finalize.isPending;
  const errors = fieldErrors(save.error);

  if (report?.status === "FINAL") {
    return (
      <Card pad="roomy" className="flex flex-col gap-4">
        <p role="status" className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink">
          Энэ дүгнэлт баталгаажсан тул засах боломжгүй.
        </p>
        <ReadOnlyReport report={report} />
      </Card>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) save.mutate();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <Card pad="roomy" className="flex flex-col gap-4">
        {/*
          ★ The term is named rather than chosen — 2026-09-14.

          The filters above are a date range now, and the term is derived from
          where that range starts. A conclusion still belongs to one term and
          is saved against it, so the screen says which: derived is fine,
          silent is not.
        */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lead font-semibold text-ink">Дүгнэлт бичих</h2>
          <span className="rounded-pill bg-canvas px-2.5 py-1 text-caption text-muted">
            {`${term.number}. ${term.name}`}
          </span>
        </div>

        <FormError message={save.isError ? errorMessage(save.error) : null} />
        <FormError message={finalize.isError ? errorMessage(finalize.error) : null} />

        {save.isSuccess && !busy ? (
          <p
            role="status"
            className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink"
          >
            Ноорог хадгалагдлаа.
          </p>
        ) : null}

        {/* The citation, as a list that can be undone one row at a time. */}
        <section aria-label="Сонгосон тэмдэглэл" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-body font-semibold text-ink">
              Сонгосон тэмдэглэл ({citedIds.length})
            </h3>
            {citedIds.length > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="min-h-11 rounded-pill px-2 text-caption font-medium text-primary transition-colors hover:bg-primary-soft"
              >
                Бүгдийг цэвэрлэх
              </button>
            ) : null}
          </div>

          {citedNotes.length === 0 ? (
            <p className="rounded-control bg-canvas px-3.5 py-3 text-caption text-muted">
              Зүүн талаас тэмдэглэлээ чеклэж сонгоно уу.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {citedNotes.map((note) => (
                <li
                  key={note.id}
                  className="flex items-start gap-2.5 rounded-card border border-border p-2.5"
                >
                  <span className="size-11 shrink-0 overflow-hidden rounded-control bg-canvas">
                    {note.media?.[0] ? (
                      <MediaThumb mediaId={note.media[0].id} caption={note.activityName} flush />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-caption text-muted">
                      {formatDayMonthLong(note.observedOn)}
                      {note.type?.name ? ` · ${note.type.name}` : ""}
                    </span>
                    <span className="line-clamp-2 block text-body leading-snug text-ink">
                      {note.situation || note.activityName || "(тэмдэглэл хоосон)"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(note.id)}
                    aria-label={`${formatDayMonthLong(note.observedOn)}-ний тэмдэглэлийг хасах`}
                    className="grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Field
          label="Дүгнэлтийн агуулга"
          hint={`${form.strengths.length}/${BODY_LIMIT}`}
          error={errors.strengths}
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              required
              rows={7}
              maxLength={BODY_LIMIT}
              placeholder="Сонгосон тэмдэглэлүүдийг үндэслэн дүгнэлтээ бичнэ үү…"
              value={form.strengths}
              onChange={(event) => setForm((f) => ({ ...f, strengths: event.target.value }))}
            />
          )}
        </Field>

        <Disclosure title="Дэлгэрэнгүй хэсгүүд" hint="заавал биш">
          <div className="flex flex-col gap-4">
            <ReportField
              label="Дэмжлэг шаардлагатай"
              hint="Юун дээр илүү дадлага хэрэгтэй байгаа вэ."
              error={errors.needsSupport}
              value={form.needsSupport}
              onChange={(value) => setForm((f) => ({ ...f, needsSupport: value }))}
            />
            <ReportField
              label="Дараагийн зорилт"
              error={errors.nextGoals}
              value={form.nextGoals}
              onChange={(value) => setForm((f) => ({ ...f, nextGoals: value }))}
            />
            <ReportField
              label="Эцэг эхэд өгөх зөвлөмж"
              hint="Гэртээ юу хийвэл дэмжлэг болох вэ."
              error={errors.adviceForParents}
              value={form.adviceForParents}
              onChange={(value) => setForm((f) => ({ ...f, adviceForParents: value }))}
            />
          </div>
        </Disclosure>

        {/* The client's own reminder box, word for word. */}
        <aside className="flex gap-2.5 rounded-card bg-primary-soft/50 p-3.5">
          <Lightbulb size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-body font-semibold text-primary">Санамж</p>
            <ul className="mt-1 list-disc pl-4 text-caption leading-relaxed text-ink">
              <li>Тэмдэглэлүүдээс харагдсан хөгжлийн ахиц, онцлогийг нэгтгэн дүгнэ.</li>
              <li>Суралцагчийн хүчтэй тал, дэмжлэг шаардлагатай хэсгийг тусга.</li>
              <li>Эцэг эхтэй хуваалцах, дараагийн зорилтыг тодорхой болгож бич.</li>
            </ul>
          </div>
        </aside>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" variant="secondary" disabled={busy}>
          {save.isPending ? "Хадгалж байна…" : "Ноорог хадгалах"}
        </Button>

        {/*
          Confirmed, because it is one-way: a finalised conclusion is the
          kindergarten's record of the term and this screen stops offering the
          form afterwards.
        */}
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Дүгнэлтийг баталгаажуулах уу?"
          description="Баталгаажуулсны дараа засах боломжгүй."
          confirmLabel="Баталгаажуулах"
          pendingLabel="Баталгаажуулж байна…"
          pending={finalize.isPending}
          onConfirm={() => finalize.mutate()}
          trigger={
            <Button type="button" disabled={busy || !form.strengths.trim()}>
              Дүгнэлт хадгалах
            </Button>
          }
        />
      </div>
    </form>
  );
}

function ReportField({
  label,
  hint,
  error,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <Textarea
          id={id}
          aria-describedby={describedBy}
          invalid={invalid}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
