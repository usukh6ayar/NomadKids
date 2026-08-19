"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, RotateCw } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { mediaSchema } from "@kinder/contracts";
import { mutate, get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { FormError } from "@/components/ui/states";
import { MediaThumb } from "@/components/media/media-image";

const listSchema = z.array(mediaSchema);

/** The API's own ceiling. Checked here too, so a 12 MB photo fails instantly. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Attach photos to an observation.
 *
 * ★ Uploaded through the API, never straight to the bucket. A presigned PUT
 * would hand the browser a URL it could write anything to, and content
 * sniffing, size limits and EXIF stripping cannot be enforced on the far side
 * of one — so the file goes through `POST /children/:id/media`, which does all
 * three (docs/SECURITY.md, D10).
 *
 * One file at a time, sequentially. The API rate-limits uploads per user, and
 * firing eight parallel requests is the reliable way to trip that limit and
 * have most of them fail.
 */
export function ObservationPhotos({
  childId,
  observationId,
}: {
  childId: string;
  observationId: string;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  /** The file that failed, kept so "retry" does not need it re-picked. */
  const [failed, setFailed] = useState<File | null>(null);

  const photos = useQuery({
    queryKey: qk.childMedia(childId),
    queryFn: () => get(`/children/${childId}/media?purpose=OBSERVATION`, listSchema),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("observationId", observationId);
      // No Content-Type is set: the browser must add the multipart boundary.
      return mutate(`/children/${childId}/media`, mediaSchema, { method: "POST", body: form });
    },
    onSuccess: () => {
      setFailed(null);
      void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
    },
    onError: (_error, file) => setFailed(file),
  });

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setLocalError(null);

    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setLocalError(
          `"${file.name}" хэт том байна. Дээд хэмжээ ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        );
        continue;
      }
      // Awaited in sequence — see the note above about the rate limit.
      await upload.mutateAsync(file).catch(() => undefined);
    }

    // Cleared so picking the same file again still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
  }

  const attached = (photos.data ?? []).filter((m) => m.observationId === observationId);

  return (
    <section aria-labelledby="photos-heading">
      <SectionHeader title="Зураг" as="h2" />

      <Card className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <FormError message={localError ?? (upload.isError ? errorMessage(upload.error) : null)} />

        {attached.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {attached.map((photo) => (
              <li key={photo.id}>
                <MediaThumb mediaId={photo.id} caption={photo.caption} />
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {/*
            A real <input type="file"> behind a label, not a div with a click
            handler: the native control is keyboard-reachable and opens the
            phone's camera roll with the OS picker.
          */}
          <input
            ref={inputRef}
            id="observation-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <Button asChild variant="secondary" disabled={upload.isPending}>
            <label htmlFor="observation-photo-input" className="cursor-pointer">
              <ImagePlus size={18} />
              {upload.isPending ? "Илгээж байна…" : "Зураг нэмэх"}
            </label>
          </Button>

          {failed && !upload.isPending ? (
            <Button variant="secondary" onClick={() => upload.mutate(failed)}>
              <RotateCw size={18} />
              Дахин илгээх
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-muted">
          JPEG, PNG эсвэл WebP. Нэг зураг дээд тал нь {MAX_UPLOAD_BYTES / 1024 / 1024} MB.
        </p>

        {upload.isPending ? (
          <p role="status" className="sr-only">
            Зураг илгээж байна
          </p>
        ) : null}
      </Card>
    </section>
  );
}
