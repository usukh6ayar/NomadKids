"use client";

import { useMutation } from "@tanstack/react-query";
import { ImagePlus, RotateCw } from "lucide-react";
import { useId, useRef, useState } from "react";
import { mediaSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/components/media/photo-upload";
import { shrinkIfTooLarge } from "@/lib/image-shrink";

const MAX_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/**
 * Photos on a class-board announcement.
 *
 * ★ A sibling of `PhotoUpload`, not a parameter of it.
 *
 * The two look alike and differ where it matters: this posts to
 * `/notifications/:id/media`, which is authorised by kindergarten membership,
 * while `PhotoUpload` posts to `/children/:id/media`, authorised per child.
 * Folding them into one component with a mode flag would put two authorization
 * paths behind one call site — the shape CLAUDE.md §1.1 exists to prevent, and
 * the kind of thing that goes wrong quietly.
 *
 * The behaviour that *is* shared — the size ceiling and the accepted types —
 * is imported rather than restated, so a change to the API's limit does not
 * need finding in two files.
 *
 * Sequential, for the reason given in `PhotoUpload`: the API rate-limits
 * uploads per user, and parallel requests are the reliable way to trip it.
 */
export function NoticePhotoUpload({
  notificationId,
  onUploaded,
  tile = false,
}: {
  notificationId: string;
  onUploaded: (media: { id: string; caption?: string | null }) => void;
  /**
   * Draws the control as a square, icon-only tile that sits in the photo grid
   * rather than as a labelled button under it — 2026-09-16, at the client's
   * request: "зураг нэмэх зурагтай нэг эгнээнд оруулаад зөвхөн айкон болго".
   *
   * ★ The word is not deleted, it moves to `aria-label`. The control is a
   * `<label>` for a file input, and a label with only a glyph inside is
   * announced as "button" — CLAUDE.md §5 asks for a name on every control
   * exactly so that the one way of adding a photograph is not the one thing a
   * reader cannot identify.
   */
  tile?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [failed, setFailed] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // No Content-Type: the browser must add the multipart boundary.
      return mutate(`/notifications/${notificationId}/media`, mediaSchema, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (media) => {
      setFailed(null);
      onUploaded(media);
    },
    onError: (_error, file) => setFailed(file),
  });

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setLocalError(null);

    /*
     * ★ Shrunk before it is measured — 2026-09-20. A phone shoots 8–12 MB
     * frames, so refusing past the ceiling meant refusing ordinary
     * photographs. Anything already under it is passed through untouched.
     */
    const chosen = await Promise.all(
      Array.from(files).map((file) => shrinkIfTooLarge(file, MAX_UPLOAD_BYTES)),
    );

    for (const file of chosen) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setLocalError(`"${file.name}" хэт том байна. Дээд хэмжээ ${MAX_MB} MB.`);
        continue;
      }
      await upload.mutateAsync(file).catch(() => undefined);
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    /*
      ★ `contents` in tile mode: the wrapper stops being a box so the tile
      lands in the caller's own grid, beside the photographs, instead of in a
      row of its own under them. The error still renders — it takes a whole
      grid row (`col-span-full`) rather than squeezing into one cell.
    */
    <div className={cn("flex flex-col gap-2", tile && "contents")}>
      <FormError
        className={tile ? "col-span-full" : undefined}
        message={localError ?? (upload.isError ? errorMessage(upload.error) : null)}
      />

      <div className={cn("flex flex-wrap items-center gap-2", tile && "contents")}>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {tile ? (
          <label
            htmlFor={inputId}
            aria-label={upload.isPending ? "Илгээж байна" : "Зураг нэмэх"}
            className={cn(
              "grid aspect-square cursor-pointer place-items-center rounded-control",
              "border border-dashed border-border bg-canvas text-muted",
              "transition-colors hover:border-primary hover:bg-primary-soft/40 hover:text-primary",
              upload.isPending && "pointer-events-none opacity-60",
            )}
          >
            <ImagePlus size={24} aria-hidden="true" />
          </label>
        ) : (
          <Button asChild variant="secondary" disabled={upload.isPending}>
            <label htmlFor={inputId} className="cursor-pointer">
              <ImagePlus size={18} />
              {upload.isPending ? "Илгээж байна…" : "Зураг нэмэх"}
            </label>
          </Button>
        )}

        {failed && !upload.isPending ? (
          <Button
            variant="secondary"
            size={tile ? "icon" : undefined}
            aria-label={tile ? "Дахин илгээх" : undefined}
            onClick={() => upload.mutate(failed)}
          >
            <RotateCw size={18} />
            {tile ? null : "Дахин илгээх"}
          </Button>
        ) : null}
      </div>

      {/*
        ★ The format-and-size line is gone — 2026-09-16, at the client's
        request. The file picker already offers only what `ACCEPTED_TYPES`
        names, and a file that is too large still says so where it matters:
        `handleFiles` rejects it by name into `FormError` above, which is the
        moment a teacher can act on it rather than a sentence they read past
        every time.
      */}

      {upload.isPending ? (
        <p role="status" className="sr-only">
          Зураг илгээж байна
        </p>
      ) : null}
    </div>
  );
}
