"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";
import { useId, useRef } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/components/media/photo-upload";
import { useToast } from "@/components/ui/toast";

const MAX_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

/** What `POST /children/:id/media` answers with — only the new id is needed. */
const uploadResultSchema = z.object({
  items: z.array(z.object({ id: z.uuid() })).default([]),
  failed: z.array(z.object({ reason: z.string().nullish() })).default([]),
});

/**
 * The camera badge on a child's avatar — press it to change the picture.
 *
 * ★ Two existing endpoints, no new API.
 *
 * Setting a child's profile photograph has always been possible and always
 * been buried: you opened the portfolio, found the gallery, uploaded into it,
 * opened the photo you had just uploaded and chose "make this the profile
 * picture". Four steps, on a screen nobody visits to do this.
 *
 * This does the same two calls the gallery does —
 * `POST /children/:id/media` then `POST /children/:id/media/profile-photo` —
 * in one action, from the place a person looks when they want to change a
 * picture: the picture itself. Nothing about authorisation changes; both routes
 * are scoped per child by `ChildAccessService`, exactly as before.
 *
 * ★★ It is an overlay on the avatar rather than a button beside it.
 *
 * The affordance every product uses for this is a small camera in the corner of
 * the image, and it costs no layout: the hero row is already tight at 375px
 * (`child-hero-profile.tsx` notes that the avatar, the name and the actions
 * each take a full line there), and a fifth control on that row would push
 * something onto a sixth.
 *
 * ★★★ A `<label>` driving a hidden `<input type="file">`, not a button that
 * clicks one. The native pairing is what gives the control a keyboard focus
 * ring and an accessible name for free, and what lets a phone offer "take a
 * photo" beside "choose from library".
 */
export function ChildPhotoButton({ childId, childName }: { childId: string; childName: string }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const change = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // No Content-Type: the browser must add the multipart boundary.
      const uploaded = await mutate(`/children/${childId}/media`, uploadResultSchema, {
        method: "POST",
        body: form,
      });

      const mediaId = uploaded.items[0]?.id;
      if (!mediaId) {
        // The endpoint reports per-file failures in `failed` rather than by
        // status, so a 200 with nothing in `items` is still a failure.
        throw new Error(uploaded.failed[0]?.reason ?? "Зургийг хүлээж авсангүй");
      }

      return mutate(`/children/${childId}/media/profile-photo`, z.unknown(), {
        method: "POST",
        body: { mediaId },
      });
    },
    onSuccess: () => {
      toast.success("Профайл зураг солигдлоо.");
      // The child record carries `photoMediaFileId`, and the roster and the
      // gallery both draw from it — all three have to be refetched or the old
      // face stays on screen until a reload.
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
      void queryClient.invalidateQueries({ queryKey: ["children"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function onPick(files: FileList | null) {
    const file = files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`Зураг хэт том байна. Дээд хэмжээ ${MAX_MB} MB.`);
      return;
    }
    change.mutate(file);
  }

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_TYPES}
        className="sr-only"
        disabled={change.isPending}
        onChange={(e) => onPick(e.target.files)}
      />
      {/*
        `-bottom-1 -right-1` so the badge overlaps the avatar's edge rather than
        sitting inside it, which is what keeps a 72px portrait readable. The
        white ring separates it from whatever the photograph happens to be at
        that corner.
      */}
      <label
        htmlFor={inputId}
        aria-label={`${childName} — профайл зураг солих`}
        className="absolute -bottom-1 -right-1 grid size-8 cursor-pointer place-items-center rounded-pill bg-primary text-primary-ink ring-2 ring-surface transition-colors hover:bg-primary-hover"
      >
        {change.isPending ? (
          <Loader2 size={15} aria-hidden="true" className="animate-spin" />
        ) : (
          <Camera size={15} aria-hidden="true" />
        )}
      </label>

      {change.isPending ? (
        <span role="status" className="sr-only">
          Зураг илгээж байна
        </span>
      ) : null}
    </>
  );
}
