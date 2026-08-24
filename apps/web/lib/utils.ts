import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * ★ tailwind-merge has to be told what the product's own `text-*` steps are.
 *
 * The type scale in `globals.css` generates `text-caption` … `text-display`.
 * tailwind-merge does not read the Tailwind config, so those names are unknown
 * to it — and its rule for an unrecognised `text-<something>` is to treat it as
 * a **colour**. So it saw `text-primary-ink` and `text-lead` as two values of
 * one property, kept the later one, and dropped the colour.
 *
 * The failure is silent and total: `<Button>` renders
 * `bg-primary … text-primary-ink … text-lead`, and the white label simply
 * stopped being emitted. Every filled button in the product would have shipped
 * with default ink on blue-700. `responsive.test.tsx` caught it because it
 * asserts on the merged class string rather than on the variant definition.
 *
 * Registering the steps as `font-size` restores both: a size and a colour are
 * different groups again, so neither evicts the other.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["caption", "compact", "body", "lead", "title", "heading", "display"] },
      ],
    },
  },
});

/** Class-name helper used by every shadcn/ui component. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
