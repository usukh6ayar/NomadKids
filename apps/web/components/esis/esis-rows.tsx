"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { EsisField } from "@kinder/contracts";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

const ROWS_PER_PAGE = 25;
const SUMMARY_FIELDS = 5;

function primaryField(fields: EsisField[], row: Record<string, string | null>, linkField?: string) {
  return (
    fields.find((field) => field.name === linkField && row[field.name]) ??
    fields.find(
      (field) =>
        /^(firstName|displayName|productName|institutionName|studentGroupName|name|title)$/.test(
          field.name,
        ) && row[field.name],
    ) ??
    fields.find((field) => row[field.name]) ??
    fields[0]
  );
}

function RecordTitle({
  row,
  field,
  fallback,
}: {
  row: Record<string, string | null>;
  field: EsisField | undefined;
  fallback: string;
}) {
  const surname = field?.name === "firstName" ? row.lastName : null;
  return (
    <>
      {surname ? <span>{surname} </span> : null}
      <span>{(field && row[field.name]) || fallback}</span>
    </>
  );
}

export function esisSampleColumns(fields: EsisField[]): EsisField[] {
  const outputs = fields.filter((field) => field.io === "OUTPUT" && field.ingested);
  return outputs.length > 0 ? outputs : fields.filter((field) => field.io === "INPUT");
}

/** The catalog's summary order puts useful names before technical identifiers. */
export function esisVisibleColumns(fields: EsisField[]): EsisField[] {
  const declared = fields
    .filter((field) => field.summary !== undefined)
    .sort((a, b) => a.summary! - b.summary!);
  return declared.length > 0 ? declared : fields.slice(0, SUMMARY_FIELDS);
}

