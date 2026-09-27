import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/vocabulary";

/**
 * The public 404.
 *
 * ★ Next's built-in page was what anybody mistyping a URL saw: black
 * Helvetica on white, in English, with no way back. On a product whose every
 * other word is Mongolian that reads as a different site entirely — and the
 * people most likely to reach it are guardians following a mistyped or expired
 * link from a chat app.
 *
 * ★★ It offers **two** destinations and not one. "Нүүр хуудас" is the honest
 * answer for somebody who is signed in and simply went astray; an invitation
 * that has expired is the other common way to land here, and that reader needs
 * the sign-in page and a sentence telling them to ask for a new link. Guessing
 * which of the two they are would be worse than offering both.
 *
 * ★★★ It does **not** use `AuthShell` or `PublicInfoShell`. Both draw a
 * header with navigation into the product, and a 404 rendered inside furniture
 * that implies a working page is the shape that makes people think the site is
 * broken rather than the address.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10">
      <div className="w-full max-w-[520px] text-center">
        <span
          aria-hidden="true"
          className="mx-auto grid size-16 place-items-center rounded-pill bg-primary-soft text-primary"
        >
          <Compass size={30} />
        </span>

        <p className="mt-5 text-caption font-semibold uppercase tracking-[0.18em] text-muted">
          404
        </p>
        <h1 className="mt-1 text-display font-bold leading-heading tracking-[-0.02em] text-ink">
          Хуудас олдсонгүй
        </h1>
        <p className="mx-auto mt-3 max-w-[42ch] text-body leading-relaxed text-muted">
          Хаяг буруу байна, эсвэл энэ хуудас шилжсэн байж болно. Хэрэв та урилгын холбоосоор орж
          байгаа бол хугацаа нь дууссан байж магадгүй — цэцэрлэгээсээ шинээр авна уу.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/">Нүүр хуудас</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/login">Нэвтрэх</Link>
          </Button>
        </div>

        <p className="mt-8 text-caption text-muted">{BRAND}</p>
      </div>
    </main>
  );
}
