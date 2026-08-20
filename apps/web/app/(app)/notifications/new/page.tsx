"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { notificationSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { MediaThumb } from "@/components/media/media-image";
import { NoticePhotoUpload } from "@/components/notifications/notice-photo-upload";
import { RequireRole } from "@/components/shell/require-role";

/**
 * Writing a class-board announcement.
 *
 * ★ Two steps, one screen: the notice is created as a DRAFT, photos attach to
 * that draft, and publishing is a separate button.
 *
 * That ordering is forced by the API and it is the right shape anyway — a photo
 * needs a notice to belong to, so there is nothing to upload against until the
 * text exists. It also means a half-written notice cannot reach two hundred
 * families because someone hit save: the draft is private until published.
 *
 * ★★ Staff only. `RequireRole` guards the route, and the API refuses a guardian
 * independently — the screen is a convenience, never the control.
 */
export default function NewNotificationPage() {
  // The API refuses a guardian independently; this only avoids showing them a
  // form that would fail.
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <ComposeNotice />
    </RequireRole>
  );
}

function ComposeNotice() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { primaryKindergartenId } = useSession();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isImportant, setIsImportant] = useState(false);
  /** The draft, once created. Photos attach to it; publishing finishes it. */
  const [draft, setDraft] = useState<{ id: string } | null>(null);
  const [photos, setPhotos] = useState<{ id: string; caption?: string | null }[]>([]);

  const createDraft = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${primaryKindergartenId}/notifications`, notificationSchema, {
        method: "POST",
        body: { title, body, isImportant, targets: [] },
      }),
    onSuccess: (created) => setDraft({ id: created.id }),
  });

  const publish = useMutation({
    mutationFn: () =>
      mutate(`/notifications/${draft!.id}/publish`, notificationSchema, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      router.replace("/notifications");
    },
  });

  const errors = fieldErrors(createDraft.error);
  const busy = createDraft.isPending || publish.isPending;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (draft) publish.mutate();
    else createDraft.mutate();
  }

  if (!primaryKindergartenId) {
    return (
      <div>
        <PageHeader title="Шинэ мэдэгдэл" />
        <Card className="px-4 py-6 text-sm text-muted">
          Та ямар нэг цэцэрлэгт бүртгэлгүй байна.
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader
        title="Шинэ мэдэгдэл"
        lede={
          draft
            ? "Зураг нэмээд нийтэлнэ үү. Нийтлэх хүртэл эцэг эхэд харагдахгүй."
            : "Ангийн самбарт зар нийтлэх."
        }
      />

      <Card className="px-4 py-4 sm:px-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FormError
            message={
              createDraft.isError
                ? errorMessage(createDraft.error)
                : publish.isError
                  ? errorMessage(publish.error)
                  : null
            }
          />

          <Field label="Гарчиг" error={errors.title} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                // Locked once the draft exists: the photos below belong to it,
                // and editing is a separate screen rather than a hidden mode.
                disabled={Boolean(draft)}
                autoFocus
              />
            )}
          </Field>

          <Field label="Дэлгэрэнгүй" error={errors.body} required>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={Boolean(draft)}
                placeholder="Огноо, цаг, юу авчрахыг бичнэ үү."
              />
            )}
          </Field>

          <Checkbox
            label="Чухал"
            description="Жагсаалтын дээд талд, тэмдэглэгээтэй харагдана."
            checked={isImportant}
            onChange={(e) => setIsImportant(e.target.checked)}
            disabled={Boolean(draft)}
          />

          {draft ? (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              {photos.length > 0 ? (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((photo) => (
                    <li key={photo.id}>
                      <MediaThumb mediaId={photo.id} caption={photo.caption} />
                    </li>
                  ))}
                </ul>
              ) : null}

              <NoticePhotoUpload
                notificationId={draft.id}
                onUploaded={(media) => setPhotos((current) => [...current, media])}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={busy}>
              {draft
                ? publish.isPending
                  ? "Нийтэлж байна…"
                  : "Нийтлэх"
                : createDraft.isPending
                  ? "Хадгалж байна…"
                  : "Үргэлжлүүлэх"}
            </Button>

            <Button type="button" variant="ghost" onClick={() => router.back()} disabled={busy}>
              Болих
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
