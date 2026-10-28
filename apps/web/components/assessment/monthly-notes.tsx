"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { MAX_PAGE_SIZE, groupObservationSchema, paginated } from "@kinder/contracts";
import type { GroupObservation } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { A79_STATUS_LABEL, a79Code, a79CriterionText } from "@/lib/a79-progress";
import { MediaThumb } from "@/components/media/media-image";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate, fullName, shortName } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The three kinds of note, told apart at a glance — Ажиглалт green, as drawn. */
function typeTone(name: string): string {
  const value = name.toLocaleLowerCase("mn-MN");
  if (value.includes("ярилц")) return "bg-sky text-sky-ink";
  if (value.includes("бүтээл")) return "bg-peach text-peach-ink";
  return "bg-mint text-ink";
}

/**
 * A month is a few pages at most; this is the ceiling, not the expectation. A
 * group writing past it in one month is told so rather than printed short.
 */
const MAX_PAGES = 10;

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * A note's text, in the order the form asks for it — printed as one passage,
 * without the form's own labels, as the client's card draws it.
 */
const NOTE_FIELDS = ["situation", "childDid", "childSaid", "teacherComment", "nextSteps"] as const;

/**
 * Every page of the month, in one array. The endpoint is paginated (§3.4) and
 * a print of page one alone would be a month with its last children missing.
 */
async function fetchMonth(groupId: string, from: string, to: string) {
  const items: GroupObservation[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await get(
      `/groups/${groupId}/observations?from=${from}&to=${to}&page=${page}&pageSize=${MAX_PAGE_SIZE}`,
      paginated(groupObservationSchema),
    );
    items.push(...res.items);
    if (page >= res.totalPages) return { items, truncated: false };
  }
  return { items, truncated: true };
}

/**
 * «Сарын тэмдэглэл» — 2026-10-28, the client: the month's teacher notes for the
 * whole group, below «Сарын тэмдэглэлийн хамралт», one fold and one total.
 *
 * ★ The lead teacher's alone, and the server decides it. Anyone else gets 404
 * from `GET /groups/:id/observations`, and this section then renders nothing —
 * the screen does not work out roles of its own (§1.1).
 *
 * ★★ No print button of its own — removed 2026-10-28, at the client's request,
 * with the page's.
 */
