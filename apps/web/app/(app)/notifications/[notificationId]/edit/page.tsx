"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
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

  const existingMedia = (notice.data.media ?? []).length + addedMedia.length;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader title="Мэдэгдэл засах" lede="Нийтэлсэн зараа шинэчлэх." />

      <Card pad="roomy">
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FormError message={save.isError ? errorMessage(save.error) : null} />

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

          <fieldset>
            <legend className="mb-2 text-body font-medium text-ink">Төрөл</legend>
            <FilterChipRow label="Мэдээний төрөл" scroll>
              {NOTIFICATION_CATEGORIES.map((value) => (
                <FilterChip
                  key={value}
                  active={category === value}
                  onClick={() => setCategory(value)}
                >
                  {NOTIFICATION_CATEGORY_LABEL[value]}
                </FilterChip>
              ))}
            </FilterChipRow>
          </fieldset>

          <Field label="Дэлгэрэнгүй" error={errors.body} required>
            {({ id: fieldId, describedBy, invalid }) => (
              <Textarea
                id={fieldId}
                aria-describedby={describedBy}
                invalid={invalid}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
                placeholder="Огноо, цаг, юу авчрахыг бичнэ үү."
              />
            )}
          </Field>

          <AudiencePicker value={audience} onChange={setAudience} disabled={busy} />

          {/*
            ★ Photographs can be added here but not removed, and the copy says
            so rather than leaving a teacher hunting for a control.

            `POST /notifications/:id/media` exists; there is no delete for a
            notice's media. Adding one is a real piece of work — the row soft-
            deletes, the R2 object outlives it, and both need an owner — so it
            is named as missing instead of half-built behind a button that
            silently only hides the thumbnail.
          */}
          <div className="flex flex-col gap-2">
            <p className="text-body font-medium text-ink">
              Зураг{existingMedia > 0 ? ` (${existingMedia})` : ""}
            </p>
            <NoticePhotoUpload
              notificationId={id}
              onUploaded={(media) => setAddedMedia((current) => [...current, { id: media.id }])}
            />
            <p className="text-caption text-muted">
              Нэмсэн зураг шууд хадгалагдана. Хуучин зургийг энэ хэсгээс устгах боломжгүй.
            </p>
          </div>

          <Checkbox
            label="Чухал"
            description="Жагсаалтын дээд талд, тэмдэглэгээтэй харагдана."
            checked={isImportant}
            onChange={(e) => setIsImportant(e.target.checked)}
            disabled={busy}
          />

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
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
