"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CakeSlice,
  ChevronRight,
  CircleUserRound,
  Download,
  FolderDown,
  Gift,
  HeartHandshake,
  History,
  Leaf,
  MapPinned,
  PartyPopper,
  Plus,
  School,
  Smile,
  Snowflake,
  Sparkles,
  Star,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";
import {
  AGE_ALBUM_CATEGORIES,
  AGE_ALBUM_CATEGORY_LABEL,
  ageAlbumSummarySchema,
  childDetailSchema,
  mediaListSchema,
  type Media,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ChildGallery } from "@/components/media/child-gallery";
import { MediaThumb } from "@/components/media/media-image";
import { PhotoUpload } from "@/components/media/photo-upload";
import { PhotoLightbox } from "@/components/media/photo-lightbox";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { cn } from "@/lib/utils";

type Age = (typeof PORTFOLIO_AGES)[number];
type AlbumCategory = (typeof AGE_ALBUM_CATEGORIES)[number];
type MediaPage = z.infer<typeof mediaListSchema>;
type UploadTarget = {
  title: string;
  category?: string;
};

export const CATEGORY_ICON: Record<AlbumCategory, LucideIcon> = {
  PORTRAIT: CircleUserRound,
  FAMILY: HeartHandshake,
  TRAVEL: MapPinned,
  KINDERGARTEN: School,
  FRIENDS: Smile,
  ACHIEVEMENT: Trophy,
  NEW_YEAR: Snowflake,
  TSAGAAN_SAR: Sparkles,
  GOLDEN_AUTUMN: Leaf,
  CELEBRATION: PartyPopper,
  BIRTHDAY: CakeSlice,
  OTHER: Gift,
};

const CATEGORY_TONE = [
  "from-[#dff4ff] to-[#fff1e8] text-[#2478a9]",
  "from-[#fff0e6] to-[#fff8d8] text-[#a55c32]",
  "from-[#e6f7ef] to-[#edf4ff] text-[#327d66]",
  "from-[#e8efff] to-[#f4eaff] text-[#526fa8]",
] as const;

const coverResponseSchema = z.object({
  age: z.number(),
  coverMediaFileId: z.uuid(),
});

