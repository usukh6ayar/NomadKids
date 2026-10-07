"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { mediaUrl } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

/**
 * A focused photo view that keeps the page behind it fixed in place.
 *
 * ★ `onPrev`/`onNext` step through a set — 2026-10-07, the client: a post's
 * photographs open large and page "like Facebook". Arrow keys and a sideways
 * swipe do the same; a lone photo passes neither and draws no arrows.
 */
export function PhotoLightbox({
  mediaId,
  caption,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  mediaId: string;
  caption?: string | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** "2 / 5" — where this photo sits in the set. */
  position?: string;
}) {
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onPrev?.();
      if (event.key === "ArrowRight") onNext?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, onPrev, onNext]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption || "Зургийг томоор харах"}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/80 p-3 sm:p-6"
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartX.current = null;
        if (start === null || end === undefined || Math.abs(end - start) < 50) return;
        if (end < start) onNext?.();
        else onPrev?.();
      }}
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-full max-w-full flex-col items-center gap-3">
        <div className="flex items-center gap-3 self-stretch">
          {position ? (
            <span className="rounded-pill bg-surface/95 px-3 py-1 text-caption font-semibold tabular-nums text-ink">
              {position}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="icon"
            className="ml-auto"
            onClick={onClose}
            aria-label="Хаах"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <img
          src={mediaUrl(mediaId)}
          alt={caption || "Хүүхдийн зураг"}
          className="max-h-[calc(100vh-7rem)] max-w-[calc(100vw-1.5rem)] rounded-card object-contain shadow-lg sm:max-w-[calc(100vw-3rem)]"
        />
        {onPrev ? (
          <Button
            variant="secondary"
            size="icon"
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-pill sm:left-2"
            onClick={onPrev}
            aria-label="Өмнөх зураг"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
        ) : null}
        {onNext ? (
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-pill sm:right-2"
            onClick={onNext}
            aria-label="Дараах зураг"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        ) : null}
        {caption ? (
          <p className="max-w-2xl rounded-pill bg-surface/95 px-4 py-2 text-center text-body text-ink">
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}
