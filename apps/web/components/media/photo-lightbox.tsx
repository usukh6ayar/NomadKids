"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { mediaUrl } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

/** A focused photo view that keeps the page behind it fixed in place. */
export function PhotoLightbox({
  mediaId,
  caption,
  onClose,
}: {
  mediaId: string;
  caption?: string | null;
  onClose: () => void;
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
      aria-label={caption || "Зургийг томоор харах"}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/80 p-3 sm:p-6"
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-full max-w-full flex-col items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          className="self-end"
          onClick={onClose}
          aria-label="Хаах"
        >
          <X aria-hidden="true" />
        </Button>
        <img
          src={mediaUrl(mediaId)}
          alt={caption || "Хүүхдийн зураг"}
          className="max-h-[calc(100vh-7rem)] max-w-[calc(100vw-1.5rem)] rounded-card object-contain shadow-lg sm:max-w-[calc(100vw-3rem)]"
        />
        {caption ? (
          <p className="max-w-2xl rounded-pill bg-surface/95 px-4 py-2 text-center text-body text-ink">
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}
