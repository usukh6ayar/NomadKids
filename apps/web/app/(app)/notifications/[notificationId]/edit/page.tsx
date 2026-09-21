"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { z } from "zod";
import { useEffect, useState, type FormEvent } from "react";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABEL,
  notificationSchema,
  type NotificationCategory,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import {
  AudiencePicker,
  audienceToTargets,
  targetsToAudience,
  type Audience,
} from "@/components/notifications/audience-picker";
import { NoticePhotoUpload } from "@/components/notifications/notice-photo-upload";
import { MediaThumb } from "@/components/media/media-image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

/**
 * Editing a class-board post.
 *
 * ★ The client asked for this on 2026-08-31: "Teachers should be able to edit
 * their own posts… must NOT be able to edit posts created by other users."
 *
 * That rule is **not** enforced here. `PATCH /notifications/:id` already routes
 * through `requireStaffOwned`, which reads the row, asserts staff membership of
 * its kindergarten, and then throws `NotFoundException` unless the caller is an
 * admin there or the post's own author — a 404 rather than a 403, per §1.7, so
 * the response does not confirm that someone else's post exists. This screen
 * only avoids offering an edit that would fail; the list decides whether to
 * show the link at all, and the API decides whether it works.
 *
 * ★★ Publishing is not re-run. A published post stays published and an edit
 * updates it in place — `PATCH` does not touch `status`. That is why this is a
 * separate screen from `new/page.tsx` rather than the same form in two modes:
 * composing is create → upload → publish in one press, editing is one request,
 * and the shared parts (`AudiencePicker`, `NoticePhotoUpload`, the chips) are
 * shared as components instead.
 */
export default function EditNotificationPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <EditNotice />
    </RequireRole>
  );
}

