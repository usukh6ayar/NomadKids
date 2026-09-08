"use client";

import { useParams } from "next/navigation";
import { AgePhotoAlbum } from "@/components/child/age-photo-album";
import { ErrorState } from "@/components/ui/states";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";

export default function AgePhotoAlbumPage() {
  const params = useParams<{ childId: string; age: string }>();
  const requestedAge = Number(params.age);
  const age = PORTFOLIO_AGES.find((item) => item === requestedAge);

  if (!age) return <ErrorState title="Олдсонгүй" description="Энэ насны цомог байхгүй байна." />;
  return <AgePhotoAlbum childId={params.childId} age={age} />;
}
