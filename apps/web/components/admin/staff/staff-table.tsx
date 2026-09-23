"use client";

import { ChevronRight } from "lucide-react";
import { TableShell, Td, Th } from "@/components/ui/table";
import {
  STAFF_KIND_LABEL,
  displayName,
  positionLabel,
  staffStatus,
  type StaffDirectoryRow,
} from "./staff-model";
import { StaffSourceBadge, StaffStatusBadge } from "./staff-status";

/**
 * The staff directory, as a table.
 *
 * ★ **Six columns, and the fields a person has are not among them.** Every
 * value ESIS holds about a teacher — the instructor type, the заах аргын
 * нэгдэл, the job code, the years of service — is in the drawer. On the table
 * they would be nineteen columns that scroll sideways, which is the shape this
 * screen was rebuilt to stop being.
 *
 * ★★ `stacked`, so below `md` the rows lay out as cards instead of a grid
 * that scrolls. The client's rule since 2026-09-09 is no sideways scroll, and
 * `minWidth="min-w-0"` is what keeps a pixel floor from reintroducing one.
 */
export function StaffTable({
  rows,
  onOpen,
}: {
  rows: StaffDirectoryRow[];
  onOpen: (row: StaffDirectoryRow) => void;
}) {
  return (
    <TableShell caption="Багш, ажилтны жагсаалт" minWidth="min-w-0" stacked>
      <thead>
        <tr>
          <Th>Нэр</Th>
          <Th>Төрөл</Th>
          <Th>Албан тушаал</Th>
          <Th>Бүлэг</Th>
          <Th>Төлөв</Th>
          <Th className="w-10">
            <span className="sr-only">Дэлгэрэнгүй</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <StaffRow key={row.key} row={row} onOpen={() => onOpen(row)} />
        ))}
      </tbody>
    </TableShell>
  );
}

function StaffRow({ row, onOpen }: { row: StaffDirectoryRow; onOpen: () => void }) {
  const position = positionLabel(row);
  const status = staffStatus(row);

  return (
    /*
      ★ The row is clickable and the name inside it is a real `<button>`.

      Not one or the other: the pointer target has to be the whole row, because
      a 15px name is not what anybody aims at, and the keyboard target has to be
      a focusable control carrying the person's name, because `onClick` on a
      `<tr>` is invisible to a screen reader and unreachable by Tab. The same
      handler runs either way, and the button stops the row's handler firing
      twice for one press.
    */
    <tr
      onClick={onOpen}
      className="cursor-pointer transition-colors hover:bg-canvas"
      data-testid="staff-row"
    >
      <Td data-label="Нэр" className="font-medium text-ink">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="text-left text-primary hover:underline"
        >
          {displayName(row)}
        </button>
      </Td>
      <Td data-label="Төрөл" className="text-muted">
        {STAFF_KIND_LABEL[row.kind]}
      </Td>
      <Td data-label="Албан тушаал" className="text-muted">
        {position ?? <span className="text-faint">—</span>}
      </Td>
      {/*
        ★ "Бүлэггүй" rather than a dash, and only for a teacher.

        A dash in this column means two different things — a нягтлан has no
        group and never will, a багш with none cannot reach a single child —
        and only one of them is somebody's to-do. The дash stays for the staff
        it does not apply to; the teachers get the word.
      */}
      <Td data-label="Бүлэг">
        {row.assignedGroups.length > 0 ? (
          <span className="text-ink">
            {row.assignedGroups.map((group) => group.name).join(", ")}
          </span>
        ) : row.kind === "TEACHER" ? (
          <span className="text-sun-ink">Бүлэггүй</span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </Td>
      <Td data-label="Төлөв">
        <span className="flex flex-wrap items-center gap-1.5">
          <StaffStatusBadge status={status} />
          <StaffSourceBadge row={row} />
        </span>
      </Td>
      <Td data-label="" className="text-right">
        <ChevronRight size={16} aria-hidden="true" className="inline text-muted" />
      </Td>
    </tr>
  );
}
