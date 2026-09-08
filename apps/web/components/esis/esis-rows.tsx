"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
 * A width class picked from a fixed set.
 *
 * ★ Not interpolated. Tailwind reads class names out of the source, so
 * `min-w-[${n}px]` compiles to no rule at all and a 27-column staff table
 * would squeeze instead of scrolling. Three literals cover every service.
 */
function rowTableWidth(columns: number): string {
  if (columns > 16) return "min-w-[2400px]";
  if (columns > 8) return "min-w-[1400px]";
  return "min-w-[720px]";
}

/**
 * ESIS records — the demo set and a live response, through one component.
 *
 * ★ One component on purpose. If the demonstration drew its own view the two
 * would drift, and the first thing to drift would be which fields appear —
 * making the sample a promise the live view does not keep.
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
}: {
  columns: EsisField[];
  rows: Record<string, string | null>[];
  /**
   * Where each row leads, index-aligned with `rows`. `null` for a row that
   * leads nowhere.
   */
  hrefs?: (string | null)[];
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

  if (rows.length === 1) return <EsisRecordFields columns={columns} row={rows[0]!} />;

  const anchorColumn = columns.find((field) => field.name === linkField) ?? columns[0];

  return (
    <TableShell caption="ESIS сервисийн мөрүүд" minWidth={rowTableWidth(columns.length)}>
      <thead>
        <tr>
          {columns.map((field) => (
            <Th key={field.name}>{field.label}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const href = hrefs?.[index] ?? null;
          return (
            <tr
              key={index}
              className={cn(href && "cursor-pointer transition-colors hover:bg-canvas")}
              onClick={
                href
                  ? (event) => {
                      // The anchor inside handles its own click, including
                      // ⌘-click and "open in new tab". Only bare clicks on the
                      // rest of the row need routing.
                      if (event.defaultPrevented) return;
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      if ((event.target as HTMLElement).closest("a")) return;
                      if (window.getSelection()?.toString()) return;
                      router.push(href);
                    }
                  : undefined
              }
            >
              {columns.map((field) => {
                const value = row[field.name] ?? "—";
                const isAnchor = href && field.name === anchorColumn?.name;
                return (
                  <Td key={field.name}>
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
