"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check } from "lucide-react";
import {
  MAX_PAGE_SIZE,
  assessmentConfigSchema,
  observationSchema,
  paginated,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

const observationsSchema = paginated(observationSchema);

/**
 * Ticking the notes a term report is written from.
 *
 * ★ The client's 2026-09-11 ask, in their words: "өмнө нь бичсэн ажиглалтуудаа
 * шүүлтүүрдэж гарч ирэхээр нь чеклэж сонгоод дүгнэлт бичнэ."
 *
 * ★★ The selection is independent of the filter, deliberately.
 *
 * Narrowing to one strand must not silently drop the notes ticked under
 * another — a teacher writing about language and then about movement would
 * otherwise lose half their citation by changing a select. So the ticked set
 * lives above the filter, the count says how many are held, and anything ticked
 * but currently filtered out is still on its way to the server.
 *
 * ★★★ The strand filter goes to the server; the term filter does not.
 *
 * `Observation` carries no domains in its list shape, so `?domainId=` is the
 * only way to ask that question — while the term is a date range over rows this
 * screen already has, and refetching for it would be a request to answer
 * something already on screen.
 */
export function ReportNotePicker({
  childId,
  term,
  selected,
  onChange,
  disabled,
}: {
  childId: string;
  /** The term whose dates bound the list. */
  term: { id: string; name: string; startsOn?: string | null; endsOn?: string | null };
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { primaryKindergartenId } = useSession();
  /*
    ★ Reset by remounting, not by an effect — the caller keys this component on
    the term id.

    A strand chosen for one term means nothing in the next, and carrying it over
    would open the new term already filtered with no sign of why it looks empty.
    A `key` says that in one word where an effect would be three lines that also
    have to not fight the first render.
  */
  const [domainId, setDomainId] = useState("");

  const config = useQuery({
    queryKey: qk.assessmentConfig(primaryKindergartenId ?? ""),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/assessment-config`, assessmentConfigSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  const notes = useQuery({
    queryKey: qk.childObservations(childId, { pageSize: MAX_PAGE_SIZE, domainId }),
    queryFn: () =>
      get(
        `/children/${childId}/observations?page=1&pageSize=${MAX_PAGE_SIZE}` +
          (domainId ? `&domainId=${domainId}` : ""),
        observationsSchema,
      ),
  });

  const from = term.startsOn?.slice(0, 10) ?? "";
  const to = term.endsOn?.slice(0, 10) ?? "";
  const inTerm = (notes.data?.items ?? []).filter((row) => {
    const day = row.observedOn.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  });

  const ticked = new Set(selected);

  function toggle(id: string) {
    onChange(ticked.has(id) ? selected.filter((row) => row !== id) : [...selected, id]);
  }

  return (
    /*
      A named region, because the same notes are also drawn by the Ажиглалт tab
      further down the page: without a name, "the row about the tower" is
      ambiguous to a screen reader and to a test alike.
    */
    <Card
      role="group"
      aria-label="Дүгнэлтэд авах тэмдэглэлүүд"
      pad="roomy"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-ink">Дүгнэлтэд авах тэмдэглэлүүд</h2>
          <p className="text-caption text-muted">
            {term.name} · сонгосон {selected.length}
          </p>
        </div>

        <Field label="Сургалтын чиглэл" className="w-full sm:w-[240px]">
          {({ id }) => (
            <Select
              id={id}
              value={domainId}
              onChange={(e) => setDomainId(e.target.value)}
              disabled={disabled}
            >
              <option value="">Бүгд</option>
              {(config.data?.domains ?? []).map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {notes.isLoading ? <LoadingState rows={3} /> : null}
      {notes.isError ? <ErrorState description={errorMessage(notes.error)} /> : null}

      {notes.isSuccess && inTerm.length === 0 ? (
        <EmptyState
          title="Тэмдэглэл олдсонгүй"
          description={
            domainId
              ? "Энэ улиралд, энэ чиглэлээр бичсэн тэмдэглэл алга. Чиглэлээ солиод үзнэ үү."
              : "Энэ улиралд тэмдэглэл бичигдээгүй байна."
          }
        />
      ) : null}

      {inTerm.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border-soft">
          {inTerm.map((note) => {
            const on = ticked.has(note.id);

            return (
              <li key={note.id}>
                {/*
                  A label wrapping a real checkbox: the whole row is the target
                  (§5 — it works on a phone first) and the control stays a
                  checkbox for the keyboard and for a screen reader.
                */}
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 py-2.5 transition-colors",
                    disabled && "pointer-events-none opacity-50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled}
                    onChange={() => toggle(note.id)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-control border transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-ink"
                        : "border-border bg-surface",
                    )}
                  >
                    {on ? <Check size={13} strokeWidth={3} /> : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-caption text-muted">
                      {formatDayMonth(note.observedOn)}
                      {note.type?.name ? ` · ${note.type.name}` : ""}
                      {note.activityName ? ` · ${note.activityName}` : ""}
                    </span>
                    <span className="line-clamp-2 block text-body leading-snug text-ink">
                      {note.situation || "(тэмдэглэл хоосон)"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
