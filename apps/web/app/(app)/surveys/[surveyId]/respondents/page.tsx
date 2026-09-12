"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { z } from "zod";
import { CheckCircle2, Circle, Search } from "lucide-react";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { shortName } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Хариулсан хүүхдүүд — who has replied, and who has not.
 *
 * ★ A screen of its own — 2026-09-12, to the client's third drawing.
 *
 * It was a panel inside the survey board, opened beside the card, which made it
 * a list read in half a screen's width. This is a roster a teacher works
 * through with a phone in their hand — ringing the families in the second tab —
 * so it takes the width and a back arrow, like every other task screen here.
 *
 * ★★ An anonymous survey answers with counts and no names, and this screen says
 * so rather than rendering an empty roster. The API is the authority
 * (`SurveysService.participation`): both halves are withheld, because a list of
 * everybody who has *not* replied names the others by subtraction.
 */

const rowSchema = z.object({
  child: z.object({ id: z.string(), firstName: z.string(), lastName: z.string().nullish() }),
  group: z.object({ id: z.string(), name: z.string() }).nullish(),
});

const participationSchema = z.object({
  anonymous: z.boolean().default(false),
  answered: z.array(rowSchema.extend({ submittedAt: z.string() })).default([]),
  pending: z.array(rowSchema).default([]),
  answeredCount: z.number().default(0),
  roster: z.number().default(0),
});

type Tab = "all" | "done" | "todo";

export default function SurveyRespondentsPage() {
  const params = useParams<{ surveyId: string }>();
  const surveyId = params.surveyId;

  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");

  const participation = useQuery({
    queryKey: ["surveys", surveyId, "participation"],
    queryFn: () => get(`/surveys/${surveyId}/participation`, participationSchema),
  });

  const data = participation.data;

  /*
    One list, each row carrying whether it was answered — so the three tabs are
    a filter over one array rather than three arrays that can drift apart, and
    the "Бүгд" tab keeps the answered and the pending in one numbering.
  */
  const rows = useMemo(() => {
    if (!data) return [];
    return [
      ...data.answered.map((row) => ({ ...row, answered: true })),
      ...data.pending.map((row) => ({ ...row, answered: false })),
    ].sort((a, b) => shortName(a.child).localeCompare(shortName(b.child), "mn"));
  }, [data]);

  const needle = search.trim().toLocaleLowerCase("mn-MN");
  const visible = rows.filter((row) => {
    if (tab === "done" && !row.answered) return false;
    if (tab === "todo" && row.answered) return false;
    if (!needle) return true;
    return `${row.child.lastName ?? ""} ${row.child.firstName}`
      .toLocaleLowerCase("mn-MN")
      .includes(needle);
  });

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "Бүгд", count: rows.length },
    { key: "done", label: "Бөглөсөн", count: rows.filter((row) => row.answered).length },
    { key: "todo", label: "Бөглөөгүй", count: rows.filter((row) => !row.answered).length },
  ];

  return (
    <div className="flex flex-col gap-4 py-2">
      {/*
        The title sits beside the arrow rather than under it — the drawing's own
        header, and the one shape on this screen that says which survey's
        roster this is without a second line.
      */}
      <div className="flex items-center gap-2">
        <BackButton href={`/surveys/${surveyId}`} />
        <h1 className="min-w-0 flex-1 truncate text-center text-title font-semibold text-ink">
          Хариулсан хүүхдүүд
        </h1>
        {/* Balances the arrow, so the title is centred on the row. */}
        <span className="size-11 shrink-0" aria-hidden="true" />
      </div>

      {participation.isPending ? <LoadingState rows={6} /> : null}
      {participation.isError ? (
        <ErrorState description={errorMessage(participation.error)} />
      ) : null}

      {data?.anonymous ? (
        <EmptyState
          title="Нэргүй судалгаа"
          description="Энэ судалгаа нэрээ нууцлан бөглөгддөг тул хэн бөглөснийг харуулахгүй."
        />
      ) : null}

      {data && !data.anonymous ? (
        <>
          <div role="tablist" aria-label="Бөглөлтийн байдал" className="grid grid-cols-3 gap-2">
            {tabs.map((entry) => (
              <button
                key={entry.key}
                role="tab"
                type="button"
                aria-selected={tab === entry.key}
                onClick={() => setTab(entry.key)}
                className={cn(
                  "min-h-11 rounded-card px-2 text-body font-semibold transition-colors",
                  tab === entry.key
                    ? "bg-primary text-primary-contrast"
                    : "bg-canvas text-muted hover:text-ink",
                )}
              >
                {entry.label} ({entry.count})
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <label className="sr-only" htmlFor="respondent-search">
              Хүүхдийн нэрээр хайх
            </label>
            <Input
              id="respondent-search"
              value={search}
              placeholder="Хүүхдийн нэрээр хайх…"
              onChange={(event) => setSearch(event.target.value)}
              className="ps-9"
            />
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title="Хүүхэд олдсонгүй"
              description="Хайлт эсвэл шүүлтэд тохирох хүүхэд алга. Нэрээ цэвэрлэж үзнэ үү."
            />
          ) : (
            <Card pad="none" className="overflow-x-auto">
              <table className="w-full border-collapse text-body">
                <caption className="sr-only">Хариулсан хүүхдүүд</caption>
                <thead>
                  <tr className="border-b border-border text-caption text-muted">
                    <th scope="col" className="w-10 px-3 py-2 text-start font-medium">
                      №
                    </th>
                    <th scope="col" className="px-1 py-2 text-start font-medium">
                      Хүүхдийн нэр
                    </th>
                    <th scope="col" className="px-3 py-2 text-end font-medium">
                      Төлөв
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, index) => (
                    <tr key={row.child.id} className="border-b border-border-soft last:border-0">
                      <td className="px-3 py-2.5 text-caption tabular-nums text-muted">
                        {index + 1}
                      </td>
                      <th scope="row" className="px-1 py-2.5 text-start font-medium text-ink">
                        <span className="flex min-w-0 items-center gap-2.5">
                          {/*
                            Initials rather than a photo: this list is reached
                            from a results screen that has no media in it, and a
                            row of avatars would be a request per child.
                          */}
                          <span
                            aria-hidden="true"
                            className="grid size-8 shrink-0 place-items-center rounded-pill bg-sunken text-caption font-bold text-muted"
                          >
                            {(row.child.firstName[0] ?? "?").toUpperCase()}
                          </span>
                          <span className="min-w-0 truncate">{shortName(row.child)}</span>
                        </span>
                      </th>
                      <td className="px-3 py-2.5 text-end">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-caption font-medium",
                            row.answered ? "text-mint-ink" : "text-muted",
                          )}
                        >
                          {row.answered ? (
                            <CheckCircle2 size={15} aria-hidden="true" />
                          ) : (
                            <Circle size={15} aria-hidden="true" />
                          )}
                          {row.answered ? "Бөглөсөн" : "Бөглөөгүй"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
