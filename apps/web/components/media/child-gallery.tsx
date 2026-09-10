"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { MoreVertical, Pencil, Star, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  mediaListSchema,
  mediaSchema,
  ageAlbumSummarySchema,
  MEDIA_CATEGORIES,
  MEDIA_CATEGORY_LABEL,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { useSession } from "@/lib/auth/session";
import { GALLERY } from "@/lib/vocabulary";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { MediaThumb } from "@/components/media/media-image";
import { PhotoUpload } from "@/components/media/photo-upload";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const ageCoverResponseSchema = z.object({
  age: z.number(),
  coverMediaFileId: z.uuid(),
});

/**
 * ★ One page, deliberately large — an interim, not the destination.
 *
 * `GET /children/:id/media` is now paginated (it was not, and returned every
 * photograph a child had). This screen has no pager yet, so it asks for the
 * API's maximum and *says so* when there are more. Silently showing the first
 * twenty-five of ninety would be a worse regression than the unbounded list it
 * replaces, because nothing on screen would reveal it.
 */
const GALLERY_PAGE_SIZE = 100;

/**
 * A child's photographs and work.
 *
 * ★ Everything is here, whichever way it arrived: a photo attached to an
 * observation and a picture of a drawing uploaded on its own are the same thing
 * to a parent looking at their child's year. The API stores the difference as
 * `purpose`, and this reads both lists rather than making a family go to two
 * places for one idea.
 *
 * ★★ There is still no "artwork" *purpose*. `MediaPurpose` says how a
 * photograph got here, and adding a value to it is a schema migration; what
 * kind of picture it is now lives in `category` (RFP §4.4), which is a plain
 * column precisely so the vocabulary can change without one.
 *
 * Deleting archives rather than removing: `DELETE /media/:id` sets a status, so
 * a photo taken out of the gallery still exists for the audit trail.
 *
 * ★★★ `category`/`age` turn this into a filtered album view — added
 * 2026-09-05 for the overview page's age-filtered and fixed (first day,
 * graduation) galleries, on the client's instruction. A second, parallel
 * gallery component was the alternative; reusing this one instead means the
 * upload flow, the delete confirmation and the pagination footnote stay one
 * implementation rather than three that can drift. `sectionId` exists only
 * so more than one instance on a page does not collide on `id="gallery"`.
 */
