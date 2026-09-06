"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";

/**
 * Handing an invitation to the person it is for.
 *
 * ★ Shown once, and it says so.
 *
 * The token is one-time and seven days long. If this closes before the QR is
 * scanned the answer is a new invitation, not a way to retrieve the old one — a
 * screen that could re-display a live token would be a screen that leaks it.
 * Nothing here is written to storage.
 *
 * ★★ The QR is drawn on a canvas locally. Fetching one from an image service
 * would mean sending the token to a third party to be rendered, which is the
 * whole credential travelling somewhere it has no reason to go.
 *
 * The link is shown alongside it because a QR is useless over the phone, and
 * "read this out" is a real way a kindergarten hands something over.
 */
export function InvitationHandover({
  token,
  title,
  subtitle,
  onClose,
  path = "/invitation",
  validity = "Урилга 7 хоног хүчинтэй.",
}: {
  token: string;
  title: string;
  subtitle: string;
  onClose: () => void;
  /**
   * Which screen the link lands on.
   *
   * ★ Parameterised 2026-09-06, when an administrator gained a second thing to
   * hand over: a password-reset link for a member of staff who is locked out
   * (`POST /users/:id/password-reset`). That token is the same shape, is
   * one-time in the same way, and must be handed over with the same care — so
   * it is the same screen with a different destination, not a second copy of
   * this one that could drift from it on the parts that matter.
   */
  path?: string;
  /** How long it lasts, in a sentence — a reset link is an hour, not a week. */
  validity?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);

  // `window.location.origin`, so the link works on whichever host this is being
  // used from — localhost in development, the real domain in production.
  const url = typeof window === "undefined" ? "" : `${window.location.origin}${path}/${token}`;

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    void QRCode.toCanvas(canvasRef.current, url, { width: 220, margin: 1 });
  }, [url]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-title font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-body text-muted">{subtitle}</p>
      </div>

      <div className="grid place-items-center rounded-row border border-border bg-canvas p-4">
        <canvas ref={canvasRef} aria-label="Холбоосын QR код" role="img" />
        <p className="mt-2 text-center text-caption text-muted">Утсаараа уншуулна уу. {validity}</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-caption font-medium text-muted">Эсвэл холбоосыг дамжуулна уу:</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-control bg-canvas px-3 py-2 text-caption text-ink">
            {url}
          </code>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Хуулагдлаа" : "Хуулах"}
          </Button>
        </div>
      </div>

      <p className="rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
        Энэ QR-ыг дахин харуулах боломжгүй. Хаасны дараа шаардлагатай бол шинийг үүсгэнэ үү.
      </p>

      <div className="border-t border-border pt-4">
        <Button type="button" onClick={onClose}>
          Хаах
        </Button>
      </div>
    </div>
  );
}
