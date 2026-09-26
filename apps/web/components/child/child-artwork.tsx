"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, GitCompareArrows, Plus } from "lucide-react";
import { z } from "zod";
import { ARTWORK_TYPES, artworkTimelineSchema, type ArtworkComparison } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { formatDate, fullName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { MediaThumb } from "@/components/media/media-image";
import { cn } from "@/lib/utils";

/**
 * Artwork development comparison — RFP §5.3.
 *
 * ★ Selection is two taps on the timeline, not two dropdowns.
 *
 * The teacher is looking at the drawings while deciding which two to compare;
 * a pair of `<select>`s listing "зураг.jpg (2025-01-10)" would make them match
 * filenames to pictures they can already see. Tapping the works themselves is
 * both faster and the only version that works on a phone.
 *
 * ★★ The order the two are tapped in does not matter. The API sorts the pair by
 * when each work was made, so a teacher who taps the newer one first still gets
 * a comparison that reads forwards.
 */
export function ChildArtwork({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [comparing, setComparing] = useState(false);

  const timeline = useQuery({
    queryKey: qk.artwork(childId),
    queryFn: () => get(`/children/${childId}/artwork`, artworkTimelineSchema),
  });

  if (timeline.isPending) return <LoadingState rows={3} />;
  if (timeline.isError) return <ErrorState description={errorMessage(timeline.error)} />;

  const { artwork, comparisons } = timeline.data;
  const visibleArtwork = artwork.filter((work) => !typeFilter || artworkType(work) === typeFilter);
  const selectedType = artworkType(artwork.find((work) => work.id === selected[0]));
  const groupedArtwork = [...new Set(visibleArtwork.map((work) => artworkType(work)))]
    .sort((a, b) => {
      const aIndex = ARTWORK_TYPES.indexOf(a as (typeof ARTWORK_TYPES)[number]);
      const bIndex = ARTWORK_TYPES.indexOf(b as (typeof ARTWORK_TYPES)[number]);
      return (
        (aIndex < 0 ? ARTWORK_TYPES.length : aIndex) -
          (bIndex < 0 ? ARTWORK_TYPES.length : bIndex) || a.localeCompare(b, "mn")
      );
    })
    .map((type) => ({
      type,
      works: visibleArtwork.filter((work) => artworkType(work) === type),
    }));

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      const nextType = artworkType(artwork.find((work) => work.id === id));
      const currentType = artworkType(artwork.find((work) => work.id === current[0]));
      // A progress sequence compares like with like. Choosing another kind
      // begins a new sequence instead of producing a misleading pair.
      if (current.length > 0 && nextType !== currentType) return [id];
      // Two at a time: the third tap replaces the older selection rather than
      // refusing, which is what "I meant this one" looks like.
      return current.length < 2 ? [...current, id] : [current[1]!, id];
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="artwork-timeline-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="artwork-timeline-heading"
          title="Ахицын цуваа"
          lede="Төрөл бүрийн бүтээлийг хугацааны дарааллаар харж, шинэ бүтээл нэмнэ."
        />

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] max-w-xs flex-1">
            <Field label="Бүтээлийн төрөл">
              {({ id }) => (
                <Select
                  id={id}
                  value={typeFilter}
                  onChange={(event) => {
                    setTypeFilter(event.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="">Бүх төрөл</option>
                  {ARTWORK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {isStaff ? (
            <Button asChild>
              <Link href={newArtworkHref(childId, typeFilter)}>
                <Plus size={18} aria-hidden="true" />
                {typeFilter ? `${typeFilter} нэмэх` : "Шинэ бүтээл нэмэх"}
              </Link>
            </Button>
          ) : null}

          {isStaff && artwork.length >= 2 ? (
            <Button
              variant="secondary"
              aria-pressed={comparing}
              onClick={() => {
                setComparing((current) => !current);
                setSelected([]);
              }}
            >
              <GitCompareArrows size={18} aria-hidden="true" />
              {comparing ? "Харьцуулахаа болих" : "Харьцуулах"}
            </Button>
          ) : null}
        </div>

        {artwork.length === 0 ? (
          <EmptyState
            title="Бүтээл алга"
            description={
              isStaff
                ? "Шинэ бүтээл нэмэх товчоор анхны бүтээлээ оруулна уу."
                : "Багш бүтээлийн зураг нэмсний дараа энд харагдана."
            }
          />
        ) : visibleArtwork.length === 0 ? (
          <EmptyState title="Энэ төрлийн бүтээл алга" />
        ) : (
          <ul className="flex flex-col gap-4">
            {groupedArtwork.map(({ type, works }) => (
              <li key={type}>
                <Card pad="compact" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-body font-semibold text-ink">{type}</h3>
                      <p className="text-caption text-muted">{works.length} бүтээл</p>
                    </div>
                    {isStaff ? (
                      <Button asChild size="sm" variant="secondary">
                        <Link
                          href={newArtworkHref(childId, type)}
                          aria-label={`${type} төрлийн шинэ бүтээл нэмэх`}
                        >
                          <Plus size={16} aria-hidden="true" />
                          Шинэ бүтээл
                        </Link>
                      </Button>
                    ) : null}
                  </div>

                  <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {works.map((work) => {
                      const isSelected = selected.includes(work.id);
                      return (
                        <li
                          key={work.id}
                          className="relative rounded-card border border-border bg-surface p-2"
                        >
                          <figure className="flex flex-col gap-1.5">
                            <MediaThumb
                              mediaId={work.id}
                              caption={work.caption ?? "Бүтээл"}
                              className={cn(
                                "h-28 w-full border-2",
                                isSelected ? "border-primary" : "border-transparent",
                              )}
                            />
                            <figcaption className="text-caption text-muted">
                              {artworkDate(work) ? formatDate(artworkDate(work)!) : "Огноогүй"}
                            </figcaption>
                            {isStaff && comparing ? (
                              <button
                                type="button"
                                onClick={() => toggle(work.id)}
                                aria-pressed={isSelected}
                                aria-label={`${type} бүтээлийг харьцуулахад ${
                                  isSelected ? "хасах" : "сонгох"
                                }`}
                                className={cn(
                                  "absolute right-3 top-3 grid size-8 place-items-center rounded-pill border-2 shadow-sm",
                                  isSelected
                                    ? "border-primary bg-primary text-primary-ink"
                                    : "border-white bg-surface text-peach-solid",
                                )}
                              >
                                <Check size={17} aria-hidden="true" />
                              </button>
                            ) : null}
                          </figure>
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {isStaff && comparing && selected.length === 2 ? (
          <ComparisonForm
            childId={childId}
            mediaIds={selected as [string, string]}
            artworkType={selectedType}
            onDone={() => {
              setSelected([]);
              setComparing(false);
            }}
          />
        ) : isStaff && comparing ? (
          <p className="text-caption text-muted" role="status">
            {selected.length === 1
              ? `${selectedType}: дараагийн ижил төрлийн бүтээлээ сонгоно уу. (1/2)`
              : "Харьцуулах ижил төрлийн хоёр бүтээлээ сонгоно уу. (0/2)"}
          </p>
        ) : null}
      </section>

      {/*
        ★ Folded shut — 2026-09-16, the client: "хөгжлийн харьцуулалтыг
        дропдаун болгочих, ил байхаар олон юм харагдаад байна".

        Every comparison is two photographs side by side plus the teacher's
        note, so three of them is most of a screen below the timeline that is
        what this tab is for. The count sits on the row, which is the part a
        teacher is checking most of the time — whether there are any, and how
        many — and the pictures come out when they are being read.

        `Disclosure` is the product's own `<details>`: it opens with no
        JavaScript and the browser's find-in-page expands it to reveal a match
        inside, which a scripted accordion silently fails.
      */}
      <section aria-label="Хөгжлийн харьцуулалт">
        <Disclosure
          title="Хөгжлийн харьцуулалт"
          hint={
            comparisons.length > 0 ? `${comparisons.length} харьцуулалт` : "Харьцуулалт хийгээгүй"
          }
        >
          {comparisons.length === 0 ? (
            <EmptyState
              title="Харьцуулалт хийгээгүй"
              description="Хоёр бүтээлийг зэрэгцүүлж, ямар өөрчлөлт гарсныг тэмдэглэнэ."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {comparisons.map((comparison) => (
                <ComparisonCard
                  key={comparison.id}
                  childId={childId}
                  comparison={comparison}
                  isStaff={isStaff}
                />
              ))}
            </ul>
          )}
        </Disclosure>
      </section>
    </div>
  );
}

function newArtworkHref(childId: string, type: string): string {
  const query = new URLSearchParams({ type: "artwork", returnTo: "progress" });
  if (type) query.set("activityName", type);
  return `/children/${childId}/observations/new?${query.toString()}`;
}

function ComparisonCard({
  childId,
  comparison,
  isStaff,
}: {
  childId: string;
  comparison: ArtworkComparison;
  isStaff: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () =>
      mutate(`/artwork-comparisons/${comparison.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.artwork(childId) }),
  });

  return (
    <li>
      <Card pad="roomy" className="flex flex-col gap-3">
        <p className="text-caption font-semibold text-peach-solid">
          {artworkType(comparison.earlierMedia)}
        </p>
        {/*
          Side by side with an arrow between them — RFP §5.3's "зэрэгцүүлэн
          харах". The arrow carries the direction the dates already imply, so it
          is `aria-hidden`: a screen reader gets the two dated captions in
          reading order, which says the same thing better.
        */}
        <div className="flex items-center gap-3">
          <figure className="flex flex-1 flex-col items-center gap-1">
            <MediaThumb
              mediaId={comparison.earlierMedia.id}
              caption="Өмнөх бүтээл"
              className="h-28 w-full max-w-[140px]"
            />
            <figcaption className="text-caption text-muted">
              {artworkDate(comparison.earlierMedia)
                ? formatDate(artworkDate(comparison.earlierMedia)!)
                : "Огноогүй"}
            </figcaption>
          </figure>

          <ArrowRight size={20} aria-hidden="true" className="shrink-0 text-muted" />

          <figure className="flex flex-1 flex-col items-center gap-1">
            <MediaThumb
              mediaId={comparison.laterMedia.id}
              caption="Дараагийн бүтээл"
              className="h-28 w-full max-w-[140px]"
            />
            <figcaption className="text-caption text-muted">
              {artworkDate(comparison.laterMedia)
                ? formatDate(artworkDate(comparison.laterMedia)!)
                : "Огноогүй"}
            </figcaption>
          </figure>
        </div>

        <p className="whitespace-pre-wrap text-body text-ink">{comparison.conclusion}</p>

        <div className="flex flex-wrap items-center gap-2">
          {comparison.author ? (
            <span className="text-caption text-muted">{fullName(comparison.author)}</span>
          ) : null}

          {isStaff ? (
            <span className="ml-auto">
              <FormError message={remove.isError ? errorMessage(remove.error) : null} />
              {confirming ? (
                <span className="flex items-center gap-2">
                  <span className="text-caption text-muted">Устгах уу?</span>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    Тийм
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                    Үгүй
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                  Устгах
                </Button>
              )}
            </span>
          ) : null}
        </div>
      </Card>
    </li>
  );
}

function ComparisonForm({
  childId,
  mediaIds,
  artworkType: type,
  onDone,
}: {
  childId: string;
  mediaIds: [string, string];
  artworkType: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [conclusion, setConclusion] = useState("");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/artwork/comparisons`, z.unknown(), {
        method: "POST",
        // Sent as A and B, unlabelled: the API decides which is earlier from
        // when each work was made, so tapping order cannot invert the result.
        body: { mediaIdA: mediaIds[0], mediaIdB: mediaIds[1], conclusion: conclusion.trim() },
      }),
    onSuccess: () => {
      setConclusion("");
      void queryClient.invalidateQueries({ queryKey: qk.artwork(childId) });
      onDone();
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <Card pad="roomy">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }}
        className="flex flex-col gap-3"
        noValidate
      >
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
          }
        />

        <p className="text-body font-semibold text-peach-solid">{type} — ахицын цуваа</p>

        <Field
          label="Хөгжлийн өөрчлөлтийн дүгнэлт"
          error={errors.conclusion}
          hint="Хоёр бүтээлийн хооронд юу өөрчлөгдсөнийг бичнэ үү."
          required
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              rows={3}
              value={conclusion}
              onChange={(e) => setConclusion(e.target.value)}
              autoFocus
            />
          )}
        </Field>

        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Харьцуулалт хадгалах"}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Цуцлах
          </Button>
        </div>
      </form>
    </Card>
  );
}

function artworkType(
  work:
    | {
        observation?: { activityName?: string | null } | null;
      }
    | null
    | undefined,
): string {
  return work?.observation?.activityName?.trim() || "Төрөлгүй";
}

function artworkDate(
  work:
    | {
        takenAt?: string | null;
        observation?: { observedOn?: string | null } | null;
      }
    | null
    | undefined,
): string | null {
  return work?.takenAt ?? work?.observation?.observedOn ?? null;
}
