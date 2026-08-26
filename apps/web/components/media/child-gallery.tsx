"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { Star, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { mediaListSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { GALLERY } from "@/lib/vocabulary";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { MediaThumb } from "@/components/media/media-image";
import { PhotoUpload } from "@/components/media/photo-upload";

/**
 * ★ One page, deliberately large — an interim, not the destination.
 *
 * `GET /children/:id/media` is now paginated (it was not, and returned every
 * photograph a child had). This screen has no pager yet, so it asks for the
 * API's maximum and *says so* when there are more. Silently showing the first
 * twenty-five of ninety would be a worse regression than the unbounded list it
 * replaces, because nothing on screen would reveal it.
 */
const GALLERY_PAGE_SIZE = 100;

/**
 * A child's photographs and work.
 *
 * ★ Everything is here, whichever way it arrived: a photo attached to an
 * observation and a picture of a drawing uploaded on its own are the same thing
 * to a parent looking at their child's year. The API stores the difference as
 * `purpose`, and this reads both lists rather than making a family go to two
 * places for one idea.
 *
 * ★★ There is still no "artwork" *purpose*. `MediaPurpose` says how a
 * photograph got here, and adding a value to it is a schema migration; what
 * kind of picture it is now lives in `category` (RFP §4.4), which is a plain
 * column precisely so the vocabulary can change without one.
 *
 * Deleting archives rather than removing: `DELETE /media/:id` sets a status, so
 * a photo taken out of the gallery still exists for the audit trail.
 */