export function ChildGallery({
  childId,
  childName,
  canEdit,
  photoMediaFileId,
  sectionId = "gallery",
  title = GALLERY,
  lede = "Ажиглалтад хавсаргасан болон тусад нь нэмсэн бүх зураг.",
  category,
  age,
  emptyTitle = "Зураг алга",
  emptyDescription,
  uploadLabel = "Зураг нэмэх",
  uploadHint,
  compactEmpty = false,
  uploadWithCaption = false,
  coverAge,
  currentCoverMediaId,
}: {
  childId: string;
  childName?: string;
  /** Staff and guardians who may record. Read-only viewers get the grid alone. */
  canEdit: boolean;
  /** The current profile picture, so it can be marked and not offered again. */
  photoMediaFileId?: string | null;
  sectionId?: string;
  title?: string;
  lede?: string;
  /** Filters to one album "ангилал" — omit for every category at once. */
  category?: string;
  /** Filters to one "нас" — omit for every age at once. */
  age?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  uploadLabel?: string;
  uploadHint?: ReactNode | null;
  /** Hides the verbose empty-state copy inside an album modal. */
  compactEmpty?: boolean;
  uploadWithCaption?: boolean;
  /** When supplied, every photo gets a star that selects this age's cover. */
  coverAge?: number;
  currentCoverMediaId?: string | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { session, hasRole } = useSession();
  const [viewing, setViewing] = useState<string | null>(null);
  /** The photo whose caption is being rewritten, and the draft text. */
  const [editing, setEditing] = useState<z.infer<typeof mediaSchema> | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [deleting, setDeleting] = useState<z.infer<typeof mediaSchema> | null>(null);
  const filters = { pageSize: GALLERY_PAGE_SIZE, category, age };

  /*
   * ★ Who may retitle or remove *this* photograph.
   *
   * Staff may manage any photo of a child they record for; a guardian may
   * manage only what they uploaded themselves. That is exactly the rule
   * `MediaService.updateMetadata` and `archive` enforce, mirrored here so the
   * menu is absent rather than present-and-404. `uploadedBy` can be null on
   * rows that predate it, which stays staff-only for the same reason.
   */
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
  const canManage = (photo: z.infer<typeof mediaSchema>) =>
    canEdit &&
    (isStaff || (photo.uploadedBy?.id !== undefined && photo.uploadedBy.id === session?.user.id));

  const photos = useQuery({
    queryKey: qk.childMedia(childId, filters),
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: String(GALLERY_PAGE_SIZE) });
      if (category) params.set("category", category);
      if (age) params.set("age", String(age));
      return get(`/children/${childId}/media?${params}`, mediaListSchema);
    },
  });

  const setProfile = useMutation({
    mutationFn: (mediaId: string) =>
      mutate(`/children/${childId}/media/profile-photo`, z.unknown(), {
        method: "POST",
        body: { mediaId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
    },
  });

  const remove = useMutation({
    mutationFn: (mediaId: string) => mutate(`/media/${mediaId}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      setViewing(null);
      setDeleting(null);
      toast.success("Зураг устгагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /**
   * The metadata editor — caption plus album `category`/`age`, RFP §4.4.
   *
   * ★ `caption` was missing until 2026-09-10. The API has always accepted it
   * (`updateMediaSchema`), and `PhotoUpload` can set one at upload time, but
   * nothing in the product could change it afterwards — so a caption typed
   * wrongly, or left blank, was permanent.
   */
  const update = useMutation({
    mutationFn: ({
      mediaId,
      patch,
    }: {
      mediaId: string;
      patch: { caption?: string | null; category?: string | null; age?: number | null };
    }) => mutate(`/media/${mediaId}`, mediaSchema, { method: "PATCH", body: patch }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) }),
  });

  const saveCaption = useMutation({
    mutationFn: ({ mediaId, caption }: { mediaId: string; caption: string }) =>
      mutate(`/media/${mediaId}`, mediaSchema, {
        method: "PATCH",
        // Emptied means cleared, not "leave alone" — `updateMediaSchema` is
        // `.nullable()` for exactly this, and sending "" would store a blank.
        body: { caption: caption.trim() || null },
      }),
    onSuccess: () => {
      setEditing(null);
      toast.success("Зургийн тайлбар шинэчлэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const setAgeCover = useMutation({
    mutationFn: (mediaId: string) =>
      mutate(`/children/${childId}/media/age-cover`, ageCoverResponseSchema, {
        method: "POST",
        body: { mediaId, age: coverAge },
      }),
    onSuccess: (result) => {
      toast.success("Насны ковер зураг шинэчлэгдлээ.");
      if (coverAge) {
        const summaryKey = qk.childAgeAlbum(childId, coverAge);
        queryClient.setQueryData<z.infer<typeof ageAlbumSummarySchema>>(summaryKey, (current) =>
          current ? { ...current, coverMediaFileId: result.coverMediaFileId } : current,
        );
        void queryClient.invalidateQueries({ queryKey: summaryKey, refetchType: "inactive" });
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items = photos.data?.items ?? [];
  const total = photos.data?.total ?? 0;
  const truncated = total > items.length;
  const viewingPhoto = items.find((p) => p.id === viewing);

  return (
    <section id={sectionId} aria-labelledby={`${sectionId}-heading`} className="scroll-mt-20">
      <SectionHeader id={`${sectionId}-heading`} title={title} lede={lede} as="h2" />

      <Card pad="roomy" className="flex flex-col gap-4">
        {photos.isLoading ? <LoadingState rows={2} /> : null}

        {photos.isError ? <ErrorState description="Зургийг ачаалж чадсангүй." /> : null}

        {photos.data && items.length === 0 && !compactEmpty ? (
          <EmptyState
            icon={<Image src="/background/mascot-girl-purple.webp" alt="" width={96} height={96} />}
            title={emptyTitle}
            description={
              emptyDescription ??
              (canEdit
                ? "Хүүхдийн бүтээл, тоглож буй мөчийг нэмж эхлээрэй."
                : "Багш зураг нэмэхэд энд харагдана.")
            }
          />
        ) : null}

        {items.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {items.map((photo) => {
              const isProfile = photo.id === photoMediaFileId;
              const isAgeCover = photo.id === currentCoverMediaId;
              return (
                <li key={photo.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setViewing(photo.id)}
                    // The grid is a set of buttons, not links: opening a photo
                    // is a state change on this page, and a link would put a
                    // presigned URL in the address bar.
                    className="block w-full overflow-hidden rounded-control focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <MediaThumb mediaId={photo.id} caption={photo.caption} />
                    <span className="sr-only">
                      {photo.caption || "Тэмдэглэлгүй зураг"} — томоор харах
                    </span>
                  </button>

                  {isProfile ? (
                    <span
                      className="absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-pill bg-primary text-primary-ink"
                      title="Хувийн зураг"
                    >
                      <Star size={13} aria-hidden="true" />
                      <span className="sr-only">Хувийн зураг</span>
                    </span>
                  ) : null}

                  {/*
                    ★ The per-photo menu — 2026-09-10, on the client's request.
                    Editing and removing used to live only inside the lightbox,
                    which meant opening a photograph full-screen to fix a typo
                    in its caption. `bottom-1.5` keeps it clear of the cover
                    star, which owns the top-right corner when `coverAge` is set.
                  */}
                  {canManage(photo) ? (
                    <RowMenu
                      className="absolute bottom-1.5 right-1.5"
                      ariaLabel={`${photo.caption || "Тэмдэглэлгүй зураг"} үйлдэл`}
                      triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
                      items={[
                        {
                          label: "Засах",
                          icon: <Pencil size={16} />,
                          onSelect: () => {
                            setDraftCaption(photo.caption ?? "");
                            setEditing(photo);
                          },
                        },
                        {
                          label: "Устгах",
                          icon: <Trash2 size={16} />,
                          tone: "danger",
                          onSelect: () => setDeleting(photo),
                        },
                      ]}
                    />
                  ) : null}

                  {coverAge ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className={cn(
                        "absolute right-1.5 top-1.5 rounded-pill shadow-sm",
                        isAgeCover
                          ? "border-[#d99a08] bg-[#f5b82e] text-white hover:border-[#c78b00] hover:bg-[#e5a817]"
                          : "border-border bg-surface/95 text-muted hover:border-[#d99a08] hover:text-[#b87c00]",
                      )}
                      aria-label={
                        isAgeCover
                          ? `${coverAge} насны ковер зураг`
                          : `${coverAge} насны ковер зураг болгох`
                      }
                      aria-pressed={isAgeCover}
                      disabled={setAgeCover.isPending}
                      onClick={() => setAgeCover.mutate(photo.id)}
                    >
                      <Star aria-hidden="true" fill={isAgeCover ? "currentColor" : "none"} />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {truncated ? (
          <p className="text-compact text-muted">
            Хамгийн сүүлийн {items.length} зураг харагдаж байна. Нийт {total}.
          </p>
        ) : null}

        {canEdit ? (
          <PhotoUpload
            childId={childId}
            purpose="CHILD_PHOTO"
            category={category}
            age={age}
            label={uploadLabel}
            withCaption={uploadWithCaption}
            hint={
              uploadHint ??
              "Бүтээл, зурсан зураг, тоглож буй мөч. JPEG, PNG эсвэл WebP, 10 MB хүртэл."
            }
          />
        ) : null}
      </Card>

      {viewing && viewingPhoto ? (
        <PhotoViewer
          mediaId={viewing}
          childName={childName}
          caption={viewingPhoto.caption}
          canEdit={canEdit}
          isProfile={viewing === photoMediaFileId}
          currentCategory={viewingPhoto.category ?? null}
          currentAge={viewingPhoto.age ?? null}
          onClose={() => setViewing(null)}
          onSetProfile={() => setProfile.mutate(viewing)}
          onRemove={() => remove.mutate(viewing)}
          onUpdate={(patch) => update.mutate({ mediaId: viewing, patch })}
          busy={setProfile.isPending || remove.isPending}
          updating={update.isPending}
        />
      ) : null}

      <FormDialog
        open={editing !== null}
        onOpenChange={(next) => (next ? undefined : setEditing(null))}
        busy={saveCaption.isPending}
        title="Зургийн тайлбар"
        description="Энэ зургийн тайлбарыг өөрчилнө."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={saveCaption.isPending}
              onClick={() => setEditing(null)}
            >
              Болих
            </Button>
            <Button
              type="submit"
              form="gallery-caption-form"
              size="sm"
              disabled={saveCaption.isPending}
            >
              {saveCaption.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id="gallery-caption-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!editing || saveCaption.isPending) return;
            saveCaption.mutate({ mediaId: editing.id, caption: draftCaption });
          }}
        >
          <Field label="Тайлбар">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={draftCaption}
                maxLength={255}
                autoFocus
                placeholder="Жишээ: Манай гэр бүлийн дурсамж"
                onChange={(event) => setDraftCaption(event.target.value)}
              />
            )}
          </Field>
        </form>
      </FormDialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title="Зургийг устгах уу?"
        description={
          deleting?.caption
            ? `"${deleting.caption}" цомгоос хасагдана.`
            : "Энэ зураг цомгоос хасагдана."
        }
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </section>
  );
}

/**
 * Full-size view.
 *
 * A thumbnail is a 100px crop of a drawing, which is not enough to see what a
 * child made. Escape closes it, and focus is trapped by the backdrop being the
 * only other target.
 *
 * ★ The actions are no longer only here — 2026-09-10.
 *
 * They used to be, and the reason given was that "a delete button on a grid of
 * forty photos is forty chances to lose one by mistake". That reason still
 * holds and is what shapes the tile menu rather than what rules it out: the
 * tile carries an overflow menu, not a delete button, and choosing "Устгах"
 * opens the same confirmation. Two deliberate acts, which is what the original
 * objection was actually asking for. What it cost meanwhile was making someone
 * open a photograph full-screen to fix a typo in its caption.
 */
function PhotoViewer({
  mediaId,
  childName,
  caption,
  canEdit,
  isProfile,
  currentCategory,
  currentAge,
  onClose,
  onSetProfile,
  onRemove,
  onUpdate,
  busy,
  updating,
}: {
  mediaId: string;
  childName?: string;
  caption?: string | null;
  canEdit: boolean;
  isProfile: boolean;
  /** The album's current "ангилал"/"нас" facets — `null` when never tagged. */
  currentCategory: string | null;
  currentAge: number | null;
  onClose: () => void;
  onSetProfile: () => void;
  onRemove: () => void;
  onUpdate: (patch: { category?: string | null; age?: number | null }) => void;
  busy: boolean;
  updating: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while this is open, or a phone drags the
    // list around underneath the photo.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption || `${childName ?? "Хүүхдийн"} зураг`}
      className="fixed inset-0 z-50 flex flex-col bg-ink/80 p-4"
    >
      {/* The backdrop closes it. `aria-hidden` because the ✕ below is the
          accessible way out and announcing a second one is noise. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      <div className="relative z-10 flex justify-end">
        <Button variant="secondary" size="icon" onClick={onClose} aria-label="Хаах">
          <X size={18} />
        </Button>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center py-3">
        {/* A plain <img>, not next/image: the src is a 302 to a presigned URL
            that expires in five minutes, so there is nothing for the optimiser
            to cache and it must not try. Same reasoning as `mediaUrl`. */}
        <img
          src={mediaUrl(mediaId)}
          alt={caption || `${childName ?? "Хүүхдийн"} зураг`}
          className="max-h-full max-w-full rounded-row object-contain"
        />
      </div>

      <div className="relative z-10 flex flex-col gap-3 rounded-row bg-surface px-4 py-3">
        {/*
          ★ The album's "нас"/"ангилал" facets — RFP §4.4 — editable here
          rather than at upload time. `PhotoUpload` pre-tags a *whole batch*
          with one age or category (the age-filtered and fixed galleries pass
          it as a prop), but a single photo already in the album needs its own
          correction without re-uploading it, the same reason `caption` has
          never been upload-only either.
        */}
        {canEdit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ангилал">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  disabled={updating}
                  value={currentCategory ?? ""}
                  onChange={(e) => onUpdate({ category: e.target.value || null })}
                >
                  <option value="">Байхгүй</option>
                  {MEDIA_CATEGORIES.map((code) => (
                    <option key={code} value={code}>
                      {MEDIA_CATEGORY_LABEL[code]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Нас">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  disabled={updating}
                  value={currentAge ? String(currentAge) : ""}
                  onChange={(e) =>
                    onUpdate({ age: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">Байхгүй</option>
                  {PORTFOLIO_AGES.map((age) => (
                    <option key={age} value={age}>
                      {age} нас
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-body text-ink">
            {caption || <span className="text-muted">Тэмдэглэлгүй</span>}
          </p>

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {isProfile ? (
                <span className="text-caption font-semibold text-primary">Хувийн зураг</span>
              ) : (
                <Button variant="secondary" size="sm" onClick={onSetProfile} disabled={busy}>
                  <Star size={16} />
                  Хувийн зураг болгох
                </Button>
              )}

              {confirming ? (
                // Confirmed inline rather than in a second dialog — CLAUDE.md §5
                // asks for a confirmation before a delete, not for a dialog on
                // top of a dialog.
                <span className="flex items-center gap-2">
                  <span className="text-caption text-muted">Устгах уу?</span>
                  <Button variant="danger" size="sm" onClick={onRemove} disabled={busy}>
                    Тийм
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Үгүй
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                >
                  <Trash2 size={16} />
                  Устгах
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
