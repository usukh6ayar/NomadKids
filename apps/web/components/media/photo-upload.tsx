"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, RotateCw } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { mediaSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/states";

/** The API's own ceiling. Checked here too, so a 12 MB photo fails instantly. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

export const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

/**
 * Picking and uploading photos.
 *
 * ★ Uploaded through the API, never straight to the bucket.
 *
 * A presigned PUT would hand the browser a URL it could write anything to, and
 * content sniffing, the size limit and EXIF stripping cannot be enforced on the
 * far side of one. So the file goes through `POST /children/:id/media`, which
 * does all three — docs/SECURITY.md D10. EXIF matters more here than usual:
 * these are photographs of children, and a phone writes GPS coordinates into
 * them by default.
 *
 * ★★ One file at a time, sequentially. The API rate-limits uploads per user,
 * and firing eight parallel requests is the reliable way to trip that limit and
 * have most of them fail — which the user then reads as "the app is broken"
 * rather than "slow down".
 *
 * This was inlined in `ObservationPhotos`. It is shared now because the child
 * gallery and the profile picture need exactly the same behaviour, and three
 * copies of a sequential-upload-with-retry loop is three places to get the
 * error handling subtly different.
 */
export function PhotoUpload({
  childId,
  purpose,
  observationId,
  multiple = true,
  label = "Зураг нэмэх",
  hint,
  onUploaded,
  variant = "secondary",
  children,
}: {
  childId: string;
  purpose?: "CHILD_PHOTO" | "OBSERVATION";
  /** Attaches the upload to an observation. */
  observationId?: string;
  multiple?: boolean;
  label?: string;
  /** Replaces the default "JPEG, PNG or WebP…" line. Pass `null` for none. */
  hint?: ReactNode | null;
  onUploaded?: (mediaId: string) => void | Promise<void>;
  variant?: "primary" | "secondary";
  /** Extra controls rendered beside the button. */
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  /** The file that failed, kept so "retry" does not need it re-picked. */
  const [failed, setFailed] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      if (observationId) form.append("observationId", observationId);
      if (purpose) form.append("purpose", purpose);
      // No Content-Type is set: the browser must add the multipart boundary.
      return mutate(`/children/${childId}/media`, mediaSchema, { method: "POST", body: form });
    },
    onSuccess: async (media) => {
      setFailed(null);
      await onUploaded?.(media.id);
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
        setLocalError(`"${file.name}" хэт том байна. Дээд хэмжээ ${MAX_MB} MB.`);
        continue;
      }
      // Awaited in sequence — see the note above about the rate limit.
      await upload.mutateAsync(file).catch(() => undefined);
    }

    // Cleared so picking the same file again still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <FormError message={localError ?? (upload.isError ? errorMessage(upload.error) : null)} />

      <div className="flex flex-wrap items-center gap-2">
        {/*
          A real <input type="file"> behind a label, not a div with a click
          handler: the native control is keyboard-reachable and opens the
          phone's camera roll with the OS picker.
        */}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple={multiple}
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button asChild variant={variant} disabled={upload.isPending}>
          <label htmlFor={inputId} className="cursor-pointer">
            <ImagePlus size={18} />
            {upload.isPending ? "Илгээж байна…" : label}
          </label>
        </Button>

        {failed && !upload.isPending ? (
          <Button variant="secondary" onClick={() => upload.mutate(failed)}>
            <RotateCw size={18} />
            Дахин илгээх
          </Button>
        ) : null}

        {children}
      </div>

      {hint === null ? null : (
        <p className="text-xs text-muted">
          {hint ?? `JPEG, PNG эсвэл WebP. Нэг зураг дээд тал нь ${MAX_MB} MB.`}
        </p>
      )}

      {upload.isPending ? (
        // Announced, because the only visible signal is a button label that a
        // screen reader user is no longer focused on.
        <p role="status" className="sr-only">
          Зураг илгээж байна
        </p>
      ) : null}
    </div>
  );
}
