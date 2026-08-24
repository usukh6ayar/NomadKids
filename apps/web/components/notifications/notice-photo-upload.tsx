"use client";

import { useMutation } from "@tanstack/react-query";
import { ImagePlus, RotateCw } from "lucide-react";
import { useId, useRef, useState } from "react";
import { mediaSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/states";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/components/media/photo-upload";

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
}: {
  notificationId: string;
  onUploaded: (media: { id: string; caption?: string | null }) => void;
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

    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setLocalError(`"${file.name}" хэт том байна. Дээд хэмжээ ${MAX_MB} MB.`);
        continue;
      }
      await upload.mutateAsync(file).catch(() => undefined);
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <FormError message={localError ?? (upload.isError ? errorMessage(upload.error) : null)} />

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button asChild variant="secondary" disabled={upload.isPending}>
          <label htmlFor={inputId} className="cursor-pointer">
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

      <p className="text-caption text-muted">
        JPEG, PNG эсвэл WebP. Нэг зураг дээд тал нь {MAX_MB} MB.
      </p>

      {upload.isPending ? (
        <p role="status" className="sr-only">
          Зураг илгээж байна
        </p>
      ) : null}
    </div>
  );
}
