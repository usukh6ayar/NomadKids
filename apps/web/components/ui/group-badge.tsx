import { cn } from "@/lib/utils";
import { TONE_SURFACE, type Tone } from "@/components/ui/tone";

/**
 * A group's coloured letter — «А» for Ахлах, «Б» for Бага — 2026-09-26.
 *
 * ★ After the ministry's SIS register, which leads every group row with a
 * tinted letter so a class is found by colour before its name is read. The
 * client asked for the product to be «гоё өнгөлөг».
 *
 * ★★ The colour follows the **age band**, not the group. A tone here means
 * "this age": every Ахлах class on every screen is the same colour, and a
 * director scanning a register reads the age mix of the kindergarten at a
 * glance. A per-group hash would give each class a colour that means nothing
 * and changes when a group is renamed.
 *
 * The letter is the name's own first letter, upper-cased — the name carries
 * the age word first in how ESIS and directors both write them.
 */
export const AGE_BAND_TONE: Record<string, Tone> = {
  NURSERY: "pink",
  JUNIOR: "mint",
  MIDDLE: "sky",
  SENIOR: "cornflower",
};

/** The tone a group is drawn in, everywhere — see the note above. */
export function groupTone(ageBand?: string | null): Tone {
  return (ageBand && AGE_BAND_TONE[ageBand]) || "teal";
}

/** A 4px top edge in the group's tone — for a card that *is* a group. */
export const GROUP_STRIPE: Record<Tone, string> = {
  sky: "border-t-4 border-t-sky-chart",
  mint: "border-t-4 border-t-mint-chart",
  sun: "border-t-4 border-t-sun-chart",
  peach: "border-t-4 border-t-peach-chart",
  cornflower: "border-t-4 border-t-cornflower-chart",
  teal: "border-t-4 border-t-teal-chart",
  pink: "border-t-4 border-t-pink-chart",
};

export function GroupBadge({
  name,
  ageBand,
  size = "md",
  className,
}: {
  name: string;
  ageBand?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const tone = groupTone(ageBand);
  const letter = name.trim().charAt(0).toLocaleUpperCase("mn-MN") || "?";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-control font-semibold",
        size === "sm" ? "size-6 text-caption" : "size-8 text-body",
        TONE_SURFACE[tone],
        className,
      )}
    >
      {letter}
    </span>
  );
}
