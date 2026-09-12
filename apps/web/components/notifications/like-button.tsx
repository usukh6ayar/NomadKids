"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { notificationSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { cn } from "@/lib/utils";

/**
 * The like control on an announcement.
 *
 * ★ Reactions only. There is no comment box anywhere in this product and there
 * is not going to be one: a class board families can reply to is a moderation
 * surface, and nobody has been given the job of moderating it. A like says
 * "seen, thank you" without creating anything a teacher has to police. The API
 * has no comment endpoint either — `notifications.test.ts` asserts its absence
 * so the decision cannot be undone by accident.
 *
 * ★★ Optimistic, and it has to be. This sits inside a row that is a link: the
 * tap has to feel instant or the user taps again on the way to the next screen.
 * The previous value is captured and restored on failure, so a rejected like
 * does not leave a heart filled in against a count that never moved.
 *
 * ★★★ The optimistic value goes into the **cache**, not into this component —
 * 2026-09-12, at the client's report: "зүрх дарахад тоо арилдаг."
 *
 * It used to live in `toggle.isPending`, so the moment the request resolved the
 * heart fell back to the props — which are still the pre-press ones until the
 * refetch lands a moment later. A first like therefore went 0 → 1 → *nothing*
 * → 1, and the middle state hides the number entirely, because a count of zero
 * draws no digit. Writing through the cache means the value the list renders is
 * already the new one, and there is no window to fall back into.
 *
 * The count is everyone's; `likedByMe` is only ever the viewer's own. Neither
 * the API nor this component can name who else reacted — a parent must not be
 * able to work out which other families are reading the board.
 */
export function LikeButton({
  notificationId,
  likeCount,
  likedByMe,
  className,
}: {
  notificationId: string;
  likeCount: number;
  likedByMe: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      mutate(`/notifications/${notificationId}/like`, notificationSchema, {
        method: next ? "POST" : "DELETE",
      }),
    onMutate: async (next) => {
      // Stop an in-flight refetch from landing on top of the optimistic value
      // and flickering the heart back.
      await queryClient.cancelQueries({ queryKey: ["notifications"] });

      const snapshot = queryClient.getQueriesData({ queryKey: ["notifications"] });
      queryClient.setQueriesData({ queryKey: ["notifications"] }, (cached: unknown) =>
        patchNotification(cached, notificationId, next),
      );

      return { snapshot };
    },
    /*
      Every cached notifications query is put back exactly as it was. A rejected
      like must not leave a heart filled in against a count that never moved,
      and restoring the snapshot is the only way to be sure of that across the
      three shapes this key holds.
    */
    onError: (_error, _next, context) => {
      for (const [key, value] of context?.snapshot ?? []) queryClient.setQueryData(key, value);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const optimistic = likedByMe;
  const count = likeCount;

  return (
    <button
      type="button"
      aria-pressed={optimistic}
      // The accessible name carries the count, so a screen reader hears
      // "Таалагдсан, 3" rather than an unlabelled heart.
      aria-label={`${optimistic ? "Таалагдсныг болих" : "Таалагдсан"}${count > 0 ? `, ${count}` : ""}`}
      onClick={(event) => {
        // The row around this is a link. Without both, liking navigates.
        event.preventDefault();
        event.stopPropagation();
        toggle.mutate(!optimistic);
      }}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-control px-2.5 text-body font-medium transition-colors",
        optimistic ? "text-danger" : "text-muted hover:bg-canvas hover:text-ink",
        className,
      )}
    >
      <Heart
        size={18}
        aria-hidden="true"
        // Filled when liked — the shape changes, not only the colour, so the
        // state survives a monochrome screen and colour-blindness.
        className={optimistic ? "fill-current" : undefined}
      />
      {count > 0 ? <span className="tabular-nums">{count}</span> : null}
    </button>
  );
}

/**
 * Puts one notification's like state into whatever shape the cache holds it in.
 *
 * ★ Three shapes live under `["notifications"]`: the news page's infinite query
 * (`{ pages: [{ items }] }`), the bell's single page (`{ items }`), and one
 * notification on its own detail route. A patcher that knew only the list would
 * leave the detail screen showing the old count after a like made on it.
 *
 * Anything it does not recognise is returned untouched — an unread count, for
 * instance, which shares the prefix and has no likes in it.
 *
 * ★★ Exported for its own test. The alternative was a full news-page fixture to
 * reach it, which tests the page's stubbing more than it tests this: three
 * shapes in, three shapes out is the whole of what can go wrong here.
 */
export function patchNotification(cached: unknown, id: string, liked: boolean): unknown {
  if (!cached || typeof cached !== "object") return cached;

  const one = (row: unknown): unknown => {
    if (!row || typeof row !== "object") return row;
    const item = row as { id?: string; likeCount?: number; likedByMe?: boolean };
    if (item.id !== id) return row;
    if (item.likedByMe === liked) return row;

    return {
      ...item,
      likedByMe: liked,
      likeCount: Math.max(0, (item.likeCount ?? 0) + (liked ? 1 : -1)),
    };
  };

  const record = cached as Record<string, unknown>;

  if (Array.isArray(record.pages)) {
    return { ...record, pages: record.pages.map((page) => patchNotification(page, id, liked)) };
  }

  if (Array.isArray(record.items)) {
    return { ...record, items: record.items.map(one) };
  }

  return one(cached);
}
