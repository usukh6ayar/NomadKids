import { Skeleton } from "@/components/ui/states";

/**
 * The ghost a screen shows while it is being fetched.
 *
 * ★ Asked for on 2026-09-20 ("ghost loading ntr bas hii"). Without a
 * `loading.tsx` a route transition inside this segment renders **nothing**
 * until the page's own code arrives — on a phone over a Mongolian mobile
 * connection that is a white rectangle for long enough to look like a failure,
 * and the reader presses the link again.
 *
 * ★★ It is the shape of a page, not a spinner. A header block, a row of
 * tiles and a list: the layout almost every screen in this product opens with,
 * so the real content lands roughly where the ghost stood instead of shoving
 * it aside. A centred spinner tells the reader to wait; a skeleton tells them
 * what they are waiting for.
 *
 * ★★★ It lives in `(app)` rather than per route. One file covers every
 * authenticated screen, and the alternative — thirty near-identical
 * `loading.tsx` files — is thirty places for the shape to drift. A screen
 * whose skeleton genuinely differs can still add its own; Next resolves the
 * nearest.
 *
 * `Skeleton` is `aria-hidden`, so a screen reader hears the page arrive rather
 * than a description of grey boxes.
 */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-[220px]" />
        <Skeleton className="h-4 w-[320px] max-w-full" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[92px] rounded-card" />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[64px] rounded-row" />
        ))}
      </div>
    </div>
  );
}
