"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { notificationSchema, paginated } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { LikeButton } from "@/components/notifications/like-button";
import { MediaThumb } from "@/components/media/media-image";
import { useSession } from "@/lib/auth/session";
import { Plus } from "lucide-react";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowList } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { excerpt, fullName, groupByDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const listSchema = paginated(notificationSchema);

/**
 * Announcements.
 *
 * Read state comes from `reads` — the API returns only *this* user's receipt,
 * so "have I read it" is answerable without exposing who else has, which for a
 * kindergarten announcement would be a small but real disclosure about other
 * families.
 *
 * There is no realtime channel in the MVP. The unread badge and this list
 * refresh on window focus, which for announcements that arrive a few times a
 * week is indistinguishable from a push (docs/ARCHITECTURE.md §7).
 */
export default function NotificationsPage() {
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const filters = { unread: showUnreadOnly };

  /**
   * ★ An endless feed, not pages.
   *
   * A class board is read the way a phone is read — thumb down until something
   * looks familiar. "Өмнөх / Дараах" makes the reader hold a page number in
   * their head to answer "have I seen this one", which is the wrong question to
   * make a parent answer on a bus.
   *
   * The API is still paginated; this stitches the pages together. `totalPages`
   * is what says whether another exists, so the last page ends rather than
   * fetching for ever.
   */
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: qk.notifications(filters),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam), pageSize: "15" });
      if (showUnreadOnly) params.set("unread", "true");
      return get(`/notifications?${params}`, listSchema);
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  /**
   * The sentinel below the list. Loading on intersection rather than on a
   * button: the button is the thing the feed exists to remove.
   *
   * `rootMargin` starts the fetch before the reader reaches the end, so the
   * next batch is usually there by the time they get to it.
   */
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Мэдэгдэл"
        lede="Цэцэрлэгээс ирсэн зар, мэдээлэл."
        /*
          A two-state toggle rendered as buttons with `aria-pressed`, so the
          current filter is announced rather than being visible only as a
          background colour.
        */
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isStaff ? (
              <Button asChild size="sm">
                <Link href="/notifications/new">
                  <Plus size={18} />
                  Шинэ мэдэгдэл
                </Link>
              </Button>
            ) : null}

            <div className="flex gap-1 rounded-control border border-border bg-surface p-1">
              <FilterButton active={!showUnreadOnly} onClick={() => setShowUnreadOnly(false)}>
                Бүгд
              </FilterButton>
              <FilterButton active={showUnreadOnly} onClick={() => setShowUnreadOnly(true)}>
                Уншаагүй
              </FilterButton>
            </div>
          </div>
        }
      />

      {isLoading ? <LoadingState rows={4} /> : null}

      {isError ? (
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {data && items.length === 0 ? (
        <EmptyState
          icon={<Image src="/background/mascot-teacher.webp" alt="" width={96} height={96} />}
          title={showUnreadOnly ? "Уншаагүй мэдэгдэл алга" : "Мэдэгдэл алга"}
          description={
            showUnreadOnly
              ? "Бүх мэдэгдлийг уншсан байна."
              : "Цэцэрлэгээс мэдэгдэл ирэхэд энд харагдана."
          }
        />
      ) : null}

      {items.length > 0 ? (
        /*
         * ★ Day-grouped, matching the home feed's own rail.
         *
         * A class board is exactly the same shape of content as "Сүүлийн
         * мөчүүд" — a chronological record — so it reads with the same
         * device rather than inventing a second one. Each row used to carry
         * its own relative timestamp; grouped by day, that fact belongs to
         * the day once, so `NotificationRow` drops it in favour of the
         * group's own label.
         */
        <div className="flex flex-col">
          {groupByDay(items, (n) => n.publishedAt ?? n.createdAt).map((group, index, all) => (
            <div key={group.key} className="flex gap-3">
              <div className="flex w-5 shrink-0 flex-col items-center" aria-hidden="true">
                <span className="mt-2 size-2.5 shrink-0 rounded-pill bg-primary ring-4 ring-primary-soft" />
                {index < all.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
              </div>
              <div className={cn("min-w-0 flex-1", index < all.length - 1 && "pb-5")}>
                <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">
                  {group.label}
                </h3>
                <RowList>
                  {group.items.map((notification) => (
                    <NotificationRow key={notification.id} notification={notification} />
                  ))}
                </RowList>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Height, so it can intersect at all — a zero-height div never does. */}
      <div ref={sentinel} aria-hidden="true" className="h-px" />

      {isFetchingNextPage ? (
        <p role="status" className="py-2 text-center text-body text-muted">
          Ачаалж байна…
        </p>
      ) : null}

      {!hasNextPage && items.length > 0 ? (
        <p className="py-2 text-center text-body text-muted">Бүх мэдэгдлийг үзлээ.</p>
      ) : null}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // 44px, not 40: this is the tap floor the rest of the product holds to.
        "min-h-[44px] rounded-control px-3 text-body font-medium",
        active ? "bg-primary-soft text-primary" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function NotificationRow({ notification }: { notification: z.infer<typeof notificationSchema> }) {
  const queryClient = useQueryClient();
  const isUnread = notification.reads.length === 0;

  const markRead = useMutation({
    mutationFn: () =>
      mutate(`/notifications/${notification.id}/read`, z.unknown(), { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  return (
    <Link
      href={`/notifications/${notification.id}`}
      // Marking read on open is the behaviour every user expects; doing it only
      // via an explicit button leaves the badge stuck at a number they have
      // already dealt with.
      onClick={() => {
        if (isUnread) markRead.mutate();
      }}
      // Its own card, per `.kidrow`. The border moving to the brand colour is
      // the reference's hover affordance for a row that is a link.
      className="flex min-h-[72px] items-start gap-3 rounded-row border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
    >
      {/*
        Unread is signalled three ways — a dot, a bolder title, and an sr-only
        word — because a dot alone is invisible to a screen reader and weight
        alone is easy to miss.
      */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-2 size-2 shrink-0 rounded-pill",
          isUnread ? "bg-primary" : "bg-transparent",
        )}
      />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("text-ink", isUnread ? "font-semibold" : "font-medium")}>
            {notification.title}
          </span>
          {isUnread ? <span className="sr-only">Уншаагүй</span> : null}
          {notification.isImportant ? <Badge tone="peach">Чухал</Badge> : null}
        </span>

        <span className="mt-0.5 block text-body text-muted">{excerpt(notification.body, 110)}</span>

        {/*
          Photos, as a feed shows them: one fills the width, several become a
          grid. `max-h` keeps a tall portrait photo from pushing the next post
          off the screen — the row is a summary, and the detail page is where a
          picture gets to be its own size.
        */}
        {notification.media.length > 0 ? (
          <span
            className={cn(
              "mt-2 grid gap-1.5 overflow-hidden rounded-control",
              notification.media.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3",
            )}
          >
            {notification.media.slice(0, 6).map((photo) => (
              <MediaThumb
                key={photo.id}
                mediaId={photo.id}
                caption={photo.caption}
                className={notification.media.length === 1 ? "aspect-[16/9] max-h-[320px]" : ""}
              />
            ))}
          </span>
        ) : null}

        <span className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-muted">{fullName(notification.author)}</span>

          {/* Inside the row, which is a link — the button stops the click. */}
          <LikeButton
            notificationId={notification.id}
            likeCount={notification.likeCount}
            likedByMe={notification.likedByMe}
            className="-my-2"
          />
        </span>
      </span>
    </Link>
  );
}