function EditNotice() {
  const router = useRouter();
  const params = useParams<{ notificationId: string }>();
  const id = params.notificationId;
  const queryClient = useQueryClient();

  const notice = useQuery({
    queryKey: qk.notification(id),
    queryFn: () => get(`/notifications/${id}`, notificationSchema),
  });

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<NotificationCategory>("OTHER");
  const [body, setBody] = useState("");
  const [isImportant, setIsImportant] = useState(false);
  /** Null means everyone — see `AudiencePicker`. */
  const [audience, setAudience] = useState<Audience>(null);
  /** Photos added during this edit, so the count below reflects them at once. */
  const [addedMedia, setAddedMedia] = useState<{ id: string }[]>([]);
  /** And the ones taken off in it, for the same reason. */
  const [removedMedia, setRemovedMedia] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  /*
    ★ Seeded once, not synced.

    A `useEffect` that re-ran on every `notice.data` change would overwrite what
    the teacher is typing each time React Query refetched in the background —
    the classic controlled-form bug. `ready` latches after the first load, so
    the server's copy seeds the fields and never touches them again.
  */
  useEffect(() => {
    const data = notice.data;
    if (!data || ready) return;

    setTitle(data.title ?? "");
    setCategory(data.category);
    setBody(data.body ?? "");
    setIsImportant(Boolean(data.isImportant));
    /*
      No targets is "Бүх бүлэг" — the same `null`-means-everyone contract the
      composer uses, read back off the row.

      ★ Group targets are restored too, since 2026-09-06. This used to keep
      only the child ones with the note "a group target has no checkbox to
      restore" — true then, and the consequence was silent data loss: opening a
      group-targeted notice and pressing Хадгалах rewrote its audience to
      everyone. The picker has group checkboxes now, and `targetsToAudience` is
      the one place that reads the API's shape back.
    */
    setAudience(targetsToAudience(data.targets ?? []));
    setReady(true);
  }, [notice.data, ready]);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/notifications/${id}`, notificationSchema, {
        method: "PATCH",
        body: {
          title: title.trim() || null,
          category,
          body,
          isImportant,
          targets: audienceToTargets(audience),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      router.replace("/notifications");
    },
  });

  const removePhoto = useMutation({
    mutationFn: (mediaId: string) =>
      mutate(`/notifications/${id}/media/${mediaId}`, z.unknown(), { method: "DELETE" }),
    onSuccess: async (_result, mediaId) => {
      setRemovedMedia((current) => [...current, mediaId]);
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const removing = removePhoto.isPending ? removePhoto.variables : null;

  const errors = fieldErrors(save.error);
  const busy = save.isPending;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!busy) save.mutate();
  }

  if (notice.isLoading) {
    return (
      <div>
        <PageHeader title="Мэдэгдэл засах" />
        <LoadingState label="Ачаалж байна…" />
      </div>
    );
  }

  /*
    A post this reader may not edit answers 404, and so does one that does not
    exist — deliberately indistinguishable (§1.7). The copy says the same thing
    for both rather than guessing which it was.
  */
  if (notice.isError || !notice.data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Мэдэгдэл засах" />
        <Card className="px-4 py-6 text-body text-muted">
          Энэ мэдэгдэл олдсонгүй, эсвэл танд засах эрх байхгүй байна.
        </Card>
        <Button
          variant="ghost"
          onClick={() => router.push("/notifications")}
          className="self-start"
        >
          Мэдээ рүү буцах
        </Button>
      </div>
    );
  }

  /*
    What is on the notice now: the rows the server returned, minus anything
    removed in this session, plus anything uploaded in it. Kept locally rather
    than refetching so a removal is instant; `invalidateQueries` on save is
    what makes the list behind agree.
  */
  const photos = [...(notice.data.media ?? []), ...addedMedia].filter(
    (photo) => !removedMedia.includes(photo.id),
  );

  /*
    What the folded audience row says on its right. A section that hides its
    contents has to answer "what is in there" without being opened, or the
    fold costs a press to learn nothing changed.
  */
  const audienceHint =
    audience === null
      ? "Бүх хүүхэд"
      : audience.groupIds.length + audience.childIds.length === 0
        ? "Сонгоогүй"
        : `${audience.groupIds.length} бүлэг · ${audience.childIds.length} хүүхэд`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Мэдэгдэл засах" />

      {/* Compact padding and a 12px rhythm — the client asked for the whole
          form to take less room, and the card was spending 24px a side. */}
      <Card pad="compact">
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <FormError message={save.isError ? errorMessage(save.error) : null} />

          {/*
            ★ A select, where this was a scrolling row of chips — 2026-09-16,
            the client: "төрөл дропдаун харагд".

            Seven categories in a chip row is a horizontal scroller at the top
            of a form: the chosen one can be off-screen, and on an edit the
            category is usually already right and only needs reading. A closed
            select says what it is in one line and costs one press to change.
          */}
          <Field label="Төрөл">
            {({ id: fieldId }) => (
              <Select
                id={fieldId}
                value={category}
                onChange={(event) => setCategory(event.target.value as NotificationCategory)}
                disabled={busy}
              >
                {NOTIFICATION_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {NOTIFICATION_CATEGORY_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Гарчиг (заавал биш)" error={errors.title}>
            {({ id: fieldId, describedBy, invalid }) => (
              <Input
                id={fieldId}
                aria-describedby={describedBy}
                invalid={invalid}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            )}
          </Field>

          {/*
            ★ No printed "Дэлгэрэнгүй", and a shorter box — 2026-09-16, at the
            client's request. The label stays in the DOM as `sr-only`: it is
            what a screen reader announces, and the placeholder cannot do that
            job because it disappears the moment somebody types.
          */}
          <Field label="Дэлгэрэнгүй" labelHidden error={errors.body} required>
            {({ id: fieldId, describedBy, invalid }) => (
              <Textarea
                id={fieldId}
                aria-describedby={describedBy}
                invalid={invalid}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
                placeholder="Бичих"
                className="min-h-[56px] py-2"
              />
            )}
          </Field>

          {/*
            ★ The pictures are on the screen, and each one can be taken off —
            2026-09-16, the client: "оруулсан зураг харагдаж, арилгаад өөр
            зургаар сольж болно".

            This block used to print a count and a line of copy explaining that
            removal was impossible. It was: `POST …/media` existed and nothing
            undid it. `DELETE /notifications/:id/media/:mediaId` does now — the
            author's or an administrator's, 404 to anyone else — so the
            explanation is gone and the control is here instead.
          */}
          <div className="flex flex-col gap-1.5">
            <p className="text-body font-medium text-ink">
              Зураг{photos.length > 0 ? ` (${photos.length})` : ""}
            </p>

            {/*
              ★ Adding sits in the grid with the pictures, as one icon —
              2026-09-16, at the client's request. A labelled button on a row
              of its own read as a separate step from the photographs it adds
              to; a dashed square at the end of the row is the same control in
              the place the eye already is.
            */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((photo) => (
                <div key={photo.id} className="relative">
                  <MediaThumb mediaId={photo.id} className="w-full" />
                  <button
                    type="button"
                    aria-label="Зургийг хасах"
                    disabled={removing === photo.id}
                    onClick={() => removePhoto.mutate(photo.id)}
                    className="absolute right-1 top-1 grid size-7 place-items-center rounded-pill bg-ink/70 text-white hover:bg-ink disabled:opacity-50"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}

              <NoticePhotoUpload
                notificationId={id}
                tile
                onUploaded={(media) => setAddedMedia((current) => [...current, { id: media.id }])}
              />
            </div>
          </div>

          {/*
            ★ Folded, and opened by pressing its own row — 2026-09-16, the
            client: "хэнд харагдах дээр дарж гаргадаг болгоорой".

            An audience is chosen once and then left alone; on an edit it is
            usually not the reason the form was opened at all. Open, it is a
            select, a list of groups and a scrolling list of children between
            the writing and Хадгалах. `Disclosure` is the product's `<details>`
            — it needs no JavaScript and the browser's find-in-page opens it to
            reveal a child's name inside.
          */}
          {/*
            ★★ One row — 2026-09-16, the client: "хэнд харагдах, чухал хоёрыг
            нэг эгнээнд, орчин үеийн минимал, зай бага эзлэхээр шах".

            They are a notice's two settings rather than its content, and
            stacked they spent two full-width rows saying very little. The
            audience takes the width because it opens; Чухал is one tick in a
            box of the same height beside it. `items-start` keeps the tick
            level with the row you press rather than drifting to the middle of
            an opened panel, and `flex-wrap` lets a narrow phone stack them
            rather than squeezing a 44px target.
          */}
          <div className="flex flex-wrap items-start gap-2">
            <Disclosure title="Хэнд харагдах" hint={audienceHint} className="min-w-[220px] flex-1">
              <AudiencePicker
                value={audience}
                onChange={setAudience}
                disabled={busy}
                legendHidden
                allowChildren={false}
              />
            </Disclosure>

            <Checkbox
              label="Чухал"
              checked={isImportant}
              onChange={(e) => setIsImportant(e.target.checked)}
              disabled={busy}
              className="min-h-[60px] shrink-0 items-center rounded-card border border-border bg-surface px-3.5 py-0"
            />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Хадгалж байна…" : "Хадгалах"}
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
