import { BRAND_LATIN } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";

/**
 * `NomadKids`, in the gradient the client chose — 2026-09-16: "Бяцхан
 * нүүдэлчид гэдэг нэрийг NomadKids гэж цэнхэрээс яган руу ууссан өнгөтэй ийм
 * загвартай болго, бүх хэсгийг ийм болго."
 *
 * ★ One component, because the gradient is a brand asset rather than a
 * decoration. It was drawn once, by hand, in the landing page's hero
 * (`landing.tsx`), and the moment a second screen wanted the same name the
 * choice was to lift it or to copy three colour stops into every shell. A copy
 * is where one of them stops matching when the brand is next adjusted.
 *
 * ★★ The login screen is deliberately **not** a caller — the client, same
 * note: "нэвтрэх хэсгийг оролдож болохгүй". `auth-shell.tsx` shows the drawn
 * logo with "БЯЦХАН НҮҮДЭЛЧИД" lettered into the artwork, and setting this
 * beside it would put two names for one product on the first screen anybody
 * sees, which is the argument that file already carries.
 *
 * ★★★ `bg-clip-text` needs a box to paint, so the span is `inline-block`: as a
 * plain inline it takes the line box's height and the stops land in different
 * places on a wrapped second line. The name is one word and never wraps, which
 * is what makes that safe here.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block bg-gradient-to-r from-[#0758c8] via-[#596fe5] to-[#ba55df] bg-clip-text",
        "font-black leading-[1.15] tracking-[-0.035em] text-transparent",
        className,
      )}
    >
      {BRAND_LATIN}
    </span>
  );
}
