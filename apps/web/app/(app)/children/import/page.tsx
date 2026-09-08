"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  ShieldCheck,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { z } from "zod";
import { esisOverviewSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
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
  const { primaryKindergartenId, hasRole } = useSession();
  const isAdmin = hasRole("ADMIN");
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [source, setSource] = useState<"excel" | "esis">("excel");

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
      <PageHeader title="Хүүхэд импортлох" />

      {isAdmin ? (
        <div
          role="tablist"
          aria-label="Импортын эх сурвалж"
          className="flex w-fit max-w-full gap-1 rounded-control border border-border bg-surface p-1"
        >
          <SourceTab
            active={source === "excel"}
            icon={<FileSpreadsheet size={17} aria-hidden />}
            onClick={() => setSource("excel")}
          >
            Excel
          </SourceTab>
          <SourceTab
            active={source === "esis"}
            icon={<Database size={17} aria-hidden />}
            onClick={() => setSource("esis")}
          >
            ESIS
          </SourceTab>
        </div>
      ) : null}

      {source === "esis" && isAdmin ? (
        <EsisImportEntry kindergartenId={primaryKindergartenId} />
      ) : (
        <>
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
                        <span className="text-caption text-muted">мөр {row.rowNumber}</span>{" "}
                        {row.name}
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
        </>
      )}
    </div>
  );
}

function SourceTab({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "inline-flex h-11 items-center gap-2 rounded-control px-5 text-body font-medium transition-colors " +
        (active
          ? "bg-primary text-primary-ink shadow-sm"
          : "text-muted hover:bg-canvas hover:text-ink")
      }
    >
      {icon}
      {children}
    </button>
  );
}

function EsisImportEntry({ kindergartenId }: { kindergartenId: string }) {
  const overview = useQuery({
    queryKey: qk.esis(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/esis`, esisOverviewSchema),
  });

  if (overview.isPending) return <LoadingState rows={2} shape="cards" />;
  if (overview.isError) {
    return <FormError message={errorMessage(overview.error)} />;
  }

  const data = overview.data;
  return (
    <div className="flex flex-col gap-4">
      <Card pad="roomy" tone={data.canPreview ? "mint" : "sun"}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className={data.canPreview ? "text-mint-ink" : "text-sun-ink"}
              aria-hidden
            />
            <div>
              <p className="text-title font-semibold text-ink">
                {data.canPreview ? "ESIS dry-run бэлэн" : "ESIS тохиргоо хүлээгдэж байна"}
              </p>
              <p className="mt-1 text-body text-muted">
                {data.canPreview
                  ? "Хүүхэд болон бүлгийн мэдээллийг эхлээд read-only байдлаар шалгана."
                  : data.blockers[0]}
              </p>
            </div>
          </div>
          <Button asChild>
            <Link href="/admin/integrations/esis">
              <Database aria-hidden /> ESIS удирдлага
            </Link>
          </Button>
        </div>
      </Card>

      <Card pad="roomy">
        <SectionHeader title="Импортын хамгаалалт" />
        <ol className="grid gap-3 md:grid-cols-3">
          {[
            ["1", "Preview", "ESIS мэдээллийг дотоод бүртгэлтэй тулгана."],
            ["2", "Зөрүү", "Давхардал, өөрчлөлтийг админ шийдвэрлэнэ."],
            ["3", "Батлах", "Зөвшөөрсний дараа л дотоод бүртгэлд бичнэ."],
          ].map(([number, title, description]) => (
            <li key={number} className="rounded-row bg-sunken p-4">
              <span className="text-caption font-semibold text-primary">{number}</span>
              <p className="mt-1 text-body font-semibold text-ink">{title}</p>
              <p className="mt-1 text-caption text-muted">{description}</p>
            </li>
          ))}
        </ol>
      </Card>
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
