import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/app-shell";

/** A shared frame for the operator's five platform screens. */
export function PlatformPageHeading({
  title,
  lede,
  actions,
  backHref,
  mark,
}: {
  title: string;
  lede: string;
  actions?: ReactNode;
  backHref?: string | null;
  mark: ReactNode;
}) {
  return (
    <div className="platform-page-heading relative overflow-hidden rounded-card border border-border bg-[linear-gradient(110deg,#e8f4fd_0%,#ffffff_62%,#edf8f4_100%)] px-4 py-5 shadow-sm sm:px-7 sm:py-6">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-10 grid size-36 place-items-center rounded-pill border border-white/70 bg-white/35 text-primary/10 sm:right-5 sm:size-44 [&_svg]:size-20"
      >
        {mark}
      </span>
      <div className="relative max-w-[900px]">
        <p className="mb-2 text-caption font-bold uppercase tracking-[0.14em] text-primary-strong">
          Платформын удирдлага
        </p>
        <PageHeader title={title} lede={lede} actions={actions} backHref={backHref} />
      </div>
    </div>
  );
}
