"use client";

import { useEffect, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/components/media/photo-upload";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

/** The design's ceiling. The API takes six per request; five is what it draws. */
export const MAX_OBSERVATION_PHOTOS = 5;

/**
 * Photographs chosen *before* the note exists.
 *
 * ★ Why a second picker when `PhotoUpload` exists.
 *
 * `PhotoUpload` uploads on pick, and `POST /children/:id/media` needs an
 * `observationId` to attach to — so it can only run once the note has been
 * saved, which is what `ObservationPhotos` does on the confirmation screen.
 * The client's 2026-09-11 compose design puts the pictures *in* the form,
 * above Хадгалах, so this holds the selection and the form uploads it after
 * the note is created. Nothing is sent from here.
 *
 * ★★ The design says "Зураг / Видео". This accepts images only.
 *
 * `ALLOWED_MIME_TYPES` in `media/upload-validation.ts` is JPEG, PNG and WebP,
 * and the type is detected from the file's own bytes (§1.6) — a video would be
 * picked, previewed, and then refused by the server after the note had already
 * saved. A control that cannot do what its label promises is worse than a
 * narrower label, so the heading says Зураг until the API takes film.
 */
export function ObservationPhotoPicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (next: File[]) => void;
  disabled?: boolean;
}) {
  const toast = useToast();

  /*
    Object URLs, revoked when the selection changes.

    `URL.createObjectURL` pins the whole file in memory until it is revoked, and
    a teacher who picks five photographs, clears them and picks five more would
    otherwise hold ten — on the phone that is the tab being killed.
  */
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  function add(picked: FileList | null) {
    if (!picked || picked.length === 0) return;

    const room = MAX_OBSERVATION_PHOTOS - files.length;
    const accepted: File[] = [];
    let oversize = 0;

    for (const file of Array.from(picked)) {
      // Checked here as well as on the server, so a 12 MB photograph fails now
      // rather than after the note has been written and saved.
      if (file.size > MAX_UPLOAD_BYTES) {
        oversize += 1;
        continue;
      }
      if (accepted.length < room) accepted.push(file);
    }

    if (oversize > 0) {
      toast.error(`${oversize} зураг 10MB-аас том тул хасагдлаа.`);
    }
    // Trimmed rather than refused: the point of the cap is the note, not
    // punishing a teacher who selected their whole camera roll.
    if (Array.from(picked).length - oversize > accepted.length) {
      toast.error(`Хамгийн олондоо ${MAX_OBSERVATION_PHOTOS} зураг хавсаргана.`);
    }
    if (accepted.length > 0) onChange([...files, ...accepted]);
  }

  const full = files.length >= MAX_OBSERVATION_PHOTOS;

  /*
    ★ One compact card, not a section with a heading of its own — 2026-09-11,
    "зураг … зай бага эзлэхээр болго".

    It was an `h2` above a roomy card, which on a phone spent a heading, a gap
    and 24px of padding on a row of thumbnails that says what it is by looking
    like itself. The count carries the label instead, the tiles are 64px, and the
    footnote is one short line rather than three sentences.
  */
  return (
    <Card className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-body font-medium text-ink">Зураг</h2>
        <span className="text-caption font-medium tabular-nums text-muted">
          {files.length}/{MAX_OBSERVATION_PHOTOS}
        </span>
      </div>

      <ul className="flex flex-wrap gap-2">
        {files.map((file, index) => (
          <li key={`${file.name}-${file.lastModified}-${index}`} className="relative">
            {/*
                A plain `<img>`, not `next/image`: the source is a `blob:` URL
                for a file the browser already holds, and there is nothing for
                an optimiser to fetch, resize or cache.
              */}
            <img
              src={previews[index]}
              alt={file.name}
              className="size-16 rounded-control border border-mint object-cover"
            />
            <button
              type="button"
              disabled={disabled}
              aria-label={`${file.name} — хасах`}
              onClick={() => onChange(files.filter((_, at) => at !== index))}
              className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-pill border border-mint bg-surface text-muted shadow-sm transition-colors hover:text-ink disabled:opacity-40"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </li>
        ))}

        {full ? null : (
          <li>
            {/*
                A label, not a button — the file input is the control, and a
                button that clicks a hidden input is a second thing to keep
                focusable and keyboard-reachable for no gain.
              */}
            <label
              className={
                "grid size-16 cursor-pointer place-items-center gap-0.5 rounded-control border border-dashed border-mint text-caption text-muted transition-colors focus-within:border-primary hover:border-primary hover:text-primary" +
                (disabled ? " pointer-events-none opacity-40" : "")
              }
            >
              <ImagePlus size={16} aria-hidden="true" />
              <span>Нэмэх</span>
              <input
                type="file"
                multiple
                accept={ACCEPTED_TYPES}
                disabled={disabled}
                className="sr-only"
                onChange={(event) => {
                  add(event.target.files);
                  // Cleared so picking the same file twice still fires
                  // `change` — otherwise removing a photo and re-adding it
                  // silently does nothing.
                  event.target.value = "";
                }}
              />
            </label>
          </li>
        )}
      </ul>

      <p className="text-caption text-muted">JPG, PNG, WebP · 10MB хүртэл · хадгалахад хамт орно</p>
    </Card>
  );
}
