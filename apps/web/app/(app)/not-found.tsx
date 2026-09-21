import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A 404 **inside the shell** — the menu stays, only the content is missing.
 *
 * ★ Why a second one. `app/not-found.tsx` replaces the whole screen, which is
 * right for a stranger who mistyped a URL and wrong for a signed-in teacher
 * who followed a stale link from a dashboard: taking their navigation away
 * turns "that page is gone" into "you have been signed out", which is the more
 * alarming of the two and not true. Next resolves the nearest `not-found`, so
 * placing one in this segment keeps the rail and the bottom bar in place.
 *
 * ★★ Deliberately without a "go back" of its own. `PageHeader` draws Буцах on
 * every inner screen now, and a second control doing the same thing three
 * centimetres away is the kind of duplicate that makes a reader wonder whether
 * they differ.
 */
export default function AppNotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-10">
      <div className="w-full max-w-[420px] text-center">
        <span
          aria-hidden="true"
          className="mx-auto grid size-14 place-items-center rounded-pill bg-primary-soft text-primary"
        >
          <Compass size={26} />
        </span>

        <h1 className="mt-4 text-heading font-semibold text-ink">Энэ хуудас олдсонгүй</h1>
        <p className="mt-2 text-body leading-relaxed text-muted">
          Хаяг буруу, эсвэл энэ бичлэг устсан байж магадгүй. Зүүн талын цэснээс үргэлжлүүлнэ үү.
        </p>

        <div className="mt-5">
          <Button asChild variant="secondary">
            <Link href="/">Нүүр хуудас</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
