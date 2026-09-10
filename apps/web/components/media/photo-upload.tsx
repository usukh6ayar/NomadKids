"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, RotateCw } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { mediaSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";

/** The API's own ceiling. Checked here too, so a 12 MB photo fails instantly. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/**
 * Files per request. Mirrors the API's own cap, which exists because multer
 * buffers every file in memory before the handler runs.
 *
 * A teacher selecting a whole morning's photographs should not have to know
 * that, so `handleFiles` slices the selection rather than refusing it.
 */
const MAX_FILES_PER_REQUEST = 6;

/** What the batch endpoint answers with: what it stored, and what it would not. */
const uploadResultSchema = z.object({
  items: z.array(mediaSchema),
  failed: z.array(z.object({ name: z.string(), reason: z.string() })),
});

export type PhotoUploadResult = z.infer<typeof uploadResultSchema>;

export const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

/**
 * Stores an already-picked set of photos, preserving the media endpoint's
 * six-files-per-request ceiling. Exported so a note form can create the note
 * and attach its selected photos behind one Save button.
 */
export async function uploadChildPhotos({
  childId,
  files,
  observationId,
  purpose,
}: {
  childId: string;
  files: File[];
  observationId?: string;
  purpose?: "CHILD_PHOTO" | "OBSERVATION" | "MILESTONE";
}): Promise<PhotoUploadResult> {
  const combined: PhotoUploadResult = { items: [], failed: [] };

  for (let index = 0; index < files.length; index += MAX_FILES_PER_REQUEST) {
    const form = new FormData();
    for (const file of files.slice(index, index + MAX_FILES_PER_REQUEST)) {
      form.append("file", file);
    }
    if (observationId) form.append("observationId", observationId);
    if (purpose) form.append("purpose", purpose);

    const result = await mutate(`/children/${childId}/media`, uploadResultSchema, {
      method: "POST",
      body: form,
    });
    combined.items.push(...result.items);
    combined.failed.push(...result.failed);
  }

  return combined;
}

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
 * ★★ The whole selection in one request, in batches of six, awaited in turn.
 *
 * The API rate-limits uploads per user, and this used to send one request per
 * photograph: twenty photographs on a class-board post spent a third of a
 * teacher's hourly budget and the rest of the morning was refused. Batching
 * makes that four requests. They are still awaited rather than fired together,
 * because parallel requests are the reliable way to trip the same limit and
 * have most of them fail — which a user reads as "the app is broken" rather
 * than "slow down".
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
  milestoneId,
  category,
  age,
  multiple = true,
  label = "Зураг нэмэх",
  hint,
  onUploaded,
  variant = "secondary",
  withCaption = false,
  children,
}: {
  childId: string;
  purpose?: "CHILD_PHOTO" | "OBSERVATION" | "MILESTONE";
  /** Attaches the upload to an observation. */
  observationId?: string;
  /** Attaches the upload to a remembered first — RFP §4.5. */
  milestoneId?: string;
  /** Pre-tags every file in this upload with the album's "ангилал" facet — the overview page's fixed galleries. */
  category?: string;
  /** Pre-tags every file with the album's "нас" facet — the overview page's age-filtered gallery. */
  age?: number;
  multiple?: boolean;
  label?: string;
  /** Replaces the default "JPEG, PNG or WebP…" line. Pass `null` for none. */
  hint?: ReactNode | null;
  onUploaded?: (mediaId: string) => void | Promise<void>;
  variant?: "primary" | "secondary";
  /** Shows one short caption field and sends it with every file in this batch. */
  withCaption?: boolean;
  /** Extra controls rendered beside the button. */
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  /** The files that failed, kept so "retry" does not need them re-picked. */
  const [failed, setFailed] = useState<File[] | null>(null);
  /** What the server refused, per file, so the message names them. */
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);
  const [caption, setCaption] = useState("");

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      // ★ One request for the whole selection.
      //
      // The endpoint takes repeated `file` parts. It used to be one request
      // per photograph, which at 60 uploads an hour meant a class-board post
      // with twenty photographs spent a third of a teacher's daily budget.
      for (const file of files) form.append("file", file);
      if (observationId) form.append("observationId", observationId);
      if (milestoneId) form.append("milestoneId", milestoneId);
      if (purpose) form.append("purpose", purpose);
      if (category) form.append("category", category);
      if (age) form.append("age", String(age));
      if (caption.trim()) form.append("caption", caption.trim());
      // No Content-Type is set: the browser must add the multipart boundary.
      return mutate(`/children/${childId}/media`, uploadResultSchema, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: async (result) => {
      setFailed(null);
      setCaption("");
      // Partial success is normal, not an error: the server stored what it
      // could and named what it would not. Saying so beats a silent shortfall.
      setRefused(result.failed);
      for (const media of result.items) await onUploaded?.(media.id);
      void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
    },
    onError: (_error, files) => setFailed(files),
  });

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    setLocalError(null);
    setRefused([]);

    const chosen = Array.from(list);
    const tooBig = chosen.filter((file) => file.size > MAX_UPLOAD_BYTES);
    const sendable = chosen.filter((file) => file.size <= MAX_UPLOAD_BYTES);

    if (tooBig.length) {
      setLocalError(
        `${tooBig.map((f) => `"${f.name}"`).join(", ")} хэт том байна. Дээд хэмжээ ${MAX_MB} MB.`,
      );
    }

    // In batches, because the endpoint caps a request at six files — a teacher
    // selecting a whole morning's photographs should not have to know that.
    for (let i = 0; i < sendable.length; i += MAX_FILES_PER_REQUEST) {
      await upload.mutateAsync(sendable.slice(i, i + MAX_FILES_PER_REQUEST)).catch(() => undefined);
    }

    // Cleared so picking the same file again still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <FormError message={localError ?? (upload.isError ? errorMessage(upload.error) : null)} />

      {withCaption ? (
        <Field label="Зургийн тайлбар">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={caption}
              maxLength={255}
              placeholder="Жишээ: Манай гэр бүлийн дурсамж"
              onChange={(event) => setCaption(event.target.value)}
            />
          )}
        </Field>
      ) : null}

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

      {/*
        Named, not counted. "2 зураг орсонгүй" leaves a teacher to work out
        which two and why; the server already said, so it is repeated here.
      */}
      {refused.length ? (
        <ul role="status" className="flex flex-col gap-1 text-caption text-peach-ink">
          {refused.map((file) => (
            <li key={file.name}>
              <span className="font-medium">{file.name}</span> — {file.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {hint === null ? null : (
        <p className="text-caption text-muted">
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
