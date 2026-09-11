"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABEL,
  mediaSchema,
  notificationSchema,
  type NotificationCategory,
} from "@kinder/contracts";
import {
  AudiencePicker,
  audienceToTargets,
  type Audience,
} from "@/components/notifications/audience-picker";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { ImagePlus, X } from "lucide-react";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/components/media/photo-upload";
import { RequireRole } from "@/components/shell/require-role";

/** The ceiling, in the unit the copy states it in. */
const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

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
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  /*
    ★ The category, and who the post is for — the client's 2026-08-30 request.

    `OTHER` is the default rather than an empty selection: every post has to
    land in some chip, and forcing a choice before the teacher has written
    anything is the multi-step flow they asked to be rid of ("facebook post
    oruulah shig engiin hyalbar bolgo").
  */
  const [category, setCategory] = useState<NotificationCategory>("OTHER");
  /**
   * Null means everyone — the API reads an empty `targets` array the same way.
   *
   * ★ A groups-and-children pair since 2026-09-06, not a list of child ids.
   * See `AudiencePicker`: a director writing to Дэлбээ should target the group,
   * so that a child enrolled next week is included rather than frozen out.
   */
  const [audience, setAudience] = useState<Audience>(null);
  const [body, setBody] = useState("");
  const [isImportant, setIsImportant] = useState(false);
  /**
   * Chosen photographs, held in the browser until the post is submitted.
   *
   * ★ This is what makes the screen one step instead of two.
   *
   * A photograph is attached to a notification id — `POST /notifications/:id/
   * media` — so the notice has to exist before an upload has anywhere to go.
   * The old form met that by making the teacher save a draft first and only
   * then revealing the picker: two buttons, an "Үргэлжлүүлэх" that did not
   * publish, and locked fields in between. It worked and nobody could find it.
   *
   * Holding the files locally moves that ordering entirely inside the submit
   * handler. The teacher writes a title, a body and picks pictures in any
   * order, presses Нийтлэх once, and `publishAll` does create → upload →
   * publish. `URL.createObjectURL` gives an instant preview with no network at
   * all, which is also why removing a photo before posting costs nothing —
   * there is no uploaded file to delete.
   */
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  /**
   * The draft, once `publishAll` has created it.
   *
   * Kept in state only so a failed run can be retried without creating a
   * second notice: pressing Нийтлэх again reuses this id rather than posting a
   * duplicate. It is never shown.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [step, setStep] = useState<null | "saving" | "uploading" | "publishing">(null);

  // Object URLs are freed when the component unmounts; without this a teacher
  // who composes several notices leaks a blob per photograph for the session.
  useEffect(() => {
    return () => files.forEach((f) => URL.revokeObjectURL(f.url));
  }, [files]);

  /**
   * The whole post, in one action.
   *
   * ★ Sequential uploads, deliberately. `POST /notifications/:id/media` is
   * rate-limited per user (60/hour, `RateLimitGuard`), and firing five at once
   * is the reliable way to trip it — `PhotoUpload` and `NoticePhotoUpload` each
   * reached the same conclusion and say so.
   */
  const publishAll = useMutation({
    mutationFn: async () => {
      setStep("saving");
      let id = draftId;
      if (!id) {
        const created = await mutate(
          `/kindergartens/${primaryKindergartenId}/notifications`,
          notificationSchema,
          {
            method: "POST",
            body: {
              // Empty stays empty: the DTO turns "" into null, which is what
              // "this post has no heading" is stored as.
              title: title.trim() || null,
              category,
              body,
              isImportant,
              // No selection is the whole kindergarten, which the API spells as
              // no targets at all rather than as every group listed.
              targets: audienceToTargets(audience),
            },
          },
        );
        id = created.id;
        setDraftId(id);
      }

      if (files.length > 0) {
        setStep("uploading");
        for (const { file } of files) {
          const form = new FormData();
          form.append("file", file);
          // No Content-Type: the browser must set the multipart boundary.
          await mutate(`/notifications/${id}/media`, mediaSchema, { method: "POST", body: form });
        }
      }

      setStep("publishing");
      return mutate(`/notifications/${id}/publish`, notificationSchema, { method: "POST" });
    },
    onSettled: () => setStep(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      router.replace("/notifications");
    },
  });

  const errors = fieldErrors(publishAll.error);
  const busy = publishAll.isPending;

  function addFiles(picked: FileList | null) {
    if (!picked?.length) return;
    setFileError(null);
    const accepted: { file: File; url: string }[] = [];
    for (const file of Array.from(picked)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setFileError(`"${file.name}" хэт том байна. Дээд хэмжээ ${MAX_UPLOAD_MB} MB.`);
        continue;
      }
      accepted.push({ file, url: URL.createObjectURL(file) });
    }
    setFiles((current) => [...current, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(url: string) {
    URL.revokeObjectURL(url);
    setFiles((current) => current.filter((f) => f.url !== url));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!busy) publishAll.mutate();
  }

  if (!primaryKindergartenId) {
    return (
      <div>
        <PageHeader title="Шинэ мэдэгдэл" />
        <Card className="px-4 py-6 text-body text-muted">
          Та ямар нэг цэцэрлэгт бүртгэлгүй байна.
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-0 [&_[data-ui=page-header]]:mb-2 [&_[data-ui=page-header]_h1]:text-title">
      <PageHeader title="Шинэ мэдэгдэл" />

      <Card className="overflow-hidden">
        <form onSubmit={onSubmit} className="flex flex-col gap-3 p-3 sm:p-4" noValidate>
          <FormError message={publishAll.isError ? errorMessage(publishAll.error) : null} />

          <div className="grid grid-cols-2 gap-2.5" data-testid="notice-compact-fields">
            <Field label="Төрөл">
              {({ id }) => (
                <Select
                  id={id}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as NotificationCategory)}
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

            <Field label="Гарчиг" error={errors.title}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              )}
            </Field>
          </div>

          <Field label="Дэлгэрэнгүй" error={errors.body} required>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
                placeholder="Бичих"
                className="min-h-[80px]"
              />
            )}
          </Field>

          <div className="rounded-row bg-sunken p-2.5 sm:p-3">
            <AudiencePicker
              value={audience}
              onChange={setAudience}
              disabled={busy}
              showSummary={false}
            />
          </div>

          {/* Photographs, chosen here and sent when the post is. */}
          <div className="flex flex-col gap-2">
            <FormError message={fileError} />

            {files.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {files.map(({ file, url }) => (
                  <li key={url} className="relative">
                    {/*
                      A plain `<img>`, not `next/image`: the source is a
                      `blob:` URL for a file that has not left the browser, so
                      there is nothing for the optimiser to fetch or resize.
                    */}
                    <img
                      src={url}
                      alt={file.name}
                      className="aspect-square w-full rounded-control border border-border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(url)}
                      aria-label={`"${file.name}" зургийг хасах`}
                      disabled={busy}
                      className="absolute right-1 top-1 grid size-7 place-items-center rounded-pill bg-ink/70 text-white transition-colors hover:bg-ink"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              className="sr-only"
              onChange={(e) => addFiles(e.target.files)}
            />
            <div className="grid grid-cols-2 gap-2.5" data-testid="notice-compact-actions">
              <Button asChild variant="secondary" disabled={busy} className="w-full">
                <label htmlFor={fileInputId} className="cursor-pointer justify-center">
                  <ImagePlus size={18} />
                  Зураг нэмэх
                </label>
              </Button>
              <Checkbox
                label="Чухал"
                checked={isImportant}
                onChange={(e) => setIsImportant(e.target.checked)}
                disabled={busy}
                className="min-h-[48px] items-center rounded-control border border-border bg-surface px-3 py-0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 border-t border-border pt-3">
            <Button type="submit" disabled={busy} className="w-full">
              {step === "saving"
                ? "Хадгалж байна…"
                : step === "uploading"
                  ? "Зураг илгээж байна…"
                  : step === "publishing"
                    ? "Нийтэлж байна…"
                    : "Нийтлэх"}
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => router.back()}
              disabled={busy}
            >
              Болих
            </Button>
          </div>

          {/* The one place the multi-request nature shows, and only while it
              is happening — a teacher who added four photographs should know
              why the button is busy for a few seconds. */}
          {busy ? (
            <p role="status" className="sr-only">
              {step === "uploading" ? "Зураг илгээж байна" : "Нийтэлж байна"}
            </p>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
