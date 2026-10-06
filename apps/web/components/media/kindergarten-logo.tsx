"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/**
 * The kindergarten's logo id, or `null` when it has none.
 *
 * ★ Any member may read `/kindergartens/:id` (`logoMediaFileId` is on the member
 * projection) and the image itself comes through `/media/:id` by membership,
 * so no role is special here. One key for every caller, so a screen that draws
 * it twenty times asks once.
 */
export function useKindergartenLogo(): string | null {
  const { primaryKindergartenId } = useSession();
  const { data } = useQuery({
    queryKey: ["kindergarten", primaryKindergartenId ?? "", "logo"],
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}`,
        z.object({ logoMediaFileId: z.string().nullish() }),
      ),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });
  return data?.logoMediaFileId ?? null;
}

/**
 * The kindergarten's logo in a circle, or `fallback` while it has none.
 *
 * ★ The administration's face — client, 2026-10-06: «удирдлага зураг оруулах
 * хэрэггүй, цэцэрлэгийн лого бүх зүйлд төлөөлнө». An administrator speaks for
 * the kindergarten, so wherever one appears as a person, the logo stands in.
 * `object-contain` on white: a logo is a mark, not a photograph to crop.
 */
export function KindergartenLogoAvatar({
  size,
  fallback,
  className,
}: {
  size: number;
  /** Drawn when there is no logo yet, or it fails to load — initials, usually. */
  fallback: ReactNode;
  className?: string;
}) {
  const logo = useKindergartenLogo();
  const [failed, setFailed] = useState(false);

  if (!logo || failed) return <>{fallback}</>;
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-pill border border-border bg-surface",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={mediaUrl(logo)}
        alt="Цэцэрлэгийн лого"
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
