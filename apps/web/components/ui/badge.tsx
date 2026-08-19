import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * A status chip.
 *
 * ★ The label is required and always rendered. Colour is a reinforcement, never
 * the signal — "no critical meaning through colour alone". A colour-blind
 * teacher reading a review queue must be able to tell "Хүлээгдэж буй" from
 * "Зөвшөөрсөн" without seeing the difference between yellow and green.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[999px] px-2.5 py-1 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-canvas text-muted border border-border",
        // done / approved
        mint: "bg-mint text-mint-ink",
        // informational
        sky: "bg-sky text-sky-ink",
        // waiting on someone
        sun: "bg-sun text-sun-ink",
        // needs attention
        peach: "bg-peach text-peach-ink",
        primary: "bg-primary-soft text-primary",
        danger: "bg-danger-soft text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
