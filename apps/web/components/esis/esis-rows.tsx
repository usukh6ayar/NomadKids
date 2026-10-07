"use client";

import { formatDate } from "@/lib/format";

import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { Fragment, useId, useState, type ReactNode } from "react";
import type { EsisField } from "@kinder/contracts";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
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
      <span>{(field && esisDisplayValue(row[field.name])) || fallback}</span>
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
  columns: allColumns,
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
  const columns = withoutCodes(allColumns);
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

  /*
    ★★ **A table again — 2026-09-22**, the client: "Esis Эндээс орж ирсэн
    мэдээллүүд хэт том дөрвөлжин байж зай эзэлж байгаа тул хүснэгтэн хэлбэртэй
    зай бага эзлэхээр болох."

    Each record was an `<article>` two-to-a-row: a numbered pill, a `text-lead`
    title and a four-field `<dl>` underneath. That is roughly 150px of height
    per child, so the institution's 93 of them ran to some seven thousand
    pixels of scrolling to read a list of names.

    ★★★ **The 2026-09-09 constraint still holds, and it is the reason this is
    `TableShell` rather than a `<table>`:** "хүснэгтүүдийг зүгээр энгийн
    харагдуул. хажуу тийшээ scroll ntr хийхгүй". What produced that complaint
    was a pixel floor set by column count — 720, 1400 or 2400 — which made a
    wide service scroll sideways by construction.

    Three things keep both promises at once:

      · `minWidth="min-w-0"` — no floor. The columns fit or they wrap; nothing
        forces the page wider than the phone.
      · `stacked` — below `md` each row lays out as a card with its column name
        beside each value, so a narrow screen never scrolls sideways at all.
        That is what every `data-label` below is for.
      · five columns, not every field. `esisVisibleColumns` already chose them
        and the rest stay one press away, exactly as the card layout had it.

    So the mechanism changed and the contract did not: a reader still gets a
    readable summary, the full record on demand, and no horizontal scroll.
  */
  const cards = (
    <TableShell caption="ESIS мэдээлэл" minWidth="min-w-0" stacked>
      <thead>
        <tr>
          {/*
            The row number survives the move because in a table it costs one
            narrow column, where in a card it cost a 36px pill beside the name.
          */}
          <Th className="w-10">№</Th>
          {shown.map((field) => (
            <Th key={field.name}>{field.label}</Th>
          ))}
          {rowActions ? (
            <Th className="w-12">
              <span className="sr-only">Үйлдэл</span>
            </Th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {visible.map(({ row, index, href }) => {
          const primary = primaryField(shown, row, linkField);
          const hasSurname = primary?.name === "firstName" && Boolean(row.lastName);
          const additional = columns.filter(
            (field) => !shown.some((item) => item.name === field.name),
          );
          const expandable = !hrefs && (additional.length > 0 || Boolean(renderDetail));
          const isOpen = openRow === index;
          const detailId = `${detailBaseId}-${index}`;
          const span = shown.length + 1 + (rowActions ? 1 : 0);

          return (
            <Fragment key={index}>
              <tr className={isOpen ? "bg-primary-soft/20" : undefined}>
                <Td data-label="№" className="text-caption text-muted tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </Td>
                {shown.map((field) => {
                  const isPrimary = field.name === primary?.name;
                  /*
                    ★ The surname rides with the given name in the primary cell
                    and its own column is dropped — `RecordTitle`'s job in the
                    card layout, kept here so "Батбаяр" does not appear without
                    the "Ганболд" that tells two of them apart.
                  */
                  if (hasSurname && field.name === "lastName") return null;

                  if (!isPrimary) {
                    return (
                      <Td key={field.name} data-label={field.label}>
                        {esisDisplayValue(row[field.name]) || (
                          <span className="text-faint">Бөглөөгүй</span>
                        )}
                      </Td>
                    );
                  }

                  const title = (
                    <RecordTitle row={row} field={primary} fallback={`Бичлэг ${index + 1}`} />
                  );
                  return (
                    <Td
                      key={field.name}
                      data-label={field.label}
                      colSpan={hasSurname ? 2 : 1}
                      className="font-medium text-ink"
                    >
                      {href ? (
                        <Link
                          href={href}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {title}
                          <ArrowUpRight size={15} aria-hidden className="shrink-0" />
                        </Link>
                      ) : expandable ? (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={detailId}
                          onClick={() => setOpenRow(isOpen ? null : index)}
                          className="inline-flex items-center gap-1 text-left hover:text-primary"
                        >
                          {title}
                          <ChevronDown
                            size={15}
                            aria-hidden
                            className={cn("shrink-0 transition-transform", isOpen && "rotate-180")}
                          />
                        </button>
                      ) : (
                        title
                      )}
                    </Td>
                  );
                })}
                {rowActions ? (
                  <Td data-label="Үйлдэл" className="text-right">
                    {rowActions(row)}
                  </Td>
                ) : null}
              </tr>
              {expandable && isOpen ? (
                <tr id={detailId}>
                  {/*
                    ★ The detail is a row of its own spanning every column, not
                    a panel outside the table. Anything else would put the
                    record's own fields somewhere the row it belongs to cannot
                    be seen.
                  */}
                  <Td colSpan={span} className="bg-canvas">
                    <div className="flex flex-col gap-4">
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
                  </Td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </TableShell>
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
  /*
   * ★ One record about one person — 2026-09-29, from a walk through the
   * child's page as a director. It opened on "Бүртгэлийн дугаар
   * 100005421160086" as its title, then the institution code and the child's
   * ESIS number: three ids nobody reads, above the answer. They are dropped
   * here; a list keeps them, where telling rows apart is the point.
   *
   * ★★ `infoFlag1..13` and friends are labelled by their own key because ESIS
   * publishes no legend (`esis.fields.ts`, `studentStatistics`) — guessing one
   * would put a false fact about a family on screen. So they are not deleted
   * either: they fold under a line that says what they are.
   */
  const useful = columns.filter((field) => !TECHNICAL_ID.test(field.name));
  const undocumented = useful.filter((field) => UNDOCUMENTED_LABEL.test(field.label));
  const documented = useful.filter((field) => !UNDOCUMENTED_LABEL.test(field.label));
  const idOnlyTitle = useful.length !== columns.length;
  const primary = idOnlyTitle ? undefined : primaryField(columns, row, linkField);
  const hasSurname = primary?.name === "firstName" && Boolean(row.lastName);
  const facts = documented.filter(
    (field) => field.name !== primary?.name && !(hasSurname && field.name === "lastName"),
  );

  return (
    <article className="min-w-0 overflow-hidden rounded-row border border-border bg-surface">
      {primary ? (
        <div className="border-b border-border-soft bg-sky/30 px-4 py-4 sm:px-5">
          <p className="text-caption font-medium text-sky-ink">{primary.label}</p>
          <h3 className="mt-1 break-words text-title font-semibold text-ink">
            <RecordTitle row={row} field={primary} fallback="ЭСИС бүртгэл" />
          </h3>
          {href && primary.name === linkField ? (
            <Link
              href={href}
              className="mt-2 inline-flex items-center gap-1 text-caption font-semibold text-primary hover:underline"
            >
              Бүртгэл нээх <ArrowUpRight size={16} aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
      {facts.length > 0 ? (
        <div className="px-4 py-2 sm:px-5">
          <RecordFacts columns={facts} row={row} />
        </div>
      ) : null}
      {undocumented.length > 0 ? (
        <details className="border-t border-border-soft px-4 py-3 sm:px-5">
          <summary className="cursor-pointer text-body font-medium text-muted">
            ESIS-ийн тайлбаргүй {undocumented.length} код
          </summary>
          <p className="mt-2 text-caption text-muted">
            ESIS эдгээр талбарын утгыг тайлбарлаагүй тул нэрийг нь таамаглаж бичээгүй.
          </p>
          <div className="mt-3">
            <RecordFacts columns={undocumented} row={row} />
          </div>
        </details>
      ) : null}
    </article>
  );
}

/** Keys that identify a record rather than say anything about it. */
const TECHNICAL_ID = /^(institutionId|personId|student[A-Za-z]*Id)$/;

/**
 * Codes, ids and reference numbers — never drawn, in a list or a record.
 *
 * ★ Client, 2026-10-04: every service is connected now, so a reader is
 * always a director, teacher or parent, and "Бүлгийн код 4417" or a civil id
 * tells them nothing they can use. This replaces the 2026-09 instruction to
 * show every output value. Matched on the key *and* the label, because the
 * catalog names some codes plainly (`academicLevel` → "Түвшний код").
 *
 * The keys below end in Code or Number but carry a reading a person uses
 * (Хэмжих нэгж, Утас, Давхар), so they stay.
 */
const HIDDEN_KEY =
  /(Id|ID|_ID|Code|RegNumber|^registerNumber|^SERIAL_NUMBER|^OBJECT_VERSION_NUMBER|^orderNum)$/;
const HIDDEN_LABEL = /(код|дугаар|\bID)$/i;
/* `requestId` is an actionable number: APIs 167/170 cannot be used without it. */
const READABLE_KEY = /^(measureCode|phoneNumber|floorNumber|requestId)$/;

function withoutCodes(columns: EsisField[]): EsisField[] {
  return columns.filter(
    (field) =>
      READABLE_KEY.test(field.name) ||
      !(HIDDEN_KEY.test(field.name) || HIDDEN_LABEL.test(field.label.trim())),
  );
}
/** Labels `esis.fields.ts` gives fields ESIS never explained. */
const UNDOCUMENTED_LABEL = /^(Тэмдэглэгээ|Тэмдэглэл|Тоон утга) \d+$/;

/**
 * An ESIS value as a person reads it: `Y`/`true` → Тийм, `N`/`false` → Үгүй,
 * an ISO date → `2026.08.27`. Everything else as sent.
 */
export function esisDisplayValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const v = value.trim();
  if (/^(y|true)$/i.test(v)) return "Тийм";
  if (/^(n|false)$/i.test(v)) return "Үгүй";
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v))
    return formatDate(v.slice(0, 10));
  return v;
}

function RecordFacts({
  columns,
  row,
}: {
  columns: EsisField[];
  row: Record<string, string | null>;
}) {
  /*
   * ★ A compact two-column table, not a grid of tiles — 2026-09-30, the
   * client: ESIS-ээс орж ирсэн мэдээллүүд "хэт том дөрвөлжин байж зай эзэлж
   * байгаа тул хүснэгтэн хэлбэртэй зай бага эзлэхээр". Label | value, one
   * line each, two pairs across from `md` up.
   */
  const pairs: EsisField[][] = [];
  for (let i = 0; i < columns.length; i += 2) pairs.push(columns.slice(i, i + 2));
  return (
    <table className="w-full border-collapse text-body">
      <tbody>
        {pairs.map((pair) => (
          <tr
            key={pair.map((field) => field.name).join("|")}
            className="border-b border-border-soft last:border-b-0 max-md:flex max-md:flex-col"
          >
            {pair.map((field) => {
              const shown = esisDisplayValue(row[field.name]);
              return (
                <Fragment key={field.name}>
                  <th
                    scope="row"
                    className="w-[22%] py-1.5 pr-3 text-left align-top text-caption font-normal text-muted max-md:w-auto max-md:pb-0"
                  >
                    {field.label}
                  </th>
                  <td
                    className={
                      shown
                        ? "w-[28%] break-words py-1.5 pr-4 align-top font-medium text-ink max-md:w-auto"
                        : "w-[28%] py-1.5 pr-4 align-top text-faint max-md:w-auto"
                    }
                  >
                    {shown || "Бөглөөгүй"}
                  </td>
                </Fragment>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
