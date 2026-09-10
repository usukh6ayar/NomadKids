"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, type ReactNode } from "react";
import type { EsisField } from "@kinder/contracts";
import { Card } from "@/components/ui/card";
import { TableShell, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The columns a service's records are shown under.
 *
 * ★ Ingested outputs, or — for the one write service — the inputs it sends.
 * `saveAttendanceV3` has no outputs at all, and a screen that answered "what
 * does this service carry?" with an empty table would be the only service on
 * the page that demonstrates nothing.
 */
export function esisSampleColumns(fields: EsisField[]): EsisField[] {
  const outputs = fields.filter((field) => field.io === "OUTPUT" && field.ingested);
  return outputs.length > 0 ? outputs : fields.filter((field) => field.io === "INPUT");
}

/**
 * How many of a service's fields the table itself shows.
 *
 * ★★★ **The table no longer scrolls sideways — 2026-09-09, at the client's
 * instruction: "хүснэгтүүдийг зүгээр энгийн харагдуул. хажуу тийшээ scroll
 * ntr хийхгүй."**
 *
 * What stood here was `rowTableWidth`, which set a floor of 720, 1400 or
 * 2400 pixels by column count so that a 27-column staff service scrolled
 * rather than squeezed. That was the right call while the table was the only
 * view of a record: dropping columns would have dropped what the service
 * carries, and the panel exists to show exactly that.
 *
 * The floor can go now because the columns did not have to. A row opens
 * (`EsisRowValues` below) into the complete record, so the five here are a
 * summary rather than a truncation — every field is one press away, and the
 * fields that no longer fit across are precisely the ones the drill-down was
 * asked for.
 *
 * ★★★★ **Five is the count for the table; below `md` the same five stack** —
 * 2026-09-10. The table lays itself out as cards on a phone, one field per
 * line, so this number is no longer doing the work of keeping text from
 * collapsing to one word per column. It only decides how much of a record is
 * worth showing before the reader opens it. See `EsisRowValues`.
 */
const TABLE_COLUMNS = 5;

/** The columns the table draws. The opened row draws all of them. */
export function esisVisibleColumns(fields: EsisField[]): EsisField[] {
  return fields.slice(0, TABLE_COLUMNS);
}

/**
 * ESIS records — the demo set and a live response, through one component.
 *
 * ★ One component on purpose. If the demonstration drew its own view the two
 * would drift, and the first thing to drift would be which fields appear —
 * making the sample a promise the live view does not keep.
 *
 * ★★★ **A row opens — 2026-09-09, at the client's request:** "жагсаалт харах
 * дээр дандаа жагсаалт гэсэн api-ууд. дээр нь дарахад дэлгэрэнгүй ерөнхий
 * мэдээлэл байх." Pressing a row reveals the complete record beneath it, in
 * the same definition-list layout ★★ describes — so the drill-down introduces
 * no new visual language, it reaches the one-record view this component
 * already had. `renderDetail` extends it to a *second service* read for that
 * row, which is how `foodKit` and `foodKitProducts` are reachable without
 * asking a cook to type a ministry product code.
 *
 * ★★ **One record is a definition list; many are a table.** A single
 * organisation across 16 columns is a horizontal scrollbar with one row under
 * it — the reader drags sideways to answer "what is the хаяг?", which is the
 * wrong shape for a question about one thing. Stacked label-above-value is how
 * `/admin/kindergarten` already shows exactly this record, so ESIS's copy of it
 * reads the same way. A roster of ten children is the opposite case: columns
 * are compared downwards, and a table is the only thing that works.
 */
export function EsisRowValues({
  columns,
  rows,
  hrefs,
  linkField,
  renderDetail,
}: {
  columns: EsisField[];
  rows: Record<string, string | null>[];
  /**
   * Where each row leads, index-aligned with `rows`. `null` for a row that
   * leads nowhere.
   */
  hrefs?: (string | null)[];
  /**
   * Extra content for an opened row — another ESIS service, read for this
   * record.
   *
   * ★ Rendered *under* the record's own fields, so an opened row reads as one
   * thing: what ESIS holds about this product, then what its иж бүрдэл
   * contains. See `EsisDataPanel`'s `detail` prop, which is what supplies it.
   */
  renderDetail?: (row: Record<string, string | null>) => ReactNode;
  /**
   * Which column carries the link — the name, on a roster.
   *
   * ★ A real `<a>` in one cell, and the whole row clickable around it. The
   * anchor is what makes the destination reachable by keyboard, announced by a
   * screen reader and openable in a new tab; the row handler is a convenience
   * for a pointer, and repeats what the anchor already does rather than being
   * the only way in. Defaults to the first column when the caller does not say.
   */
  linkField?: string;
}) {
  const router = useRouter();
  const [openRow, setOpenRow] = useState<number | null>(null);

  if (rows.length === 1) return <EsisRecordFields columns={columns} row={rows[0]!} />;

  const shown = esisVisibleColumns(columns);
  const anchorColumn = shown.find((field) => field.name === linkField) ?? shown[0];

  /*
   * ★ A row does one thing or the other, never both.
   *
   * `/children`'s roster passes `hrefs` so a name leads to that child's own
   * page — which *is* the дэлгэрэнгүй for a child, and a better one than any
   * panel could draw. Where a row already leads somewhere, opening it in place
   * would put a second, worse answer under the first. So the link wins, and
   * expansion is for the rows that lead nowhere: the ministry's reference
   * data, which has no page of its own anywhere in this product.
   */
  const expandable = !hrefs;

  return (
    /*
      `min-w-0` rather than a pixel floor: with five columns the table fits its
      container at every width this product supports, so the wrapper's
      `overflow-x-auto` never has anything to scroll. `table-fixed` is what
      shares the width evenly between the columns, so one long value wraps
      inside its own cell instead of pushing the rest off the edge.

      ★★★★ **Below `md` the same table is laid out as cards — 2026-09-10, at
      the client's instruction:** "хойш гүйлгэхгүйгээр бүхэлдээ харуулдаг
      болгох", pointing at `/settings`'s Ажилтны бүртгэл as the shape to copy.

      Five columns are legible on a laptop and cramped on a phone, where each
      cell gets about sixty pixels and every value collapses to one word per
      line — which is what `truncate` was hiding, and why a value could not be
      read to its end.

      `stacked` is what does it, and the rule behind it lives once in
      `globals.css` rather than as eight `max-md:` utilities spread across this
      table — see its note. All this file owes it is a `data-label` on every
      cell, which is the column heading the phone layout shows in place of the
      hidden `thead`.
    */
    <TableShell
      caption="ESIS сервисийн мөрүүд"
      minWidth="min-w-0"
      tableClassName="table-fixed"
      stacked
    >
      <thead>
        <tr>
          {shown.map((field) => (
            <Th key={field.name} className="whitespace-normal break-words">
              {field.label}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const href = hrefs?.[index] ?? null;
          const isOpen = openRow === index;

          return (
            <Fragment key={index}>
              <tr
                className={cn(
                  (href || expandable) && "cursor-pointer transition-colors hover:bg-canvas",
                  isOpen && "bg-canvas",
                )}
                // The opened panel is a sibling row rather than a child, so
                // `aria-expanded` on the row is what tells a screen reader the
                // press did something.
                aria-expanded={expandable ? isOpen : undefined}
                onClick={(event) => {
                  // The anchor inside handles its own click, including ⌘-click
                  // and "open in new tab". Only bare clicks on the rest of the
                  // row need handling here.
                  if (event.defaultPrevented) return;
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if ((event.target as HTMLElement).closest("a")) return;
                  if (window.getSelection()?.toString()) return;
                  if (href) router.push(href);
                  else if (expandable) setOpenRow(isOpen ? null : index);
                }}
              >
                {shown.map((field) => {
                  const value = row[field.name] ?? "—";
                  const isAnchor = href && field.name === anchorColumn?.name;
                  return (
                    <Td key={field.name} data-label={field.label} className="align-top break-words">
                      {isAnchor ? (
                        <Link href={href} className="font-medium text-ink hover:underline">
                          {value}
                        </Link>
                      ) : (
                        value
                      )}
                    </Td>
                  );
                })}
              </tr>

              {expandable && isOpen ? (
                <tr>
                  <td colSpan={shown.length} className="border-b border-border bg-canvas p-3">
                    <div className="flex flex-col gap-3">
                      {/*
                        Every field, including the ones the table does not
                        draw — this is the whole reason five columns is a
                        summary rather than a loss.
                      */}
                      <EsisRecordFields columns={columns} row={row} />
                      {renderDetail?.(row)}
                    </div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </TableShell>
  );
}

/**
 * One ESIS record, laid out the way `/admin/kindergarten` lays out its own.
 *
 * ★ Deliberately the same shape as that page's `DetailRow`: caption-sized muted
 * label, body-sized ink value, stacked. The point of this screen is "here is
 * what ESIS holds about your kindergarten", and the answer is easiest to check
 * when it looks like the page holding the local copy — a reader comparing the
 * two should not also be translating between two layouts.
 *
 * ★★ A field ESIS left empty says "Бөглөөгүй" rather than rendering blank, for
 * the reason that page gives: a bare dash leaves the reader unsure whether the
 * value is missing or the screen failed to load it.
 */
function EsisRecordFields({
  columns,
  row,
}: {
  columns: EsisField[];
  row: Record<string, string | null>;
}) {
  return (
    <Card pad="roomy">
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {columns.map((field) => {
          const value = row[field.name];
          return (
            <div key={field.name} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-caption text-muted">{field.label}</dt>
              <dd className={value ? "text-body break-words text-ink" : "text-body text-faint"}>
                {value || "Бөглөөгүй"}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
