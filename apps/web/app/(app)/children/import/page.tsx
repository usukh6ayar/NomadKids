"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, FormError, LoadingState } from "@/components/ui/states";

const resultSchema = z.object({
  dryRun: z.boolean(),
  willImport: z.number(),
  skipped: z.number(),
  problems: z.array(z.object({ rowNumber: z.number(), message: z.string() })),
  preview: z.array(
    z.object({
      rowNumber: z.number(),
      name: z.string(),
      group: z.string().nullable(),
    }),
  ),
  imported: z.array(z.object({ id: z.string(), lastName: z.string(), firstName: z.string() })),
});

type ImportResult = z.infer<typeof resultSchema>;

/**
 * Excel roster import — RFP §3.4.
 *
 * ★ Two steps, always: the file is checked and previewed before anything is
 * written. The API defaults to a dry run for the same reason — an import that
 * writes on the first click is one misplaced tap from five hundred children
 * nobody meant to create.
 *
 * ★★ The refusals are the screen's main content, not an error toast. "Which
 * eleven rows will not import, and why" is exactly what the person holding a
 * spreadsheet needs, and it is per row so they can go and fix it.
 */
export default function ImportPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <ImportChildren />
    </RequireRole>
  );
}

function ImportChildren() {
  const toast = useToast();
  const router = useRouter();
  const { primaryKindergartenId } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const run = useMutation({
    mutationFn: ({ chosen, dryRun }: { chosen: File; dryRun: boolean }) => {
      const form = new FormData();
      form.append("file", chosen);
      // No Content-Type: the browser must add the multipart boundary itself.
      return mutate(
        `/kindergartens/${primaryKindergartenId}/children/import?dryRun=${dryRun}`,
        resultSchema,
        { method: "POST", body: form },
      );
    },
    onSuccess: (result) => {
      toast.success("Импорт дууслаа.");
      setPreview(result);
      // A completed import leaves the roster stale, so go and look at it.
      if (!result.dryRun) router.push("/children");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function choose(list: FileList | null) {
    const chosen = list?.[0];
    if (!chosen) return;

    setFile(chosen);
    setPreview(null);
    run.mutate({ chosen, dryRun: true });
  }

  if (!primaryKindergartenId) {
    return <EmptyState title="Цэцэрлэг олдсонгүй" description="Танд харьяалагдах цэцэрлэг алга." />;
  }

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Excel-ээс импортлох"
        lede="Файлыг эхлээд шалгаж харуулна. Та зөвшөөрснөөр л бүртгэнэ."
      />

      <Card pad="roomy" className="flex flex-col gap-3">
        <SectionHeader
          title="1. Файл сонгох"
          lede="Овог, Нэр, Хүйс, Төрсөн огноо баганатай .xlsx файл."
        />

        <input
          ref={inputRef}
          id="roster-file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => choose(e.target.files)}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="secondary" disabled={run.isPending}>
            <label htmlFor="roster-file" className="cursor-pointer">
              <Upload size={18} aria-hidden />
              {file ? "Өөр файл сонгох" : "Файл сонгох"}
            </label>
          </Button>

          {file ? <span className="text-body text-muted">{file.name}</span> : null}
        </div>

        {/*
          The export doubles as the template: it is the same columns in the
          same order, so "download, edit, upload" needs no separate example
          file that could drift from what the parser accepts.
        */}
        <p className="text-caption text-muted">
          Загвар хэрэгтэй бол{" "}
          <a
            className="font-medium text-primary hover:underline"
            href={downloadUrl(`/kindergartens/${primaryKindergartenId}/children/export`)}
          >
            одоогийн жагсаалтыг Excel-ээр татаад
          </a>{" "}
          засаж болно.
        </p>

        <FormError message={run.isError ? errorMessage(run.error) : null} />
      </Card>

      {run.isPending && !preview ? <LoadingState rows={3} /> : null}

      {preview ? (
        <>
          <Card pad="roomy" className="flex flex-col gap-3">
            <SectionHeader title="2. Шалгасан үр дүн" />

            <div className="flex flex-wrap gap-4">
              <Figure
                tone="mint"
                icon={<CheckCircle2 size={18} aria-hidden />}
                value={preview.willImport}
                label="бүртгэгдэнэ"
              />
              <Figure
                tone="sun"
                icon={<AlertTriangle size={18} aria-hidden />}
                value={preview.skipped}
                label="алгасана"
              />
            </div>

            {preview.preview.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {preview.preview.map((row) => (
                  <li key={row.rowNumber} className="text-body text-ink">
                    <span className="text-caption text-muted">мөр {row.rowNumber}</span> {row.name}
                    {row.group ? (
                      <span className="text-caption text-muted"> · {row.group}</span>
                    ) : null}
                  </li>
                ))}
                {preview.willImport > preview.preview.length ? (
                  <li className="text-caption text-muted">
                    …бас {preview.willImport - preview.preview.length}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </Card>

          {preview.problems.length > 0 ? (
            <Card pad="roomy" className="flex flex-col gap-2">
              <SectionHeader
                title="Алгасах мөрүүд"
                lede="Файлаа засаад дахин оруулж болно. Бүртгэгдсэн хүүхэд дахин үүсэхгүй."
              />
              <ul className="flex flex-col gap-1.5">
                {preview.problems.map((problem, index) => (
                  <li key={index} className="text-body text-ink">
                    <span className="text-caption text-muted">мөр {problem.rowNumber}</span>{" "}
                    {problem.message}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={run.isPending || preview.willImport === 0 || !file}
              onClick={() => file && run.mutate({ chosen: file, dryRun: false })}
            >
              {run.isPending ? "Бүртгэж байна…" : `${preview.willImport} хүүхэд бүртгэх`}
            </Button>
            <Button asChild variant="ghost">
              <Link href="/children">Болих</Link>
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Figure({
  tone,
  icon,
  value,
  label,
}: {
  tone: "mint" | "sun";
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={tone === "mint" ? "text-mint-ink" : "text-sun-ink"}>{icon}</span>
      <span className="text-figure font-semibold text-ink">{value}</span>
      <span className="text-body text-muted">{label}</span>
    </div>
  );
}
