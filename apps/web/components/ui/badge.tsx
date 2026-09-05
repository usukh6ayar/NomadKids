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
/*
 * ★ REDESIGN 2026-09-03 — `font-medium` → `font-semibold`, and a hair more
 * horizontal padding.
 *
 * A badge is set at 12px, which is the smallest type in the product, and at
 * `font-medium` on a pale tint it read as washed out rather than as a label —
 * particularly `sun` and `mint`, whose inks were chosen to clear 4.5:1 at a
 * weight this was not using. Semibold at 12px is the conventional pairing for a
 * chip and it costs no width; the extra 2px of padding stops the pill hugging
 * its own text, which is what made these look cramped beside the new 15px body.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-caption font-semibold whitespace-nowrap",
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
