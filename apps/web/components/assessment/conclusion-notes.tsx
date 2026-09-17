"use client";

import { useState } from "react";
import { ArrowDownUp, Check } from "lucide-react";
import { z } from "zod";
import { observationSchema } from "@kinder/contracts";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { NoteCardFace } from "@/components/child/child-observations";
import { cn } from "@/lib/utils";

export type ConclusionNote = z.infer<typeof observationSchema>;

/**
 * Eight to a page — four rows of two, which is the client's drawing.
 *
 * Paged in the browser rather than by the server: the term's notes are already
 * in hand for the counts on the chips above, and asking again per page would
 * make a chip's number and the list under it able to disagree.
 */
const PAGE_SIZE = 8;

/**
 * Тэмдэглэлүүдээс сонгох — the half of the screen a conclusion is drawn from.
 *
 * ★ The client's 2026-09-14 design, in their own earlier words: "өмнө нь бичсэн
 * ажиглалтуудаа шүүлтүүрдэж гарч ирэхээр нь чеклэж сонгоод дүгнэлт бичнэ."
 *
 * ★★ The filters are **not** here — they belong to the screen.
 *
 * The term, the strand, the keyword and the kind chips narrow this list and
 * also fill the counts on the chips themselves, so they sit above both columns
 * and this component is handed the result. A picker that owned its own filter
 * could not have its count drawn anywhere but inside itself.
 *
 * ★★★ The selection is a controlled prop and outlives the filter.
 *
 * Narrowing to one strand must not silently untick what was chosen under
 * another — a teacher writing about language and then about movement would
 * otherwise lose half their citation by changing a select.
 */
export function ConclusionNotes({
  notes,
  selected,
  onToggle,
  disabled,
}: {
  /** Already filtered by the screen: term, strand, keyword and kind. */
  notes: ConclusionNote[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [newestFirst, setNewestFirst] = useState(true);

  const ticked = new Set(selected);
  const ordered = [...notes].sort((a, b) =>
    newestFirst
      ? b.observedOn.localeCompare(a.observedOn)
      : a.observedOn.localeCompare(b.observedOn),
  );

  const totalPages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  // A filter that shortens the list can leave the reader on a page past its
  // end; clamping here beats an effect that fights the first render.
  const current = Math.min(page, totalPages);
  const shown = ordered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    /*
      A named region: the conclusion beside it lists the same notes again, so
      "the row about the tower" has to be unambiguous to a screen reader and to
      a test alike.
    */
    <Card
      role="group"
      aria-label="Тэмдэглэлүүдээс сонгох"
      pad="roomy"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lead font-semibold text-ink">Тэмдэглэлүүдээс сонгох</h2>
        <button
          type="button"
          onClick={() => setNewestFirst((value) => !value)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-pill px-3 text-caption font-medium text-primary transition-colors hover:bg-primary-soft"
        >
          <ArrowDownUp size={15} aria-hidden="true" />
          {newestFirst ? "Шинэ нь эхэнд" : "Хуучин нь эхэнд"}
        </button>
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          title="Тэмдэглэл олдсонгүй"
          description="Улирал, чиглэл, түлхүүр үгээ өөрчилж үзнэ үү."
        />
      ) : (
        <>
          {/*
            ★ Two across at every width — the client, 2026-09-14, correcting
            their own "6 эгнээ" the same day: "утас вэб дээрээ ижил 2 эгнээ
            харагдах нь зөв юм байна."

            They are right, and the reason is the pane: this list shares its
            row with the conclusion being written, so six across would be six
            cards of about 110px — narrow enough that a card could not hold its
            own kind and date on one line.
          */}
          <ul className="grid grid-cols-2 gap-3">
            {shown.map((note) => {
              const on = ticked.has(note.id);

              return (
                <li key={note.id}>
                  {/*
                    ★ The same face as the Ажиглалт screen's card — the client,
                    2026-09-14: "ажиглалт дээрх тэмдэглэл шигээ загвараар".

                    A label wrapping a real checkbox: the whole card is the
                    target (§5 — a phone first) and the control stays a
                    checkbox for the keyboard and for a screen reader. The tick
                    sits over the corner the ⋮ menu uses on the other screen,
                    which is why the face keeps that corner clear.
                  */}
                  <label
                    className={cn(
                      "relative flex h-full cursor-pointer flex-col gap-2 rounded-card border bg-surface p-3 text-left transition-colors",
                      on ? "border-primary bg-primary-soft/40" : "border-border",
                      disabled && "pointer-events-none opacity-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled}
                      onChange={() => onToggle(note.id)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute right-2 top-2 grid size-6 place-items-center rounded-control border transition-colors",
                        on
                          ? "border-primary bg-primary text-primary-ink"
                          : "border-border bg-surface",
                      )}
                    >
                      {on ? <Check size={14} strokeWidth={3} /> : null}
                    </span>

                    {/*
                      No artwork stands in for a missing photograph here: the
                      client's card for this screen is text from the kind
                      straight to the note, and six across leaves no room for a
                      picture that carries nothing.
                    */}
                    <NoteCardFace
                      observation={note}
                      showTeacherMetadata
                      showPlaceholderArt={false}
                      reserveMenuSpace
                    />
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <ResultCount total={ordered.length} noun="тэмдэглэл" />
            <Pagination page={current} totalPages={totalPages} onPage={setPage} />
          </div>
        </>
      )}
    </Card>
  );
}
