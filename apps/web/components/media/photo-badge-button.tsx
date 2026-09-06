"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";
import { useId, useRef } from "react";
import { mediaSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/components/media/photo-upload";
import { useToast } from "@/components/ui/toast";

const MAX_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/**
 * A camera badge in the corner of a picture — press it to replace the picture.
 *
 * ★ Generalised from `child-photo-button.tsx` on 2026-09-06, at the client's
 * request: "зураг нэмэх гэж тусдаа button байхгүй, камерын зурагтай тэнд нь
 * дардаг болгоё".
 *
 * That component does the same thing for a child, and its own docblock already
 * made the argument this one is built on: the affordance every product uses for
 * changing a picture is a small camera on the corner of the image, and it costs
 * no layout, where a button beside it takes a line of its own. What it cannot
 * be reused for is any *other* owner — it is hard-wired to a child's two-step
 * upload-then-promote flow and to `qk.child`.
 *
 * This is the one-call version: an endpoint that takes the file and *is* the
 * save (`/users/:id/photo`, `/kindergartens/:id/logo`, `/groups/:id/photo`) —
 * exactly the endpoints `SingleImageUpload` was written for, drawn as a badge
 * instead of as a labelled button.
 *
 * ★★ A `<label>` driving a hidden `<input type="file">`, not a button that
 * clicks one. The native pairing gives the control a focus ring and an
 * accessible name for free, and lets a phone offer "take a photo" beside
 * "choose from library".
 *
 * ★★★ The caller positions it. It renders `absolute`, so the element around
 * the picture must be `relative` — which is the same contract
 * `ChildPhotoButton` has and the reason both are used inside a wrapper the
 * caller owns.
 */
export function PhotoBadgeButton({
  endpoint,
  label,
  invalidateKeys = [],
}: {
  /** The API path that accepts the file and stores it against its owner. */
  endpoint: string;
  /** Names the control — "Профайл зураг солих". Never just "Зураг". */
  label: string;
  /** Query keys to refetch once the server has the new file. */
  invalidateKeys?: readonly (readonly unknown[])[];
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // No Content-Type: the browser must add the multipart boundary itself.
      return mutate(endpoint, mediaSchema, { method: "POST", body: form });
    },
    onSuccess: () => {
      toast.success("Зураг солигдлоо.");
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function onPick(files: FileList | null) {
    const file = files?.[0];
    // Cleared before anything else, so choosing the same file twice in a row
    // still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    // Checked here as well as on the server: a 6 MB photograph from a phone
    // should be refused before it is uploaded, not after.
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`Зураг хэт том байна. Дээд хэмжээ ${MAX_MB} MB.`);
      return;
    }
    upload.mutate(file);
  }

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_TYPES}
        className="sr-only"
        disabled={upload.isPending}
        onChange={(e) => onPick(e.target.files)}
      />
      {/*
        `-bottom-1 -right-1` so the badge overlaps the picture's edge rather
        than sitting inside it, which is what keeps a 72px portrait readable.
        The ring separates it from whatever the photograph happens to be at
        that corner.
      */}
      <label
        htmlFor={inputId}
        aria-label={label}
        className="absolute -bottom-1 -right-1 grid size-8 cursor-pointer place-items-center rounded-pill bg-primary text-primary-ink ring-2 ring-surface transition-colors hover:bg-primary-hover"
      >
        {upload.isPending ? (
          <Loader2 size={15} aria-hidden="true" className="animate-spin" />
        ) : (
          <Camera size={15} aria-hidden="true" />
        )}
      </label>

      {upload.isPending ? (
        <span role="status" className="sr-only">
          Зураг илгээж байна
        </span>
      ) : null}
    </>
  );
}
