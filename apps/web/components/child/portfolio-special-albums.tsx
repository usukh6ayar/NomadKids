"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChevronRight, GraduationCap, Plus, School } from "lucide-react";
import { mediaListSchema, type Media } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { ChildGallery } from "@/components/media/child-gallery";
import { MediaThumb } from "@/components/media/media-image";
import { PhotoUpload } from "@/components/media/photo-upload";
import { AlbumLightbox } from "@/components/child/age-photo-album";
import { cn } from "@/lib/utils";

const SPECIAL_ALBUMS = [
  {
    key: "FIRST_DAY",
    title: "Цэцэрлэгийн анхны өдөр",
    Icon: School,
    tone: "from-[#e1f6ff] to-[#effaf5] text-[#2478a9]",
  },
  {
    key: "GRADUATION",
    title: "Цэцэрлэгээ төгслөө",
    Icon: GraduationCap,
    tone: "from-[#fff2df] to-[#fff9ed] text-[#a55c32]",
  },
] as const;

type SpecialAlbumKey = (typeof SPECIAL_ALBUMS)[number]["key"];

function isSpecialAlbum(value: string | null): value is SpecialAlbumKey {
  return SPECIAL_ALBUMS.some((album) => album.key === value);
}

/** The two child-wide milestone albums that deliberately do not belong to an age. */
export function PortfolioSpecialAlbums({
  childId,
  childName,
  canEdit,
}: {
  childId: string;
  childName: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedValue = searchParams.get("special");
  const selectedSpecial = isSpecialAlbum(selectedValue) ? selectedValue : null;
  const [uploadTarget, setUploadTarget] = useState<(typeof SPECIAL_ALBUMS)[number] | null>(null);

  const results = useQueries({
    queries: SPECIAL_ALBUMS.map((album) => ({
      queryKey: qk.childMedia(childId, { special: album.key }),
      queryFn: () =>
        get(`/children/${childId}/media?category=${album.key}&pageSize=1`, mediaListSchema),
    })),
  });

  const selectedAlbum = SPECIAL_ALBUMS.find((album) => album.key === selectedSpecial);
  const closeAlbum = () => router.replace(`/children/${childId}/portfolio/gallery`);

  return (
    <>
      <section aria-labelledby="special-albums-heading">
        <h2 id="special-albums-heading" className="mb-3 text-lead font-semibold text-ink">
          Онцгой цомгууд
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {SPECIAL_ALBUMS.map((album, index) => {
            const page = results[index]?.data;
            const thumbnail: Media | undefined = page?.items[0];
            return (
              <li key={album.key}>
                <Card className="card-interactive relative h-full overflow-hidden">
                  <Link
                    href={`?special=${album.key}#special-gallery`}
                    scroll={false}
                    className="group flex h-full min-h-36 flex-col"
                  >
                    {thumbnail ? (
                      <MediaThumb
                        mediaId={thumbnail.id}
                        caption={album.title}
                        flush
                        className="aspect-[4/3] object-cover"
                      />
                    ) : (
                      <span
                        className={cn(
                          "flex aspect-[4/3] items-center justify-center bg-gradient-to-br",
                          album.tone,
                        )}
                      >
                        <album.Icon size={34} aria-hidden="true" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col p-4">
                      <span className="text-body font-semibold leading-snug text-ink">
                        {album.title}
                      </span>
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

                  {canEdit ? (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute right-2 top-2 z-10 rounded-pill bg-surface/95"
                      aria-label={`${album.title} цомогт зураг нэмэх`}
                      onClick={() => setUploadTarget(album)}
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

      {selectedAlbum ? (
        <AlbumLightbox title={selectedAlbum.title} onClose={closeAlbum}>
          <ChildGallery
            childId={childId}
            childName={childName}
            canEdit={canEdit}
            sectionId="special-gallery"
            title={selectedAlbum.title}
            lede="Онцгой өдрийн дурсамжууд"
            category={selectedAlbum.key}
            uploadLabel="Зураг нэмэх"
            compactEmpty
            uploadWithCaption
          />
        </AlbumLightbox>
      ) : null}

      <FormDialog
        open={Boolean(uploadTarget)}
        onOpenChange={(open) => {
          if (!open) setUploadTarget(null);
        }}
        title={uploadTarget ? `${uploadTarget.title} — зураг нэмэх` : "Зураг нэмэх"}
        description="Онцгой цомогт зураг нэмнэ."
      >
        {uploadTarget ? (
          <PhotoUpload
            childId={childId}
            purpose="CHILD_PHOTO"
            category={uploadTarget.key}
            label="Зураг сонгох"
            variant="primary"
            withCaption
          />
        ) : null}
      </FormDialog>
    </>
  );
}