export function ChildGallery({
  childId,
  childName,
  canEdit,
  photoMediaFileId,
}: {
  childId: string;
  childName?: string;
  /** Staff and guardians who may record. Read-only viewers get the grid alone. */
  canEdit: boolean;
  /** The current profile picture, so it can be marked and not offered again. */
  photoMediaFileId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<string | null>(null);

  const photos = useQuery({
    queryKey: qk.childMedia(childId),
    queryFn: () => get(`/children/${childId}/media?pageSize=${GALLERY_PAGE_SIZE}`, mediaListSchema),
  });

  const setProfile = useMutation({
    mutationFn: (mediaId: string) =>
      mutate(`/children/${childId}/media/profile-photo`, z.unknown(), {
        method: "POST",
        body: { mediaId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
    },
  });

  const remove = useMutation({
    mutationFn: (mediaId: string) => mutate(`/media/${mediaId}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      setViewing(null);
      void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
    },
  });

  const items = photos.data?.items ?? [];
  const total = photos.data?.total ?? 0;
  const truncated = total > items.length;

  return (
    <section id="gallery" aria-labelledby="gallery-heading" className="scroll-mt-20">
      <SectionHeader
        id="gallery-heading"
        title={GALLERY}
        lede="Ажиглалтад хавсаргасан болон тусад нь нэмсэн бүх зураг."
        as="h2"
      />

      <Card pad="roomy" className="flex flex-col gap-4">
        {photos.isLoading ? <LoadingState rows={2} /> : null}

        {photos.isError ? <ErrorState description="Зургийг ачаалж чадсангүй." /> : null}

        {photos.data && items.length === 0 ? (
          <EmptyState
            icon={<Image src="/background/mascot-girl-purple.webp" alt="" width={96} height={96} />}
            title="Зураг алга"
            description={
              canEdit
                ? "Хүүхдийн бүтээл, тоглож буй мөчийг нэмж эхлээрэй."
                : "Багш зураг нэмэхэд энд харагдана."
            }
          />
        ) : null}

        {items.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {items.map((photo) => {
              const isProfile = photo.id === photoMediaFileId;
              return (
                <li key={photo.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setViewing(photo.id)}
                    // The grid is a set of buttons, not links: opening a photo
                    // is a state change on this page, and a link would put a
                    // presigned URL in the address bar.
                    className="block w-full overflow-hidden rounded-control focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <MediaThumb mediaId={photo.id} caption={photo.caption} />
                    <span className="sr-only">
                      {photo.caption || "Тэмдэглэлгүй зураг"} — томоор харах
                    </span>
                  </button>

                  {isProfile ? (
                    <span
                      className="absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-pill bg-primary text-primary-ink"
                      title="Хувийн зураг"
                    >
                      <Star size={13} aria-hidden="true" />
                      <span className="sr-only">Хувийн зураг</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {truncated ? (
          <p className="text-compact text-muted">
            Хамгийн сүүлийн {items.length} зураг харагдаж байна. Нийт {total}.
          </p>
        ) : null}

        {canEdit ? (
          <PhotoUpload
            childId={childId}
            purpose="CHILD_PHOTO"
            label="Зураг нэмэх"
            hint="Бүтээл, зурсан зураг, тоглож буй мөч. JPEG, PNG эсвэл WebP, 10 MB хүртэл."
          />
        ) : null}
      </Card>

      {viewing ? (
        <PhotoViewer
          mediaId={viewing}
          childName={childName}
          caption={items.find((p) => p.id === viewing)?.caption}
          canEdit={canEdit}
          isProfile={viewing === photoMediaFileId}
          onClose={() => setViewing(null)}
          onSetProfile={() => setProfile.mutate(viewing)}
          onRemove={() => remove.mutate(viewing)}
          busy={setProfile.isPending || remove.isPending}
        />
      ) : null}
    </section>
  );
}

/**
 * Full-size view.
 *
 * A thumbnail is a 100px crop of a drawing, which is not enough to see what a
 * child made. Escape closes it, focus is trapped by the backdrop being the only
 * other target, and the actions live here rather than on every tile — a delete
 * button on a grid of forty photos is forty chances to lose one by mistake.
 */
function PhotoViewer({
  mediaId,
  childName,
  caption,
  canEdit,
  isProfile,
  onClose,
  onSetProfile,
  onRemove,
  busy,
}: {
  mediaId: string;
  childName?: string;
  caption?: string | null;
  canEdit: boolean;
  isProfile: boolean;
  onClose: () => void;
  onSetProfile: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while this is open, or a phone drags the
    // list around underneath the photo.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption || `${childName ?? "Хүүхдийн"} зураг`}
      className="fixed inset-0 z-50 flex flex-col bg-ink/80 p-4"
    >
      {/* The backdrop closes it. `aria-hidden` because the ✕ below is the
          accessible way out and announcing a second one is noise. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      <div className="relative z-10 flex justify-end">
        <Button variant="secondary" size="icon" onClick={onClose} aria-label="Хаах">
          <X size={18} />
        </Button>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center py-3">
        {/* A plain <img>, not next/image: the src is a 302 to a presigned URL
            that expires in five minutes, so there is nothing for the optimiser
            to cache and it must not try. Same reasoning as `mediaUrl`. */}
        <img
          src={mediaUrl(mediaId)}
          alt={caption || `${childName ?? "Хүүхдийн"} зураг`}
          className="max-h-full max-w-full rounded-row object-contain"
        />
      </div>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 rounded-row bg-surface px-4 py-3">
        <p className="min-w-0 flex-1 text-body text-ink">
          {caption || <span className="text-muted">Тэмдэглэлгүй</span>}
        </p>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {isProfile ? (
              <span className="text-caption font-semibold text-primary">Хувийн зураг</span>
            ) : (
              <Button variant="secondary" size="sm" onClick={onSetProfile} disabled={busy}>
                <Star size={16} />
                Хувийн зураг болгох
              </Button>
            )}

            {confirming ? (
              // Confirmed inline rather than in a second dialog — CLAUDE.md §5
              // asks for a confirmation before a delete, not for a dialog on
              // top of a dialog.
              <span className="flex items-center gap-2">
                <span className="text-caption text-muted">Устгах уу?</span>
                <Button variant="danger" size="sm" onClick={onRemove} disabled={busy}>
                  Тийм
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Үгүй
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={busy}>
                <Trash2 size={16} />
                Устгах
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