export function EsisRowValues({
  columns,
  rows,
  hrefs,
  linkField,
  renderDetail,
  rowActions,
}: {
  columns: EsisField[];
  rows: Record<string, string | null>[];
  hrefs?: (string | null)[];
  linkField?: string;
  renderDetail?: (row: Record<string, string | null>) => ReactNode;
  /**
   * A control in the card's header, beside the record's name.
   *
   * ★ Added 2026-09-20 at the client's request — "жагсаалтаас шууд зураг
   * нэмэх". It takes the **row** rather than an index so a caller cannot get
   * the pairing wrong after filtering or paging, which is the same hazard
   * `entries` exists to close for `hrefs`.
   *
   * ★★ Return `null` for a record with nothing to offer. A roster mixes
   * children this kindergarten has registered with children only ESIS knows
   * about, and a camera on the second kind would promise an upload with
   * nowhere to put it.
   */
  rowActions?: (row: Record<string, string | null>) => ReactNode;
}) {
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const detailBaseId = useId();

  if (rows.length === 1 && !renderDetail) {
    return (
      <EsisRecordFields columns={columns} row={rows[0]!} href={hrefs?.[0]} linkField={linkField} />
    );
  }

  const shown = esisVisibleColumns(columns);
  // Keep the destination with its original record through filtering and paging.
  const entries = rows.map((row, index) => ({ row, index, href: hrefs?.[index] ?? null }));
  const needle = query.trim().toLocaleLowerCase("mn-MN");
  const matched = needle
    ? entries.filter(({ row }) =>
        shown.some((field) => (row[field.name] ?? "").toLocaleLowerCase("mn-MN").includes(needle)),
      )
    : entries;
  const totalPages = Math.max(1, Math.ceil(matched.length / ROWS_PER_PAGE));
  const current = Math.min(page, totalPages);
  const visible = matched.slice((current - 1) * ROWS_PER_PAGE, current * ROWS_PER_PAGE);
  const searchable = rows.length > ROWS_PER_PAGE;

  const cards = (
    <div role="list" aria-label="ESIS мэдээлэл" className="grid gap-3 lg:grid-cols-2">
      {visible.map(({ row, index, href }) => {
        const primary = primaryField(shown, row, linkField);
        const hasSurname = primary?.name === "firstName" && Boolean(row.lastName);
        const summary = shown.filter(
          (field) => field.name !== primary?.name && !(hasSurname && field.name === "lastName"),
        );
        const additional = columns.filter(
          (field) => !shown.some((item) => item.name === field.name),
        );
        const expandable = !hrefs && (additional.length > 0 || Boolean(renderDetail));
        const isOpen = openRow === index;
        const detailId = `${detailBaseId}-${index}`;

        return (
          <article
            key={index}
            role="listitem"
            className={cn(
              "flex min-w-0 flex-col overflow-hidden rounded-row border bg-surface transition-colors",
              isOpen ? "border-primary/40" : "border-border hover:border-faint",
            )}
          >
            <div className="flex min-w-0 items-start gap-3 px-4 pt-4 sm:px-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-primary-soft text-caption font-semibold text-primary">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-caption text-muted">{primary?.label ?? "Бүртгэл"}</p>
                {href ? (
                  <Link
                    href={href}
                    className="mt-0.5 inline-flex items-start gap-1 break-words text-lead font-semibold text-primary hover:underline"
                  >
                    <RecordTitle row={row} field={primary} fallback={`Бичлэг ${index + 1}`} />
                    <ArrowUpRight size={17} aria-hidden className="mt-1 shrink-0" />
                  </Link>
                ) : expandable ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={detailId}
                    onClick={() => setOpenRow(isOpen ? null : index)}
                    className="mt-0.5 break-words text-left text-lead font-semibold text-ink hover:text-primary"
                  >
                    <RecordTitle row={row} field={primary} fallback={`Бичлэг ${index + 1}`} />
                  </button>
                ) : (
                  <p className="mt-0.5 break-words text-lead font-semibold text-ink">
                    <RecordTitle row={row} field={primary} fallback={`Бичлэг ${index + 1}`} />
                  </p>
                )}
              </div>

              {/*
                ★ Beside the name, not under the fields. The action belongs to
                the record, and the header is where the record is identified —
                putting it at the foot would read as an action on the summary
                below it.
              */}
              {rowActions ? <div className="shrink-0">{rowActions(row)}</div> : null}
            </div>
            {summary.length > 0 ? (
              <dl className="grid flex-1 gap-x-5 gap-y-3 px-4 py-4 sm:grid-cols-2 sm:px-5">
                {summary.map((field) => (
                  <div key={field.name} className="min-w-0">
                    <dt className="text-caption text-muted">{field.label}</dt>
                    <dd className="mt-0.5 break-words text-body font-medium text-ink">
                      {row[field.name] || "Бөглөөгүй"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="flex-1 pb-4" />
            )}
            {expandable ? (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={detailId}
                onClick={() => setOpenRow(isOpen ? null : index)}
                className="flex min-h-11 w-full items-center justify-between border-t border-border-soft px-4 text-left text-caption font-semibold text-primary hover:bg-primary-soft/40 sm:px-5"
              >
                {isOpen ? "Дэлгэрэнгүйг хураах" : "Дэлгэрэнгүй харах"}
                <ChevronDown
                  size={17}
                  aria-hidden
                  className={cn("transition-transform", isOpen && "rotate-180")}
                />
              </button>
            ) : null}
            {expandable && isOpen ? (
              <div
                id={detailId}
                className="flex flex-col gap-4 border-t border-border-soft bg-canvas p-4 sm:p-5"
              >
                {additional.length > 0 ? (
                  <div>
                    <p className="mb-3 text-caption font-semibold text-ink">
                      Нэмэлт мэдээлэл · {additional.length} талбар
                    </p>
                    <RecordFacts columns={additional} row={row} />
                  </div>
                ) : null}
                {renderDetail?.(row)}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );

  if (!searchable) return cards;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchField
          label={`Хайх: ${shown.map((field) => field.label).join(", ")}`}
          placeholder="Жагсаалтаас хайх"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
            setOpenRow(null);
          }}
        />
        <ResultCount total={matched.length} noun="бичлэг" />
      </div>
      {matched.length === 0 ? (
        <EmptyState
          title="Хайлтад тохирох бичлэг алга"
          description="Өөр үг оруулах эсвэл хайлтаа цэвэрлэнэ үү."
        />
      ) : (
        cards
      )}
      <Pagination page={current} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}

function EsisRecordFields({
  columns,
  row,
  href,
  linkField,
}: {
  columns: EsisField[];
  row: Record<string, string | null>;
  href?: string | null;
  linkField?: string;
}) {
  const primary = primaryField(columns, row, linkField);
  const hasSurname = primary?.name === "firstName" && Boolean(row.lastName);
  const facts = columns.filter(
    (field) => field.name !== primary?.name && !(hasSurname && field.name === "lastName"),
  );

  return (
    <article className="min-w-0 overflow-hidden rounded-row border border-border bg-surface">
      <div className="border-b border-border-soft bg-sky/30 px-4 py-4 sm:px-5">
        <p className="text-caption font-medium text-sky-ink">{primary?.label ?? "ЭСИС бүртгэл"}</p>
        <h3 className="mt-1 break-words text-title font-semibold text-ink">
          <RecordTitle row={row} field={primary} fallback="ЭСИС бүртгэл" />
        </h3>
        {href && primary?.name === linkField ? (
          <Link
            href={href}
            className="mt-2 inline-flex items-center gap-1 text-caption font-semibold text-primary hover:underline"
          >
            Бүртгэл нээх <ArrowUpRight size={16} aria-hidden />
          </Link>
        ) : null}
      </div>
      {facts.length > 0 ? (
        <div className="p-4 sm:p-5">
          <RecordFacts columns={facts} row={row} />
        </div>
      ) : null}
    </article>
  );
}

function RecordFacts({
  columns,
  row,
}: {
  columns: EsisField[];
  row: Record<string, string | null>;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      {columns.map((field) => {
        const value = row[field.name];
        return (
          <div key={field.name} className="min-w-0">
            <dt className="text-caption text-muted">{field.label}</dt>
            <dd
              className={
                value
                  ? "mt-1 break-words text-body font-medium text-ink"
                  : "mt-1 text-body text-faint"
              }
            >
              {value || "Бөглөөгүй"}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
