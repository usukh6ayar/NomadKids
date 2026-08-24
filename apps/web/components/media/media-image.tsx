"use client";

import { useState } from "react";
import { mediaUrl } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

/**
 * Renders a stored image.
 *
 * ★ Never a bucket URL, and never a storage key. The `src` is the API's own
 * `GET /v1/media/:id`, which runs the authorization check — including the rule
 * that an observation photo inherits its observation's visibility — and only
 * then 302s to a presigned URL that expires in minutes.
 *
 * A plain `<img>` rather than a fetched URL: the endpoint answers with a
 * redirect to an image, so `fetch` would follow it and fail parsing a JPEG. The
 * auth cookie is `SameSite=Lax` and the app and API share a registrable domain,
 * so the browser attaches it to the image request itself. No token is touched
 * by this component.
 *
 * These images deliberately bypass `next/image`: the optimiser would fetch and
 * cache the object behind a public `/_next/image` path, which is exactly the
 * "files are never directly reachable" rule the media design exists to enforce.
 */

/**
 * A child's photo, or their initial.
 *
 * The fallback is an initial rather than a silhouette: most children have no
 * photo for their first weeks, and a column of identical grey figures makes a
 * class list unreadable.
 */
/**
 * The tints a photoless avatar cycles through.
 *
 * ★ The reference gives each child a different colour so a teacher finds a row
 * by shape rather than by reading every name — the same argument its `app.css`
 * makes for tinting the dashboard statistics. These are v2's own accent tokens,
 * not new colours: mint, sky, sun, peach, and the brand.
 *
 * Chosen from the name, not from the list position, so a child keeps the same
 * colour between the list, the dashboard and their own page. An index would
 * repaint everyone the moment the sort order changed.
 */
const AVATAR_TINTS = [
  "bg-primary-soft text-primary",
  "bg-mint text-mint-ink",
  "bg-sky text-sky-ink",
  "bg-sun text-sun-ink",
  "bg-peach text-peach-ink",
] as const;

function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]!;
}

export function ChildAvatar({
  child,
  size = 44,
  className,
}: {
  child: {
    lastName?: string | null;
    firstName?: string | null;
    photoMediaFileId?: string | null;
  };
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const name = [child.lastName, child.firstName].filter(Boolean).join(" ");
  const showPhoto = Boolean(child.photoMediaFileId) && !failed;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill font-semibold",
        showPhoto ? "bg-primary-soft text-primary" : tintFor(name),
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.36)) }}
    >
      {showPhoto ? (
        <img
          src={mediaUrl(child.photoMediaFileId!)}
          alt={name ? `${name}-ийн зураг` : "Хүүхдийн зураг"}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        // The initial repeats information already in the adjacent name, so it
        // is decorative to a screen reader.
        <span aria-hidden="true">{initials(child)}</span>
      )}
    </span>
  );
}

/** An observation photo. */
export function MediaThumb({
  mediaId,
  caption,
  className,
}: {
  mediaId: string;
  caption?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={cn(
          "flex aspect-square items-center justify-center rounded-control border border-border bg-canvas p-2 text-center text-caption text-muted",
          className,
        )}
      >
        Зураг ачаалагдсангүй
      </div>
    );
  }

  return (
    <img
      src={mediaUrl(mediaId)}
      alt={caption || "Ажиглалтын зураг"}
      loading="lazy"
      className={cn("aspect-square w-full rounded-control object-cover", className)}
      onError={() => setFailed(true)}
    />
  );
}
