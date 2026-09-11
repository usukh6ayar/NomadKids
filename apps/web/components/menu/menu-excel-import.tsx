"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

const resultSchema = z.object({
  dryRun: z.boolean(),
  days: z.array(z.object({ date: z.string(), dishes: z.number() })),
  dishCount: z.number(),
  problems: z.array(z.object({ rowNumber: z.number(), message: z.string() })),
});

type ImportResult = z.infer<typeof resultSchema>;

/**
 * The week's menu from a spreadsheet — 2026-09-11, at the client's request:
 * "хоолны цэсийг тогооч ба багш дээр хүснэгтээр экселээр оруулах хэсэг нэм."
 *
 * ★ It reads back exactly what the Excel татах button writes, so the loop is
 * download → edit → upload. A kitchen plans next week by changing this week's
 * names, and a bespoke template would break that the first time a column moved.
 *
 * ★★ Two presses, always: the file is checked first and written only after the
 * teacher has seen what it would do.
 *
 * The endpoint is a dry run by default and this screen never skips it. An
 * import **replaces** each named day, so a five-day file wipes and rewrites
 * five days — one misplaced click away from erasing a week somebody spent an
 * afternoon entering. The confirmation names the days and counts the dishes.
 *
 * ★★★ It sits *beside* the manual editor, not instead of it — the client was
 * explicit ("тогооч гараар оруулахыг үлдээ"), and a spreadsheet has no column
 * for a dish photograph or a технологийн карт, both of which the editor sets.
 */
export function MenuExcelImport({ kindergartenId }: { kindergartenId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);

  /** The picked file, held until the preview has been seen. */
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const run = useMutation({
    mutationFn: async ({ picked, write }: { picked: File; write: boolean }) => {
      const form = new FormData();
      form.append("file", picked);
      return mutate(
        `/kindergartens/${kindergartenId}/menu/import?dryRun=${write ? "false" : "true"}`,
        resultSchema,
        { method: "POST", body: form },
      );
    },
    onSuccess: (result) => {
      if (result.dryRun) {
        setPreview(result);
        return;
      }

      toast.success(`${result.days.length} өдрийн цэс орууллаа.`);
      reset();
      void queryClient.invalidateQueries({ queryKey: ["kindergarten", kindergartenId, "menu"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function reset() {
    setFile(null);
    setPreview(null);
    run.reset();
    if (input.current) input.current.value = "";
  }

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-ink">Excel-ээр оруулах</h2>
          <p className="text-caption text-muted">
            Excel татах товчоор татсан хүснэгтээ засаад буцааж оруулна.
          </p>
        </div>

        {/*
          A label wrapping the input rather than a button that clicks a hidden
          one — the file input is the control, and the second thing would have
          to be kept focusable and keyboard-reachable for no gain.
        */}
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-button border border-border bg-surface px-4 text-body font-medium text-ink transition-colors hover:bg-canvas focus-within:ring-2 focus-within:ring-primary">
          <Upload size={16} aria-hidden="true" />
          Файл сонгох
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (!picked) return;
              setFile(picked);
              setPreview(null);
              run.mutate({ picked, write: false });
            }}
          />
        </label>
      </div>

      {file ? <p className="truncate text-caption text-muted">{file.name}</p> : null}

      {preview ? (
        <div className="flex flex-col gap-2 rounded-row border border-border bg-canvas px-3.5 py-3">
          <p className="text-body text-ink">
            {preview.days.length} өдөр, {preview.dishCount} хоол оруулна.
          </p>

          {preview.days.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {preview.days.map((day) => (
                <li
                  key={day.date}
                  className="rounded-pill bg-surface px-2.5 py-1 text-caption tabular-nums text-muted"
                >
                  {day.date} · {day.dishes}
                </li>
              ))}
            </ul>
          ) : null}

          {/*
            ★ The problems are listed, not counted.

            A row the parser could not read is a line the kitchen has to go and
            fix; "3 алдаа" sends them hunting through a spreadsheet for which
            three.
          */}
          {preview.problems.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-caption text-danger">
              {preview.problems.map((problem, index) => (
                <li key={index}>
                  {problem.rowNumber > 0 ? `${problem.rowNumber}-р мөр: ` : ""}
                  {problem.message}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-caption text-muted">
            Оруулсан өдрүүдийн одоогийн цэс бүрэн солигдоно.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={run.isPending || preview.dishCount === 0}
              onClick={() => file && run.mutate({ picked: file, write: true })}
            >
              {run.isPending ? "Оруулж байна…" : "Оруулах"}
            </Button>
            <Button size="sm" variant="secondary" onClick={reset}>
              Болих
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
