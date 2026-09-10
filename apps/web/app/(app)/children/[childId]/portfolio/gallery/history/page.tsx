"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Images } from "lucide-react";
import {
  AGE_ALBUM_CATEGORIES,
  AGE_ALBUM_CATEGORY_LABEL,
  mediaListSchema,
  type Media,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { MediaThumb } from "@/components/media/media-image";
import { PhotoLightbox } from "@/components/media/photo-lightbox";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { CATEGORY_ICON } from "@/components/child/age-photo-album";

const PAGE_SIZE = 100;

type AlbumCategory = (typeof AGE_ALBUM_CATEGORIES)[number];

async function getEveryPhotoForAge(childId: string, age: number): Promise<Media[]> {
  const first = await get(
    `/children/${childId}/media?age=${age}&pageSize=${PAGE_SIZE}&page=1`,
    mediaListSchema,
  );
  const items = [...first.items];

  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await get(
      `/children/${childId}/media?age=${age}&pageSize=${PAGE_SIZE}&page=${page}`,
      mediaListSchema,
    );
    items.push(...next.items);
  }

  return items;
}

/** `photo.category` is nullish — it predates the field, or was never set. */
function isKnownCategory(value: string | null | undefined): value is AlbumCategory {
  return Boolean(value) && (AGE_ALBUM_CATEGORIES as readonly string[]).includes(value as string);
}

/**
 * The child-wide photo timeline, limited to photos assigned to ages 2–5.
 *
 * ★ Grouped by photo type, not by age — 2026-09-09.
 *
 * "2 нас" followed by "3 нас" put every photo taken that year in one pile,
 * which answers "what happened at 2" but not the question this screen is for:
 * how the *same kind* of photo changed. "Цээж зураг" (`PORTRAIT`) is now one
 * section holding the age-2 through age-5 portraits side by side, in that
 * order, so the progression reads left to right within the type instead of
 * being scattered across four year-groups. A photo with no category — never
 * set, or uploaded before the field existed — falls into "Бусад" rather than
 * disappearing.
 */
export default function PhotoHistoryPage() {
  const { childId } = useParams<{ childId: string }>();
  const [viewing, setViewing] = useState<Media | null>(null);
  const photoQueries = useQueries({
    queries: PORTFOLIO_AGES.map((age) => ({
      queryKey: qk.childMedia(childId, { view: "age-history", age }),
      queryFn: () => getEveryPhotoForAge(childId, age),
    })),
  });

  if (photoQueries.some((query) => query.isLoading)) return <LoadingState rows={5} />;
  if (photoQueries.some((query) => query.isError)) {
    return <ErrorState description="2-5 насны зургийн цомгийг ачаалж чадсангүй." />;
  }

  const byAge = PORTFOLIO_AGES.map((age, index) => ({
    age,
    photos: photoQueries[index]?.data ?? [],
  }));
  const total = byAge.reduce((sum, group) => sum + group.photos.length, 0);

  const byCategory = AGE_ALBUM_CATEGORIES.map((category) => ({
    category,
    // Age order within the category is what makes it a progression rather
    // than just a filtered pile.
    photos: byAge.flatMap(({ age, photos }) =>
      photos
        .filter((photo) =>
          category === "OTHER" ? !isKnownCategory(photo.category) : photo.category === category,
        )
        .map((photo) => ({ ...photo, age })),
    ),
  })).filter((group) => group.photos.length > 0);

  return (
    <div className="flex flex-col gap-5 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/portfolio/gallery`}>
          <ArrowLeft size={18} aria-hidden="true" />
          Зургийн цомог
        </Link>
      </Button>

      <header>
        <h1 className="text-heading font-semibold text-ink">Зургийн цомог 2-5 нас</h1>
        <p className="mt-1 text-body text-muted">
          Зургийн төрлөөр насны ахицыг харьцуулна · {total} зураг
        </p>
      </header>

      {total === 0 ? (
        <EmptyState
          icon={<Images size={32} aria-hidden="true" />}
          title="Зураг оруулаагүй байна"
          description="Насны цомогт нэмсэн зургууд энд нэг дор харагдана."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {byCategory.map(({ category, photos }) => {
            const Icon = CATEGORY_ICON[category];
            return (
              <section key={category} aria-labelledby={`category-${category}-photos-heading`}>
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <h2
                    id={`category-${category}-photos-heading`}
                    className="flex items-center gap-2 text-lead font-semibold text-ink"
                  >
                    <Icon size={18} aria-hidden="true" className="text-primary" />
                    {AGE_ALBUM_CATEGORY_LABEL[category]}
                  </h2>
                  <span className="text-caption text-muted">{photos.length} зураг</span>
                </div>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {photos.map((photo) => (
                    <li key={photo.id}>
                      <button
                        type="button"
                        aria-label={`${photo.age} нас — ${photo.caption || "зураг"} томоор харах`}
                        className="card-interactive relative block w-full overflow-hidden rounded-row border border-border bg-surface p-1 shadow-sm focus-visible:outline-2 focus-visible:outline-primary"
                        onClick={() => setViewing(photo)}
                      >
                        <MediaThumb
                          mediaId={photo.id}
                          caption={photo.caption}
                          className="rounded-row"
                        />
                        <span className="absolute bottom-2 left-2 rounded-pill bg-ink/70 px-2 py-0.5 text-caption font-semibold text-white">
                          {photo.age} нас
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {viewing ? (
        <PhotoLightbox
          mediaId={viewing.id}
          caption={viewing.caption}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
