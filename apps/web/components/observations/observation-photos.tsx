"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { mediaSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Card, SectionHeader } from "@/components/ui/card";
import { MediaThumb } from "@/components/media/media-image";
import { PhotoUpload } from "@/components/media/photo-upload";

const listSchema = z.array(mediaSchema);

/**
 * Attach photos to an observation.
 *
 * The picking, the size check, the sequential upload and the retry all live in
 * `PhotoUpload` — see the notes there for why uploads go through the API and
 * why they are not parallel. This component is the observation-shaped view of
 * it: the photos already attached, plus a way to add more.
 */
export function ObservationPhotos({
  childId,
  observationId,
}: {
  childId: string;
  observationId: string;
}) {
  const photos = useQuery({
    queryKey: qk.childMedia(childId),
    queryFn: () => get(`/children/${childId}/media?purpose=OBSERVATION`, listSchema),
  });

  const attached = (photos.data ?? []).filter((m) => m.observationId === observationId);

  return (
    <section aria-labelledby="photos-heading">
      <SectionHeader title="Зураг" as="h2" />

      <Card className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        {attached.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {attached.map((photo) => (
              <li key={photo.id}>
                <MediaThumb mediaId={photo.id} caption={photo.caption} />
              </li>
            ))}
          </ul>
        ) : null}

        <PhotoUpload childId={childId} observationId={observationId} purpose="OBSERVATION" />
      </Card>
    </section>
  );
}
