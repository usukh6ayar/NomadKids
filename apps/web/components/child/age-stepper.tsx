import Image from "next/image";
import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";

const AGE_NUMBER_ART: Record<(typeof PORTFOLIO_AGES)[number], string> = {
  2: "/icons/icon-age-2-3d.png",
  3: "/icons/icon-age-3-3d.png",
  4: "/icons/icon-age-4-3d.png",
  5: "/icons/icon-age-5-3d.png",
};

/** Comparison shortcut plus the four white, illustrated age-folder cards. */
export function AgeStepper({ childId }: { childId: string }) {
  return (
    <nav aria-label="Насны хуудсууд" className="flex flex-col gap-2">
      <Link
        href={`/children/${childId}/portfolio/growth/compare`}
        className="inline-flex min-h-8 self-start items-center gap-1.5 rounded-pill border border-border bg-surface px-3 text-caption font-semibold text-primary shadow-sm transition-colors hover:bg-primary-soft"
      >
        <BarChart3 size={14} aria-hidden="true" />
        2-5 насны мэдээлэл
      </Link>

      <ul className="grid grid-cols-2 gap-4">
        {PORTFOLIO_AGES.map((age) => {
          return (
            <li key={age}>
              <Link
                href={`/children/${childId}/portfolio/growth/age/${age}`}
                aria-label={`${age} нас`}
                className="group flex aspect-[3/2] min-h-44 flex-col items-center justify-center rounded-card border border-[#eadfd8] bg-white px-4 py-5 text-ink shadow-sm transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-md"
              >
                <Image
                  src={AGE_NUMBER_ART[age]}
                  alt=""
                  width={96}
                  height={96}
                  className="size-20 object-contain transition-transform group-hover:scale-105 sm:size-24"
                />
                <span className="mt-1 text-title font-medium text-ink">Нас</span>
                <ChevronRight className="mt-2 size-5 text-[#9fb1c9]" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
