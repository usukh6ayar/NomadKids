"use client";

import { useQuery } from "@tanstack/react-query";
import { mediaListSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Card, SectionHeader } from "@/components/ui/card";
import { MediaThumb } from "@/components/media/media-image";
import { PhotoUpload } from "@/components/media/photo-upload";

/** The API's own ceiling per observation — one page always holds them all. */
const MAX_PHOTOS_PER_OBSERVATION = 12;

/**
 * Attach photos to an observation.
 *
 * The picking, the size check, the sequential upload and the retry all live in
 * `PhotoUpload` — see the notes there for why uploads go through the API and
 * why they are not parallel. This component is the observation-shaped view of
 * it: the photos already attached, plus a way to add more.
 *
 * ★ The filtering is the API's, not this component's.
 *
 * It used to fetch every `OBSERVATION` photograph the child had and keep the
 * ones matching `observationId` in the browser. That was wasteful while the
 * endpoint was unbounded and became *wrong* the moment it was paginated: page
 * one of twenty-five may contain none of this observation's photos, and the
 * section would render empty with no error to explain it. `?observationId=`
 * exists for exactly this reason.
 */
export function ObservationPhotos({
  childId,
  observationId,
}: {
  childId: string;
  observationId: string;
}) {
  const photos = useQuery({
    // Keyed by the observation too: two observations on one child are two
    // different requests now, and sharing a cache entry would show one the
    // other's photographs.
    queryKey: [...qk.childMedia(childId), observationId],
    queryFn: () =>
      get(
        `/children/${childId}/media?purpose=OBSERVATION&observationId=${observationId}&pageSize=${MAX_PHOTOS_PER_OBSERVATION}`,
        mediaListSchema,
      ),
  });

  const attached = photos.data?.items ?? [];

  return (
    <section aria-labelledby="photos-heading">
      <SectionHeader id="photos-heading" title="Зураг" as="h2" />

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
