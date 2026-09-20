"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The last thing standing between a thrown render and a blank white page.
 *
 * ★ There was no `error.tsx` anywhere in this app, so an exception in any
 * client component unmounted the tree and left nothing — no message, no way
 * back, and in production not even a console trace a teacher could read out.
 * "Хоосон байгаа зүйлсийн page" covers this case as much as it covers a 404.
 *
 * ★★ `reset()` before "нүүр хуудас", because most of what reaches here is
 * transient — a query that threw on a malformed payload, a render that raced a
 * navigation. Re-rendering the segment fixes those without losing where the
 * reader was, and it is the cheaper thing to try first.
 *
 * ★★★ **The message is not shown.** `error.message` in a production build is
 * a minified string at best and can carry an identifier at worst; neither
 * helps a teacher, and the second is a small leak on a screen anybody can
 * reach. The digest is printed instead — that is the handle support can use to
 * find the real trace in the server log.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The browser console is where a developer looks; production users never
    // see this, and it is the only trace the client keeps.
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10">
      <div className="w-full max-w-[460px] text-center">
        <span
          aria-hidden="true"
          className="mx-auto grid size-14 place-items-center rounded-pill bg-danger-soft text-danger"
        >
          <TriangleAlert size={26} />
        </span>

        <h1 className="mt-4 text-heading font-semibold text-ink">Алдаа гарлаа</h1>
        <p className="mt-2 text-body leading-relaxed text-muted">
          Энэ хэсгийг харуулах үед алдаа гарлаа. Дахин оролдоод үзнэ үү — давтагдвал цэцэрлэгийн
          удирдлагадаа мэдэгдээрэй.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={() => reset()}>Дахин оролдох</Button>
          <Button asChild variant="secondary">
            <a href="/">Нүүр хуудас</a>
          </Button>
        </div>

        {error.digest ? (
          <p className="mt-6 font-mono text-caption text-faint">Алдааны дугаар: {error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
