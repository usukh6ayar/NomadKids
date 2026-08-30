"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { paginated } from "@kinder/contracts";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABEL,
  childSummarySchema,
  mediaSchema,
  notificationSchema,
  type NotificationCategory,
} from "@kinder/contracts";

/** The roster, already scoped by `canAccessChild` — see `AudiencePicker`. */
const childListSchema = paginated(childSummarySchema);
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
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
  /** Null means everyone — the API reads an empty `targets` array the same way. */
  const [childIds, setChildIds] = useState<string[] | null>(null);
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
              // no targets at all rather than as every child listed.
              targets: childIds ? childIds.map((childId) => ({ childId })) : [],
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
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader title="Шинэ мэдэгдэл" lede="Ангийн самбарт зар нийтлэх." />

      <Card pad="roomy">
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FormError message={publishAll.isError ? errorMessage(publishAll.error) : null} />

          {/*
            ★ No longer `required` — the client asked for it on 2026-08-30.

            A post can be a photograph and a sentence. Requiring a heading
            produced titles that restated the first line of the body, and the
            label now says so rather than leaving the teacher to discover it by
            submitting.
          */}
          <Field label="Гарчиг (заавал биш)" error={errors.title}>
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

          {/*
            The category, as chips rather than a `<select>`.

            Nine options that are each two or three words read faster laid out
            than opened one at a time, and this is the same control the feed
            filters with — a teacher picking "Зарлал" here sees the chip they
            just pressed on the list afterwards.
          */}
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
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
                placeholder="Огноо, цаг, юу авчрахыг бичнэ үү."
              />
            )}
          </Field>

          <AudiencePicker value={childIds} onChange={setChildIds} disabled={busy} />

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
            <Button asChild variant="secondary" disabled={busy} className="self-start">
              <label htmlFor={fileInputId} className="cursor-pointer">
                <ImagePlus size={18} />
                Зураг нэмэх
              </label>
            </Button>
            <p className="text-caption text-muted">
              JPEG, PNG эсвэл WebP. Нэг зураг дээд тал нь {MAX_UPLOAD_MB} MB.
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
              {step === "saving"
                ? "Хадгалж байна…"
                : step === "uploading"
                  ? "Зураг илгээж байна…"
                  : step === "publishing"
                    ? "Нийтэлж байна…"
                    : "Нийтлэх"}
            </Button>

            <Button type="button" variant="ghost" onClick={() => router.back()} disabled={busy}>
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

/**
 * Who the post is for — everyone, or named children.
 *
 * ★ `null` is "Бүх хүүхэд", and it is not the same as every child ticked.
 *
 * The API reads an empty `targets` array as the whole kindergarten, and a
 * notice aimed that way keeps reaching families who enrol *after* it was
 * posted. Listing every current child instead would freeze the audience at the
 * moment of writing, which is a different and quieter promise. Ticking children
 * individually is the deliberate narrowing; the default stays broad.
 *
 * ★★ The roster is the teacher's own group. `GET /children` is already scoped
 * by `canAccessChild`, so this shows exactly the children they may write about
 * and no filtering happens here — a picker that decided its own list would be
 * the second place that answers "whose children are these", which §1.1 exists
 * to prevent.
 */
function AudiencePicker({
  value,
  onChange,
  disabled,
}: {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled: boolean;
}) {
  const children = useQuery({
    queryKey: qk.children({ pageSize: 200 }),
    queryFn: () => get("/children?pageSize=200", childListSchema),
  });

  const items = children.data?.items ?? [];
  const everyone = value === null;

  function toggle(childId: string) {
    const current = value ?? [];
    const next = current.includes(childId)
      ? current.filter((id) => id !== childId)
      : [...current, childId];
    // Unticking the last one is "everyone" again rather than "nobody", which
    // would be a post with no audience — a state the form should not be able
    // to reach.
    onChange(next.length === 0 ? null : next);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-body font-medium text-ink">Хэнд харагдах</legend>

      <Checkbox
        label="Бүх хүүхэд"
        checked={everyone}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked ? null : [])}
      />

      {children.isLoading ? <p className="text-caption text-muted">Ачаалж байна…</p> : null}

      {!everyone && items.length > 0 ? (
        /*
          Capped and scrolled rather than a list of forty checkboxes pushing
          the publish button off the screen — the client asked for a picker
          that stays usable "олон хүүхэдтэй үед".
        */
        <div className="max-h-[220px] overflow-y-auto rounded-card border border-border p-3">
          <ul className="flex flex-col gap-2">
            {items.map((child) => (
              <li key={child.id}>
                <Checkbox
                  label={`${child.lastName ? `${child.lastName} ` : ""}${child.firstName}`}
                  checked={(value ?? []).includes(child.id)}
                  disabled={disabled}
                  onChange={() => toggle(child.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!everyone && !children.isLoading && items.length === 0 ? (
        <p className="text-caption text-muted">Хүүхэд олдсонгүй.</p>
      ) : null}

      <p className="text-caption text-muted">
        {everyone
          ? "Бүх эцэг эхэд харагдана."
          : `${(value ?? []).length} хүүхдийн эцэг эхэд харагдана.`}
      </p>
    </fieldset>
  );
}
