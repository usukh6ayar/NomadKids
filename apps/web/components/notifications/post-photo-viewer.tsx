"use client";

import { PhotoLightbox } from "@/components/media/photo-lightbox";

/**
 * A post's photographs, large, one at a time — 2026-10-07, the client: a
 * post's pictures could not be opened "like Facebook".
 *
 * Shared by the feed and the post's own page so both page through the same
 * set the same way. No wrap-around: the first photo has no «‹» and the last
 * no «›», so a reader always knows where the set ends.
 */
export function PostPhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: { id: string; caption?: string | null }[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index];
  if (!photo) return null;
  const many = photos.length > 1;

  return (
    <PhotoLightbox
      mediaId={photo.id}
      caption={photo.caption}
      onClose={onClose}
      onPrev={index > 0 ? () => onIndex(index - 1) : undefined}
      onNext={index < photos.length - 1 ? () => onIndex(index + 1) : undefined}
      position={many ? `${index + 1} / ${photos.length}` : undefined}
    />
  );
}
