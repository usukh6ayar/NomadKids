import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A surface.
 *
 * One border, no shadow. The brief rules out excessive cards and shadows, so
 * separation comes from the canvas showing through between surfaces rather than
 * from elevation — which also keeps a long list from looking like a stack of
 * floating tiles.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-[16px] border border-border bg-surface", className)} {...props} />
  );
}

/**
 * A section heading with optional action.
 *
 * `as` defaults to `h2`: the heading level is a document-structure decision the
 * calling screen makes, and getting it wrong makes a screen reader's outline
 * nonsense. It is a prop rather than a fixed tag for exactly that reason.
 */
export function SectionHeader({
  title,
  action,
  as: Tag = "h2",
  className,
}: {
  title: string;
  action?: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <Tag className="text-base font-semibold text-ink">{title}</Tag>
      {action}
    </div>
  );
}
