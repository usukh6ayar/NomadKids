"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { z } from "zod";
import { notificationSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LikeButton } from "@/components/notifications/like-button";
import { MediaThumb } from "@/components/media/media-image";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { formatLongDate, fullName } from "@/lib/format";

/**
 * One announcement.
 *
 * Marked read on open. The list also marks on click, and both are needed: this
 * page is reachable directly from a link, and an announcement someone has
 * plainly read should not keep counting against the badge.
 */
export default function NotificationDetailPage() {
  const params = useParams<{ notificationId: string }>();
  const id = params.notificationId;
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.notification(id),
    queryFn: () => get(`/notifications/${id}`, notificationSchema),
  });

  const markRead = useMutation({
    mutationFn: () => mutate(`/notifications/${id}/read`, z.unknown(), { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const isUnread = data?.reads.length === 0;

  useEffect(() => {
    // `isIdle` guards against re-firing when the list invalidation refetches
    // this query and briefly re-renders with the old `reads`.
    if (isUnread && markRead.isIdle) markRead.mutate();
  }, [isUnread, markRead]);

  if (isLoading) return <LoadingState rows={3} />;

  if (isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={isNotFound(error) ? "Энэ мэдэгдэл олдсонгүй." : errorMessage(error)}
          action={
            <Button asChild variant="secondary">
              <Link href="/notifications">Буцах</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const notification = data!;

  return (
    <div className="flex flex-col gap-4 py-2">
      <Link
        href="/notifications"
        className="inline-flex min-h-[44px] items-center text-sm text-primary underline underline-offset-4"
      >
        ← Мэдэгдэл
      </Link>

      <Card className="px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-lg font-semibold text-ink">{notification.title}</h1>
          {notification.isImportant ? <Badge tone="peach">Чухал</Badge> : null}
        </div>

        <p className="mt-1 text-sm text-muted">
          {[
            fullName(notification.author),
            formatLongDate(notification.publishedAt ?? notification.createdAt),
          ]
            .filter((v) => v !== "—")
            .join(" · ")}
        </p>

        {notification.targets.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {notification.targets.map((target, index) => (
              <Badge key={index} tone="sky">
                {target.group?.name ?? fullName(target.child)}
              </Badge>
            ))}
          </div>
        ) : null}

        {/*
          `whitespace-pre-wrap` preserves the line breaks whoever wrote this
          typed. An announcement about a school trip is a list of times, and
          collapsing it into a paragraph makes it unreadable.
        */}
        <div className="mt-5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
          {notification.body}
        </div>

        {notification.media.length > 0 ? (
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {notification.media.map((photo) => (
              <li key={photo.id} className={notification.media.length === 1 ? "sm:col-span-2" : ""}>
                <MediaThumb
                  mediaId={photo.id}
                  caption={photo.caption}
                  // Full size here, unlike the feed: this is the screen someone
                  // opened to look at the picture.
                  className="aspect-auto max-h-[70vh] w-full object-contain"
                />
                {photo.caption ? <p className="mt-1 text-xs text-muted">{photo.caption}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/*
          Below the notice, above nothing else. There is no comment box here by
          design — see `LikeButton`.
        */}
        <div className="mt-5 flex items-center gap-2 border-t border-border pt-3">
          <LikeButton
            notificationId={notification.id}
            likeCount={notification.likeCount}
            likedByMe={notification.likedByMe}
          />
          {notification.likeCount > 0 ? (
            <span className="text-sm text-muted">{notification.likeCount} хүн таалав</span>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
