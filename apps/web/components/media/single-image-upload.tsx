"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { mediaSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/states";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/components/media/photo-upload";
import { cn } from "@/lib/utils";

const MAX_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/**
 * One image that replaces whatever was there — a kindergarten's logo, a staff
 * portrait, a group's class photo.
 *
 * ★ Not `PhotoUpload` with `multiple={false}`.
 *
 * That component is an *album* control: it batches, keeps a retry queue, and
 * reports per-file refusals, all of which exist because a teacher selects
 * twenty photographs at once. None of it applies to a field that holds exactly
 * one picture, and its API — `POST /children/:id/media`, keyed on a child — is
 * the wrong endpoint entirely. What is shared is the part worth sharing: the
 * accepted types and the size ceiling, imported rather than restated.
 *
 * ★★ The preview is `GET /v1/media/:id`, like every other image in this app.
 * A logo is not public: the bucket is private and the URL is presigned behind
 * an authorization check, so an `<img src>` pointing anywhere else would be the
 * one thing the media design forbids.
 */
export function SingleImageUpload({
  endpoint,
  currentMediaId,
  label,
  alt,
  hint,
  shape = "square",
  invalidateKeys = [],
  hidePreview = false,
}: {
  /** The API path that accepts the file, e.g. `/kindergartens/:id/logo`. */
  endpoint: string;
  /** What is shown now, if anything. */
  currentMediaId?: string | null;
  label: string;
  /** Required: this image carries meaning, so it needs a real description. */
  alt: string;
  hint?: ReactNode;
  /**
   * Draw only the control, not the 80px preview beside it.
   *
   * ★ For a surface that already shows the picture in its own way.
   *
   * The preview is a real drop target on a form, and its dashed placeholder
   * says "put something here". A profile header already draws the person — as
   * their photograph or, when there is none, as their initials — so a second
   * copy beside it is the same image twice, and the dashed version of it reads
   * as a broken one.
   */
  hidePreview?: boolean;
  /** A portrait is round; a logo and a class photo are not. */
  shape?: "square" | "round";
  /** Query keys to refetch once the server has the new file. */
  invalidateKeys?: readonly (readonly unknown[])[];
}) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // No Content-Type: the browser must add the multipart boundary itself.
      return mutate(endpoint, mediaSchema, { method: "POST", body: form });
    },
    onSuccess: () => {
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  function handleFile(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;

    setLocalError(null);

    // Checked here as well as on the server so an oversized file fails at once
    // rather than after a slow upload the API was always going to refuse.
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError(`Файл хэт том байна. Дээд хэмжээ ${MAX_MB} MB.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    upload.mutate(file, {
      // Cleared either way, so picking the same file again still fires a change
      // event — a retry after a server-side refusal is the common case.
      onSettled: () => {
        if (inputRef.current) inputRef.current.value = "";
      },
    });
  }

  // The freshly uploaded id wins, so the preview updates without waiting for
  // whichever query owns `currentMediaId` to come back.
  const shownId = upload.data?.id ?? currentMediaId ?? null;

  return (
    <div className="flex flex-col gap-2">
      <FormError message={localError ?? (upload.isError ? errorMessage(upload.error) : null)} />

      <div className="flex items-center gap-4">
        {hidePreview ? null : shownId ? (
          <img
            src={mediaUrl(shownId)}
            alt={alt}
            className={cn(
              "h-20 w-20 shrink-0 border border-line bg-surface object-contain",
              shape === "round" ? "rounded-pill object-cover" : "rounded-control",
            )}
          />
        ) : (
          <div
            aria-hidden="true"
            className={cn(
              "flex h-20 w-20 shrink-0 items-center justify-center border border-dashed border-line bg-surface text-faint",
              shape === "round" ? "rounded-pill" : "rounded-control",
            )}
          >
            <ImagePlus size={22} />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_TYPES}
            className="sr-only"
            onChange={(e) => handleFile(e.target.files)}
          />
          <Button
            asChild
            variant="secondary"
            size={hidePreview ? "sm" : "md"}
            disabled={upload.isPending}
          >
            <label htmlFor={inputId} className="cursor-pointer">
              <ImagePlus size={18} />
              {upload.isPending ? "Илгээж байна…" : shownId ? "Солих" : label}
            </label>
          </Button>
          {/*
            ★ No hint line without the preview.

            With the preview the pair is a form control and the hint is its help
            text. Without it — in a profile header, under a name — it is a third
            line under a button nobody has pressed yet, stating a limit the file
            picker enforces anyway.
          */}
          {hidePreview ? null : (
            <p className="text-caption text-muted">
              {hint ?? `JPEG, PNG эсвэл WebP. Дээд хэмжээ ${MAX_MB} MB.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
