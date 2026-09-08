"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronRight, Images } from "lucide-react";
import { ageAlbumSummarySchema, childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { MediaThumb } from "@/components/media/media-image";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { PORTFOLIO } from "@/lib/vocabulary";
import { DevelopmentHistoryLink } from "@/components/child/age-photo-album";
import { PortfolioSpecialAlbums } from "@/components/child/portfolio-special-albums";
import { useSession } from "@/lib/auth/session";

export default function PhotoAlbumLandingPage() {
  const { childId } = useParams<{ childId: string }>();
  const { session, hasRole } = useSession();
  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });
  const summaries = useQueries({
    queries: PORTFOLIO_AGES.map((age) => ({
      queryKey: qk.childAgeAlbum(childId, age),
      queryFn: () =>
        get(`/children/${childId}/media/album-summary?age=${age}`, ageAlbumSummarySchema),
    })),
  });

  if (child.isLoading) return <LoadingState rows={4} />;
  if (child.isError) return <ErrorState description="Зургийн цомгийг ачаалж чадсангүй." />;

  const data = child.data!;
  const canEdit =
    hasRole("TEACHER") ||
    hasRole("ADMIN") ||
    data.guardianships.some(
      (item) => item.guardian?.id === session?.user.id && item.canView !== false,
    );

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/portfolio`}>
          <ArrowLeft size={18} />
          {PORTFOLIO}
        </Link>
      </Button>

      <DevelopmentHistoryLink childId={childId} />

      <header>
        <h1 className="text-heading font-semibold text-ink">Зургийн цомог</h1>
        <p className="mt-1 text-body text-muted">Насыг сонгож тухайн үеийн дурсамжуудаа үзээрэй.</p>
      </header>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PORTFOLIO_AGES.map((age, index) => {
          const cover = summaries[index]?.data?.coverMediaFileId;
          return (
            <li key={age}>
              <Link
                href={`/children/${childId}/portfolio/gallery/${age}`}
                className="card-interactive group block overflow-hidden rounded-card border border-border bg-surface shadow-sm"
              >
                {cover ? (
                  <MediaThumb mediaId={cover} caption={`${age} насны ковер`} flush />
                ) : (
                  <span className="flex aspect-square items-center justify-center bg-[linear-gradient(145deg,#e9f7ff_0%,#fff2e8_100%)] text-primary">
                    <Images size={36} aria-hidden="true" />
                  </span>
                )}
                <span className="flex items-center justify-between px-4 py-3">
                  <span className="font-semibold text-ink">{age} нас</span>
                  <ChevronRight className="text-primary transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <PortfolioSpecialAlbums
        childId={childId}
        childName={`${data.lastName} ${data.firstName}`}
        canEdit={canEdit}
      />
    </div>
  );
}
