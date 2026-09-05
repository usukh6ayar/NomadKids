import type { ChildDetail } from "@kinder/contracts";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The soft-gradient hero card shared by every new parent-facing portfolio
 * screen — `ParentGrowthLauncher`, the per-age page, and the comparison page
 * all opened with their own copy of this same markup as each screenshot
 * arrived; extracted once the third one was about to repeat it a third time.
 *
 * ★ The chip is the child's own initial by default (plain
 * `border border-border bg-surface`, not the gradient-filled one
 * `AboutMeSummaryCard`'s header chip uses) — `ParentGrowthLauncher` and the
 * per-age page both draw it this way. The comparison page is the one
 * exception its own screenshot draws deliberately: a filled `IconChip`
 * instead, since that screen is about a chart, not this specific child.
 * `icon` swaps it in without a second component.
 */
export function PortfolioHero({
  child,
  icon,
  overline,
  title,
  subtitle,
}: {
  child: ChildDetail;
  /** Replaces the initials chip with a filled icon chip — the comparison page's own case. */
  icon?: ReactNode;
  overline: string;
  title: string;
  /** Optional as of 2026-09-04 — `ParentGrowthLauncher` dropped its own on the client's instruction. */
  subtitle?: string;
}) {
  return (
    <Card
      pad="roomy"
      className="relative flex items-center gap-4 overflow-hidden bg-[linear-gradient(160deg,#ffffff_0%,#f4faf7_55%,#fdf6ef_100%)]"
    >
      {/* Purely decorative — the reference build's own soft corner blob. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-10 size-36 rounded-pill bg-mint/40"
      />

      {icon ? (
        <IconChip
          icon={icon}
          tone="sky"
          className="relative z-10 size-16 shrink-0 rounded-pill [&>svg]:size-7"
        />
      ) : (
        <span
          aria-hidden="true"
          className="relative z-10 flex size-16 shrink-0 items-center justify-center rounded-card border border-border bg-surface text-title font-bold text-ink"
        >
          {initials(child)}
        </span>
      )}

      <div className="relative z-10 min-w-0">
        <p className="text-caption font-bold tracking-wide text-primary-strong">{overline}</p>
        <h1 className="mt-0.5 truncate text-heading font-semibold text-ink">{title}</h1>
        <GradientUnderline className="mt-1.5" />
        {subtitle ? <p className="mt-2 text-body text-muted">{subtitle}</p> : null}
      </div>
    </Card>
  );
}

/** A short gradient bar under a heading — the mockups' own underline flourish, one place. */
export function GradientUnderline({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-1 w-14 rounded-pill bg-[linear-gradient(90deg,#60a5fa_0%,#8b5cf6_100%)]",
        className,
      )}
    />
  );
}