export function MonthlyNotes({
  groupId,
  startYear,
}: {
  groupId: string;
  /** The calendar year the school year opens in — September's year. */
  startYear: number;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [open, setOpen] = useState(false);

  const key = `${year}-${String(month).padStart(2, "0")}`;
  const lastDay = new Date(year, month, 0).getDate();
  const from = `${key}-01`;
  const to = `${key}-${String(lastDay).padStart(2, "0")}`;

  const notes = useQuery({
    queryKey: qk.groupMonthNotes(groupId, key),
    queryFn: () => fetchMonth(groupId, from, to),
    retry: (count, error) => !isNotFound(error) && count < 2,
  });

  // Not this group's lead teacher — the section is not theirs to see.
  if (notes.isError && isNotFound(notes.error)) return null;

  const years = [...new Set([startYear, startYear + 1, today.getFullYear()])].sort();
  const items = notes.data?.items ?? [];
  const title = `${year} оны ${month}-р сар`;

  /* Grouped by child; the server has already sorted by child, then date. */
  const byChild: { child: GroupObservation["child"]; notes: GroupObservation[] }[] = [];
  for (const note of items) {
    const last = byChild.at(-1);
    if (last && last.child.id === note.childId) last.notes.push(note);
    else byChild.push({ child: note.child, notes: [note] });
  }

  return (
    <Card pad="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="monthly-notes-body"
          className="flex min-h-10 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            size={18}
            aria-hidden="true"
            data-print-hide
            className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")}
          />
          <h3 className="text-body font-semibold text-ink">Бүлгийн явцын үнэлгээ</h3>
          <span className="whitespace-nowrap rounded-pill bg-sky px-2.5 py-0.5 text-caption font-semibold tabular-nums text-sky-ink">
            Нийт {notes.isPending ? "…" : items.length} тэмдэглэл
          </span>
        </button>

        <div data-print-hide className="flex items-center gap-2">
          <Select
            aria-label="Он сонгох"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            className="h-10 min-w-[88px] px-2 text-caption font-semibold"
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {value} он
              </option>
            ))}
          </Select>
          <Select
            aria-label="Сар сонгох"
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
            className="h-10 min-w-[96px] px-2 text-caption font-semibold"
          >
            {MONTHS.map((value) => (
              <option key={value} value={value}>
                {value}-р сар
              </option>
            ))}
          </Select>
        </div>
      </div>

      {open ? (
        <div id="monthly-notes-body" className="border-t border-border-soft">
          {notes.isPending ? (
            <div className="p-4">
              <LoadingState rows={3} />
            </div>
          ) : notes.isError ? (
            <div className="p-4">
              <ErrorState description={errorMessage(notes.error)} />
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-body text-muted">
              {title}д тэмдэглэл бичээгүй байна. Хүүхдийн нэр дээр дарж тэмдэглэл нэмнэ үү.
            </p>
          ) : (
            <>
              {notes.data.truncated ? (
                <p className="px-4 pt-3 text-caption text-sun-ink">
                  Энэ сард тэмдэглэл хэт олон тул эхний {items.length}-г харуулж байна.
                </p>
              ) : null}
              <ol className="divide-y divide-border-soft">
                {byChild.map(({ child, notes: childNotes }) => (
                  <li key={child.id} className="px-4 py-3 print:break-inside-avoid">
                    <h4 className="text-body font-semibold text-ink">
                      {fullName(child)}
                      <span className="ml-2 text-caption font-normal text-muted">
                        {childNotes.length} тэмдэглэл
                      </span>
                    </h4>
                    <ul className="mt-2 flex flex-col gap-3">
                      {childNotes.map((note) => (
                        /*
                          ★ The client's card, 2026-10-28: the photo first, then
                          one line of who/when/where, the note itself in bold,
                          the А/79 codes in the top corner and the author in the
                          bottom one.
                        */
                        <li
                          key={note.id}
                          className="flex flex-col gap-4 rounded-card bg-canvas p-4 text-caption sm:flex-row print:flex-row print:break-inside-avoid"
                        >
                          {note.photo ? (
                            <MediaThumb
                              mediaId={note.photo.id}
                              caption={note.photo.caption}
                              className="w-28 shrink-0 self-start print:w-24"
                            />
                          ) : null}
                          <div className="flex min-w-0 flex-1 flex-col gap-3">
                            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                              <p className="flex flex-wrap items-center gap-x-6 gap-y-1 italic text-muted">
                                <span
                                  className={cn(
                                    "rounded-pill px-2.5 py-0.5 not-italic",
                                    typeTone(note.type.name),
                                  )}
                                >
                                  {note.type.name}
                                </span>
                                <span className="tabular-nums">
                                  {formatDate(note.observedOn)}
                                  {note.observedTime ? ` ${note.observedTime}` : ""}
                                </span>
                                {note.activityName ? <span>{note.activityName}</span> : null}
                                {note.indicator ? <span>{note.indicator.code}</span> : null}
                              </p>
                              {note.a79Links.length > 0 ? (
                                <ul className="flex flex-col items-end italic text-muted">
                                  {note.a79Links.map((link) => (
                                    <li
                                      key={`${link.level}-${link.number}`}
                                      title={`${a79CriterionText(link.level, link.number)} — ${A79_STATUS_LABEL[link.status]}`}
                                    >
                                      {a79Code(link)}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                            <p className="whitespace-pre-line font-bold text-primary">
                              {NOTE_FIELDS.map((field) => note[field])
                                .filter(Boolean)
                                .join(" ")}
                            </p>
                            {note.author ? (
                              <p className="mt-auto text-right italic text-muted">
                                Бичсэн: {shortName(note.author)}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
