import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/app-shell";

/**
 * A shared frame for the operator's platform screens.
 *
 * ★ Plain since 2026-10-13 (the user: "минимал, орчин үеийн, зай бага
 * эзэлдэг, албан"): a small eyebrow, the page's own header and a hairline —
 * no gradient banner, no watermark. `mark` is still accepted from the
 * screens that pass one and no longer drawn.
 */
export function PlatformPageHeading({
  title,
  lede,
  actions,
  backHref,
}: {
  title: string;
  lede: string;
  actions?: ReactNode;
  backHref?: string | null;
  mark?: ReactNode;
}) {
  return (
    <header className="platform-page-heading border-b border-border-soft pb-4">
      <p className="mb-1 text-caption font-semibold uppercase tracking-[0.14em] text-muted">
        Платформын удирдлага
      </p>
      <PageHeader title={title} lede={lede} actions={actions} backHref={backHref} />
    </header>
  );
}