export function AgePhotoAlbum({ childId, age }: { childId: string; age: Age }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { session, hasRole } = useSession();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null);

  const requestedCategory = searchParams.get("category");
  const selectedCategory = AGE_ALBUM_CATEGORIES.find((item) => item === requestedCategory);
  const selectedSpecial = searchParams.get("special");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });
  const summary = useQuery({
    queryKey: qk.childAgeAlbum(childId, age),
    queryFn: () =>
      get(`/children/${childId}/media/album-summary?age=${age}`, ageAlbumSummarySchema),
  });
  const teacherPhotos = useQuery({
    queryKey: qk.childMedia(childId, { special: "TEACHER", age }),
    queryFn: () =>
      get(
        `/children/${childId}/media?attribution=TEACHER&age=${age}&pageSize=100`,
        mediaListSchema,
      ),
  });
  const setAgeCover = useMutation({
    mutationFn: (mediaId: string) =>
      mutate(`/children/${childId}/media/age-cover`, coverResponseSchema, {
        method: "POST",
        body: { mediaId, age },
      }),
    onSuccess: (result) => {
      toast.success("Насны ковер зураг шинэчлэгдлээ.");
      const summaryKey = qk.childAgeAlbum(childId, age);
      queryClient.setQueryData<z.infer<typeof ageAlbumSummarySchema>>(summaryKey, (current) =>
        current ? { ...current, coverMediaFileId: result.coverMediaFileId } : current,
      );
      void queryClient.invalidateQueries({ queryKey: summaryKey, refetchType: "inactive" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (child.isLoading || summary.isLoading) return <LoadingState rows={5} />;
  if (child.isError || summary.isError) {
    return <ErrorState description="Зургийн санг ачаалж чадсангүй." />;
  }

  const data = child.data!;
  const canEdit =
    hasRole("TEACHER") ||
    hasRole("ADMIN") ||
    data.guardianships.some(
      (item) => item.guardian?.id === session?.user.id && item.canView !== false,
    );
  const canUploadTeacherPhotos = hasRole("TEACHER") || hasRole("ADMIN");

  /*
   * ★ Closes the dialog and says so — 2026-09-10.
   *
   * This only invalidated the summary. The upload really did succeed, but the
   * modal stayed open over the album with nothing changed on it and no
   * message, so the photograph appearing behind the dialog was the only
   * evidence — and it is covered by the dialog. Every report of this read as
   * "adding a photo does not work".
   *
   * `onUploaded` fires once per stored file, so the toast is raised after the
   * batch rather than inside the loop.
   */
  const refreshAlbum = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.childAgeAlbum(childId, age) });
    await queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
  };

  const finishUpload = () => {
    setUploadOpen(false);
    setUploadTarget(null);
    toast.success("Зураг нэмэгдлээ.");
  };

  const openUpload = (category: AlbumCategory) => {
    setUploadTarget({ title: AGE_ALBUM_CATEGORY_LABEL[category], category });
    setUploadOpen(true);
  };

  const closeAlbum = () => router.replace(`/children/${childId}/portfolio/gallery/${age}`);

  return (
    <div className="flex flex-col gap-6 py-2">
      <nav aria-label="Breadcrumb" className="overflow-x-auto text-caption text-muted">
        <ol className="flex min-w-max items-center gap-2">
          <li>
            <Link className="hover:text-primary" href={`/children/${childId}/portfolio`}>
              Цахим хувийн хавтас
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link className="hover:text-primary" href={`/children/${childId}/portfolio/gallery`}>
              Зургийн цомог
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-medium text-ink" aria-current="page">
            {age} нас
          </li>
        </ol>
      </nav>

      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/portfolio/gallery`}>
          <ArrowLeft size={18} />
          Зургийн цомог
        </Link>
      </Button>

      <DevelopmentHistoryLink childId={childId} />

      <section aria-labelledby="age-photo-library-heading">
        <h1 id="age-photo-library-heading" className="text-heading font-semibold text-ink">
          {age} насны зургийн сан
        </h1>

        <TeacherAlbumCard
          childId={childId}
          age={age}
          page={teacherPhotos.data}
          canUpload={canEdit && canUploadTeacherPhotos}
          onUpload={(target) => {
            setUploadTarget(target);
            setUploadOpen(true);
          }}
        />
      </section>

      <section aria-labelledby="album-types-heading">
        <h2 id="album-types-heading" className="mb-3 text-lead font-semibold text-ink">
          Зургийн төрлүүд
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summary.data!.categories.map((item, index) => {
            const Icon = CATEGORY_ICON[item.category];
            const href = `?category=${item.category}#selected-album`;
            return (
              <li key={item.category} className="flex">
                <Card className="card-interactive relative flex w-full flex-col overflow-hidden">
                  <Link
                    href={href}
                    scroll={false}
                    aria-label={`${AGE_ALBUM_CATEGORY_LABEL[item.category]}, ${item.count} зураг`}
                    className="group flex min-h-full flex-1 flex-col"
                  >
                    {item.thumbnailMediaId ? (
                      <MediaThumb
                        mediaId={item.thumbnailMediaId}
                        caption={AGE_ALBUM_CATEGORY_LABEL[item.category]}
                        flush
                        className="aspect-[4/3]"
                      />
                    ) : (
                      <span
                        className={cn(
                          "flex aspect-[4/3] items-center justify-center bg-gradient-to-br",
                          CATEGORY_TONE[index % CATEGORY_TONE.length],
                        )}
                      >
                        <Icon size={34} aria-hidden="true" />
                      </span>
                    )}
                    <span className="flex flex-1 flex-col px-3.5 py-3">
                      <span className="min-h-10 text-body font-semibold leading-snug text-ink">
                        {AGE_ALBUM_CATEGORY_LABEL[item.category]}
                      </span>
                      <span className="mt-2 flex items-center justify-between text-caption text-muted">
                        {item.count} зураг
                        <ChevronRight
                          size={17}
                          aria-hidden="true"
                          className="text-primary transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                      <span className="mt-auto h-[52px] pt-2" aria-hidden="true" />
                    </span>
                  </Link>

                  {canEdit ? (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute right-2 top-2 z-10 rounded-pill bg-surface/95"
                      aria-label={`${AGE_ALBUM_CATEGORY_LABEL[item.category]} ангилалд зураг нэмэх`}
                      onClick={() => openUpload(item.category)}
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      {selectedCategory ? (
        <AlbumLightbox title={AGE_ALBUM_CATEGORY_LABEL[selectedCategory]} onClose={closeAlbum}>
          <ChildGallery
            childId={childId}
            childName={`${data.lastName} ${data.firstName}`}
            canEdit={canEdit}
            sectionId="selected-album"
            title={AGE_ALBUM_CATEGORY_LABEL[selectedCategory]}
            lede={`${age} нас · ${AGE_ALBUM_CATEGORY_LABEL[selectedCategory]}`}
            age={age}
            category={selectedCategory}
            uploadLabel="Энэ ангилалд зураг нэмэх"
            compactEmpty
            uploadWithCaption
            coverAge={age}
            currentCoverMediaId={summary.data!.coverMediaFileId}
          />
        </AlbumLightbox>
      ) : null}

      {selectedSpecial === "TEACHER" ? (
        <AlbumLightbox title="Багшийн илгээсэн зураг" onClose={closeAlbum}>
          <TeacherPhotoFolder
            childId={childId}
            age={age}
            initialPage={teacherPhotos.data}
            canDownload={canEdit}
            currentCoverMediaId={summary.data!.coverMediaFileId}
            onSetCover={(mediaId) => setAgeCover.mutate(mediaId)}
            coverBusy={setAgeCover.isPending}
          />
        </AlbumLightbox>
      ) : null}

      <FormDialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) setUploadTarget(null);
        }}
        title={uploadTarget ? `${uploadTarget.title} — зураг нэмэх` : "Зураг нэмэх"}
        description={`${age} насны дурсамжид зураг нэмнэ.`}
      >
        {uploadTarget ? (
          <PhotoUpload
            childId={childId}
            purpose="CHILD_PHOTO"
            age={age}
            category={uploadTarget.category}
            label="Зураг сонгох"
            variant="primary"
            withCaption
            onUploaded={refreshAlbum}
            onDone={finishUpload}
          />
        ) : null}
      </FormDialog>
    </div>
  );
}

export function DevelopmentHistoryLink({ childId }: { childId: string }) {
  return (
    <Button asChild variant="secondary" size="sm" className="self-start">
      <Link href={`/children/${childId}/portfolio/gallery/history`}>
        <History size={17} aria-hidden="true" />
        Зургийн цомог 2-5 нас
      </Link>
    </Button>
  );
}

function TeacherAlbumCard({
  childId,
  age,
  page,
  canUpload,
  onUpload,
}: {
  childId: string;
  age: Age;
  page?: MediaPage;
  canUpload: boolean;
  onUpload: (target: UploadTarget) => void;
}) {
  const title = "Багшийн илгээсэн зураг";

  return (
    <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <li>
        <Card className="card-interactive relative h-full overflow-hidden">
          <Link
            href="?special=TEACHER#special-gallery"
            scroll={false}
            className="group flex h-full min-h-36 flex-col"
          >
            {page?.items[0] ? (
              <MediaThumb
                mediaId={page.items[0].id}
                caption={title}
                flush
                className="aspect-[4/3] object-cover"
              />
            ) : (
              <span className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[#eeeaff] to-[#eaf5ff] text-[#5c63a8]">
                <FolderDown size={34} aria-hidden="true" />
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col p-4">
              <span className="text-body font-semibold leading-snug text-ink">{title}</span>
              <span className="mt-2 text-caption text-muted">
                {page ? `${page.total} зураг` : "Ачаалж байна…"}
              </span>
              <ChevronRight
                size={18}
                aria-hidden="true"
                className="mt-auto self-end text-primary transition-transform group-hover:translate-x-0.5"
              />
            </span>
          </Link>

          {canUpload ? (
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-2 top-2 z-10 rounded-pill bg-surface/95"
              aria-label={`${title} цомогт зураг нэмэх`}
              onClick={() => onUpload({ title })}
            >
              <Plus aria-hidden="true" />
            </Button>
          ) : null}

          {page?.items.length ? (
            <DownloadAllButton childId={childId} age={age} initialPage={page} compact />
          ) : null}
        </Card>
      </li>
    </ul>
  );
}

function triggerMediaDownload(media: Media) {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.src = `${mediaUrl(media.id)}?download=1`;
  frame.title = `${media.originalName ?? "зураг"} татаж авах`;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 60_000);
}

function DownloadAllButton({
  childId,
  age,
  initialPage,
  compact = false,
}: {
  childId: string;
  age: Age;
  initialPage: MediaPage;
  compact?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);

  const downloadAll = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const items = [...initialPage.items];
      for (let page = 2; page <= initialPage.totalPages; page += 1) {
        const next = await get(
          `/children/${childId}/media?attribution=TEACHER&age=${age}&pageSize=100&page=${page}`,
          mediaListSchema,
        );
        items.push(...next.items);
      }
      items.forEach(triggerMediaDownload);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      variant="secondary"
      size={compact ? "icon" : "sm"}
      className={compact ? "absolute bottom-2 right-2 z-10 bg-surface/95" : undefined}
      aria-label="Багшийн илгээсэн бүх зургийг татах"
      disabled={downloading || initialPage.total === 0}
      onClick={() => void downloadAll()}
    >
      <Download aria-hidden="true" />
      {compact ? null : downloading ? "Бэлтгэж байна…" : "Бүгдийг татах"}
    </Button>
  );
}

function TeacherPhotoFolder({
  childId,
  age,
  initialPage,
  canDownload,
  currentCoverMediaId,
  onSetCover,
  coverBusy,
}: {
  childId: string;
  age: Age;
  initialPage?: MediaPage;
  canDownload: boolean;
  currentCoverMediaId: string | null;
  onSetCover: (mediaId: string) => void;
  coverBusy: boolean;
}) {
  if (!initialPage) return <LoadingState rows={3} />;

  return (
    <section id="special-gallery" aria-labelledby="teacher-folder-heading" className="scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="teacher-folder-heading" className="text-heading font-semibold text-ink">
            Багшийн илгээсэн зураг
          </h2>
          <p className="mt-1 text-body text-muted">Татаж авах хавтас · {initialPage.total} зураг</p>
        </div>
        {canDownload ? (
          <DownloadAllButton childId={childId} age={age} initialPage={initialPage} />
        ) : null}
      </div>

      <Card pad="roomy">
        {initialPage.items.length === 0 ? (
          <p className="py-8 text-center text-body text-muted">Багшийн илгээсэн зураг алга.</p>
        ) : (
          <TeacherPhotoGrid
            items={initialPage.items}
            age={age}
            canDownload={canDownload}
            currentCoverMediaId={currentCoverMediaId}
            onSetCover={onSetCover}
            coverBusy={coverBusy}
          />
        )}
      </Card>
    </section>
  );
}

function TeacherPhotoGrid({
  items,
  age,
  canDownload,
  currentCoverMediaId,
  onSetCover,
  coverBusy,
}: {
  items: Media[];
  age: Age;
  canDownload: boolean;
  currentCoverMediaId: string | null;
  onSetCover: (mediaId: string) => void;
  coverBusy: boolean;
}) {
  const [viewing, setViewing] = useState<Media | null>(null);

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((photo) => {
          const isAgeCover = photo.id === currentCoverMediaId;
          return (
            <li key={photo.id} className="group relative overflow-hidden rounded-control">
              <button
                type="button"
                className="block w-full"
                onClick={() => setViewing(photo)}
                aria-label={`${photo.caption || "Зураг"} — томоор харах`}
              >
                <MediaThumb mediaId={photo.id} caption={photo.caption} />
              </button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className={cn(
                  "absolute right-2 top-2 rounded-pill shadow-sm",
                  isAgeCover
                    ? "border-[#d99a08] bg-[#f5b82e] text-white hover:border-[#c78b00] hover:bg-[#e5a817]"
                    : "border-border bg-surface/95 text-muted hover:border-[#d99a08] hover:text-[#b87c00]",
                )}
                aria-label={
                  isAgeCover ? `${age} насны ковер зураг` : `${age} насны ковер зураг болгох`
                }
                aria-pressed={isAgeCover}
                disabled={coverBusy}
                onClick={() => onSetCover(photo.id)}
              >
                <Star aria-hidden="true" fill={isAgeCover ? "currentColor" : "none"} />
              </Button>
              {canDownload ? (
                <a
                  href={`${mediaUrl(photo.id)}?download=1`}
                  aria-label="Энэ зургийг татах"
                  className="absolute bottom-2 right-2 grid size-11 place-items-center rounded-pill border border-border bg-surface/95 text-primary shadow-sm transition-transform hover:-translate-y-0.5"
                >
                  <Download size={18} aria-hidden="true" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      {viewing ? (
        <PhotoLightbox
          mediaId={viewing.id}
          caption={viewing.caption}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  );
}

export function AlbumLightbox({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} цомог`}
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/55 p-2 sm:p-5"
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[calc(100vh-1rem)] w-full max-w-6xl overflow-y-auto rounded-card border border-border bg-canvas p-3 shadow-lg sm:max-h-[calc(100vh-2.5rem)] sm:p-5">
        <div className="sticky top-0 z-20 mb-2 flex justify-end bg-canvas/95 py-1">
          <Button variant="secondary" size="icon" onClick={onClose} aria-label="Цомгийг хаах">
            <X aria-hidden="true" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
