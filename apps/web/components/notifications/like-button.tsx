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
      return { previous: { likeCount, likedByMe }, next };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // While a request is in flight, show where the user is going, not where they
  // were. `variables` is the value passed to `mutate`.
  const optimistic = toggle.isPending ? toggle.variables : likedByMe;
  const count = toggle.isPending
    ? Math.max(0, likeCount + (toggle.variables ? 1 : -1) * (toggle.variables === likedByMe ? 0 : 1))
    : likeCount;

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
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] px-2.5 text-sm font-medium transition-colors",
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
