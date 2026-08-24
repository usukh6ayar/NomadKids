import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * ★ Every size here is at or above 44px.
 *
 * That is the floor for a thumb, and it is not a per-button judgement call —
 * `responsive.test.ts` asserts these class strings, so a 32px "compact" variant
 * cannot be added without the test failing and someone having to justify it.
 *
 * `sm` is 44px, not 36px. It is "less wide", not "less tappable".
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-control font-medium " +
    "transition-colors disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // ★ blue-700 under a white label — 6.70:1, and it hovers *darker* to
        // blue-800 (8.72:1). The sky palette could do neither: it needed a dark
        // label and a lightening hover to stay legible. See globals.css.
        //
        // `font-medium` is on the shared base above, so the label weight is the
        // same on every variant.
        primary: "bg-primary text-primary-ink hover:bg-primary-hover",
        secondary: "bg-surface text-ink border border-border hover:bg-canvas",
        ghost: "text-ink hover:bg-canvas",
        danger: "bg-danger text-white hover:opacity-90",
        link: "text-primary underline underline-offset-4 hover:opacity-80",
      },
      size: {
        // 48px — the height of a primary action, matching text inputs so a
        // form's controls line up.
        md: "h-[48px] px-5 text-lead",
        sm: "h-[44px] px-4 text-body",
        lg: "h-[52px] px-6 text-lead",
        // Square icon button. Still 44px.
        icon: "h-[44px] w-[44px] p-0",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      // Defaulting to "button" rather than the HTML default of "submit": a
      // secondary button inside a form otherwise submits it, which is how a
      // "Цуцлах" ends up saving.
      {...(asChild ? {} : { type: type ?? "button" })}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
