"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { z } from "zod";
import { artworkTimelineSchema, type ArtworkComparison } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
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

  const timeline = useQuery({
    queryKey: qk.artwork(childId),
    queryFn: () => get(`/children/${childId}/artwork`, artworkTimelineSchema),
  });

  if (timeline.isPending) return <LoadingState rows={3} />;
  if (timeline.isError) return <ErrorState description={errorMessage(timeline.error)} />;

  const { artwork, comparisons } = timeline.data;

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
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
          title="Бүтээлүүд"
          lede="Хийсэн огноогоор эрэмбэлэгдсэн."
        />

        {artwork.length === 0 ? (
          <EmptyState
            title="Бүтээл алга"
            description={
              isStaff
                ? "Зургийн цомогт «Бүтээл» ангилалтай зураг нэмбэл энд харагдана."
                : "Багш бүтээлийн зураг нэмсний дараа энд харагдана."
            }
          />
        ) : (
          <ul className="flex flex-wrap gap-3">
            {artwork.map((work) => {
              const isSelected = selected.includes(work.id);
              return (
                <li key={work.id}>
                  {/*
                    A real button when it does something, a plain figure when it
                    does not — a guardian tapping an inert control learns the app
                    is broken.
                  */}
                  {isStaff ? (
                    <button
                      type="button"
                      onClick={() => toggle(work.id)}
                      aria-pressed={isSelected}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-control border-2 p-1.5 transition-colors",
                        isSelected ? "border-primary bg-primary-soft" : "border-transparent",
                      )}
                    >
                      <MediaThumb
                        mediaId={work.id}
                        caption={work.caption ?? "Бүтээл"}
                        className="h-24 w-24"
                      />
                      <span className="text-caption text-muted">
                        {work.takenAt ? formatDate(work.takenAt) : "Огноогүй"}
                      </span>
                    </button>
                  ) : (
                    <figure className="flex flex-col items-center gap-1 p-1.5">
                      <MediaThumb
                        mediaId={work.id}
                        caption={work.caption ?? "Бүтээл"}
                        className="h-24 w-24"
                      />
                      <figcaption className="text-caption text-muted">
                        {work.takenAt ? formatDate(work.takenAt) : "Огноогүй"}
                      </figcaption>
                    </figure>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {isStaff && selected.length === 2 ? (
          <ComparisonForm
            childId={childId}
            mediaIds={selected as [string, string]}
            onDone={() => setSelected([])}
          />
        ) : isStaff && artwork.length >= 2 ? (
          <p className="text-caption text-muted" role="status">
            Харьцуулах хоёр бүтээлээ сонгоно уу. ({selected.length}/2)
          </p>
        ) : null}
      </section>

      <section aria-labelledby="artwork-comparisons-heading" className="flex flex-col gap-3">
        <SectionHeader id="artwork-comparisons-heading" title="Хөгжлийн харьцуулалт" />

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
      </section>
    </div>
  );
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
              {comparison.earlierMedia.takenAt
                ? formatDate(comparison.earlierMedia.takenAt)
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
              {comparison.laterMedia.takenAt
                ? formatDate(comparison.laterMedia.takenAt)
                : "Огноогүй"}
            </figcaption>
          </figure>
        </div>

        <p className="whitespace-pre-wrap text-body text-ink">{comparison.conclusion}</p>

        <div className="flex flex-wrap items-center gap-2">
          {comparison.author ? (
            <span className="text-caption text-muted">
              {comparison.author.lastName} {comparison.author.firstName}
            </span>
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
  onDone,
}: {
  childId: string;
  mediaIds: [string, string];
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
