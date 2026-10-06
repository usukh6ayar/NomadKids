"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { ChevronDown, ImagePlus, Pencil, Star, Users, X } from "lucide-react";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/components/media/photo-upload";
import { RequireRole } from "@/components/shell/require-role";
import { cn } from "@/lib/utils";
import { z } from "zod";
import { fullName } from "@/lib/format";
import { useMyProfile } from "@/lib/use-my-profile";
import { BackButton } from "@/components/ui/back-button";
import { PersonAvatar } from "@/components/media/media-image";
import { KindergartenLogoAvatar } from "@/components/media/kindergarten-logo";
import { shrinkIfTooLarge } from "@/lib/image-shrink";

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
  const { primaryKindergartenId, hasRole } = useSession();
  /**
   * ★ A teacher always posts to their own group — client, 2026-10-04: "багш
   * мэдээ оруулахад угаас бүлэгтээ л оруулах тул хэнд гэдэг бүлэг болон
   * бүлгийн хүүхдээс сонгох оруул, чухал гэсэнг хас". So a teacher chooses
   * between their group and named children in it (`/children` answers a
   * teacher with their own groups' children only), and has no Чухал box.
   * An administrator's form is unchanged.
   */
  const isTeacher = hasRole("TEACHER") && !hasRole("ADMIN");
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** «Засах» on a picture swaps it for another; this is which one. */
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replacing = useRef<string | null>(null);
  const audiencePanelId = useId();
  const [audienceOpen, setAudienceOpen] = useState(false);
  const profile = useMyProfile();
  const kindergarten = useQuery({
    queryKey: ["kindergarten", primaryKindergartenId ?? "", "name"],
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}`, z.object({ name: z.string() })),
    enabled: Boolean(primaryKindergartenId) && !isTeacher,
    staleTime: 5 * 60_000,
  });

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
              title: null,
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

  async function addFiles(picked: FileList | null) {
    if (!picked?.length) return;
    setFileError(null);
    const accepted: { file: File; url: string }[] = [];

    /*
     * ★ Shrunk before it is measured — 2026-09-20. A phone shoots 8–12 MB
     * frames, so refusing past the ceiling meant refusing ordinary
     * photographs. Anything already under it is passed through untouched.
     */
    const chosen = await Promise.all(
      Array.from(picked).map((file) => shrinkIfTooLarge(file, MAX_UPLOAD_BYTES)),
    );

    for (const file of chosen) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setFileError(`"${file.name}" хэт том байна. Дээд хэмжээ ${MAX_UPLOAD_MB} MB.`);
        continue;
      }
      accepted.push({ file, url: URL.createObjectURL(file) });
    }
    setFiles((current) => [...current, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function replaceFile(picked: FileList | null) {
    const target = replacing.current;
    replacing.current = null;
    const picked0 = picked?.[0];
    if (replaceInputRef.current) replaceInputRef.current.value = "";
    if (!target || !picked0) return;
    setFileError(null);
    const file = await shrinkIfTooLarge(picked0, MAX_UPLOAD_BYTES);
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError(`"${file.name}" хэт том байна. Дээд хэмжээ ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    URL.revokeObjectURL(target);
    setFiles((current) =>
      current.map((f) => (f.url === target ? { file, url: URL.createObjectURL(file) } : f)),
    );
  }

  function removeFile(url: string) {
    URL.revokeObjectURL(url);
    setFiles((current) => current.filter((f) => f.url !== url));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!busy) publishAll.mutate();
  }

  /** What the folded audience row says on its right — see the edit screen. */
  /** Who the post is from: the teacher, or the kindergarten for the administration. */
  const authorName = isTeacher
    ? fullName(profile.data) || "Бүлгийн багш"
    : (kindergarten.data?.name ?? "Цэцэрлэг");

  const audienceHint =
    audience === null
      ? "Бүх хүүхэд"
      : audience.groupIds.length + audience.childIds.length === 0
        ? "Сонгоогүй"
        : `${audience.groupIds.length} бүлэг · ${audience.childIds.length} хүүхэд`;

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

  /*
    ★ The composer as a post, not a form — client, 2026-10-06, with a drawing:
    a bar with ‹, «Мэдэгдэл нийтлэх» and «Болих»; who is posting, with two
    pills under the name for who sees it and what kind it is; one large
    borderless «Юу мэдэгдэх вэ?»; the pictures as large cards with Засах and
    ×; a «Нийтлэлд нэмэх» row; and one full-width «Нийтлэх». Same fields, same
    one-press create → upload → publish as before; only the shape changed.
  */
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <Card className="overflow-hidden p-0">
        <header className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-border-soft px-2 py-2 sm:px-3">
          <BackButton href="/notifications" />
          <h1 className="text-center text-lead font-semibold text-ink">Мэдэгдэл нийтлэх</h1>
          <button
            type="button"
            onClick={() => router.back()}
            disabled={busy}
            className="min-h-11 rounded-control px-3 text-body text-muted transition-colors hover:text-ink disabled:opacity-50"
          >
            Болих
          </button>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col" noValidate>
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <FormError message={publishAll.isError ? errorMessage(publishAll.error) : null} />

            {/* Who is posting — the kindergarten's logo for the administration. */}
            <div className="flex items-start gap-3">
              {isTeacher ? (
                <PersonAvatar child={profile.data ?? {}} size={48} />
              ) : (
                <KindergartenLogoAvatar
                  size={48}
                  fallback={<PersonAvatar child={profile.data ?? {}} size={48} />}
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="truncate text-lead font-semibold text-ink">{authorName}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-expanded={audienceOpen}
                    aria-controls={audiencePanelId}
                    aria-label={`Хэнд харагдах: ${audienceHint}`}
                    onClick={() => setAudienceOpen((open) => !open)}
                    disabled={busy}
                    className="inline-flex h-9 items-center gap-1.5 rounded-control border border-border bg-surface px-3 text-caption text-ink transition-colors hover:border-primary/40"
                  >
                    <Users size={16} aria-hidden="true" className="text-muted" />
                    {audienceHint}
                    <ChevronDown size={16} aria-hidden="true" className="text-muted" />
                  </button>
                  <Select
                    aria-label="Төрөл"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as NotificationCategory)}
                    disabled={busy}
                    className="h-9 w-auto rounded-control px-3 text-caption"
                  >
                    {NOTIFICATION_CATEGORIES.map((value) => (
                      <option key={value} value={value}>
                        {NOTIFICATION_CATEGORY_LABEL[value]}
                      </option>
                    ))}
                  </Select>
                  {isTeacher ? null : (
                    <button
                      type="button"
                      aria-pressed={isImportant}
                      onClick={() => setIsImportant((value) => !value)}
                      disabled={busy}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-control border px-3 text-caption transition-colors",
                        isImportant
                          ? "border-peach-ink/30 bg-peach text-peach-ink"
                          : "border-border bg-surface text-muted hover:text-ink",
                      )}
                    >
                      <Star size={14} aria-hidden="true" />
                      Чухал
                    </button>
                  )}
                </div>
              </div>
            </div>

            {audienceOpen ? (
              <div
                id={audiencePanelId}
                className="rounded-card border border-border-soft bg-canvas p-3"
              >
                <AudiencePicker
                  value={audience}
                  onChange={setAudience}
                  disabled={busy}
                  showSummary={false}
                  legendHidden
                  allowChildren={isTeacher}
                />
              </div>
            ) : null}

            <Field label="Дэлгэрэнгүй" labelHidden error={errors.body} required>
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={busy}
                  placeholder="Юу мэдэгдэх вэ?"
                  className="min-h-[120px] border-0 bg-transparent px-0 text-title shadow-none placeholder:text-faint focus:bg-transparent"
                />
              )}
            </Field>

            <FormError message={fileError} />
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              aria-label="Зураг нэмэх"
              className="sr-only"
              onChange={(e) => void addFiles(e.target.files)}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              aria-label="Зураг солих"
              className="sr-only"
              onChange={(e) => void replaceFile(e.target.files)}
            />

            {files.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {files.map(({ file, url }) => (
                  <li key={url} className="relative overflow-hidden rounded-card bg-canvas">
                    {/*
                      A plain `<img>`, not `next/image`: the source is a `blob:`
                      URL for a file that has not left the browser.
                    */}
                    <img src={url} alt={file.name} className="aspect-video w-full object-cover" />
                    <div className="absolute right-3 top-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          replacing.current = url;
                          replaceInputRef.current?.click();
                        }}
                        disabled={busy}
                        aria-label={`"${file.name}" зургийг солих`}
                        className="inline-flex h-10 items-center gap-1.5 rounded-control bg-ink/70 px-3 text-body text-white backdrop-blur transition-colors hover:bg-ink"
                      >
                        <Pencil size={16} aria-hidden="true" />
                        Засах
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFile(url)}
                        disabled={busy}
                        aria-label={`"${file.name}" зургийг хасах`}
                        className="grid size-10 place-items-center rounded-control bg-ink/70 text-white backdrop-blur transition-colors hover:bg-ink"
                      >
                        <X size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex items-center justify-between gap-3 rounded-card border border-border px-4 py-2">
              <span className="text-body font-semibold text-ink">Нийтлэлд нэмэх</span>
              <div className="flex items-center gap-1">
                <label
                  htmlFor={fileInputId}
                  title="Зураг нэмэх"
                  className={cn(
                    "grid size-11 cursor-pointer place-items-center rounded-control text-mint-ink transition-colors hover:bg-canvas",
                    busy && "pointer-events-none opacity-60",
                  )}
                >
                  <ImagePlus size={22} aria-hidden="true" />
                  <span className="sr-only">Зураг нэмэх</span>
                </label>
              </div>
            </div>
          </div>

          <div className="border-t border-border-soft p-4 sm:p-5">
            <Button type="submit" disabled={busy} className="w-full">
              {step === "saving"
                ? "Хадгалж байна…"
                : step === "uploading"
                  ? "Зураг илгээж байна…"
                  : step === "publishing"
                    ? "Нийтэлж байна…"
                    : "Нийтлэх"}
            </Button>
          </div>

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
