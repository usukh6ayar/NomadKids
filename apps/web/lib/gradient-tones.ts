/**
 * Five saturated gradients, lifted verbatim from a parent-supplied reference
 * build's own CSS (a separate Flask/Jinja prototype, repo `huuhdiinmedeelel`,
 * `static/css/pages/parent/dashboard.css`'s `.parent-home-action.action-*`
 * rules) — the exact `135deg` stops and shadow colours that project uses,
 * not a repaint-by-eye approximation. Shared so two screens porting the same
 * look cannot drift into two slightly different palettes.
 */
export type GradientTone = "blue" | "green" | "orange" | "purple" | "pink";

export const GRADIENT_TONE_STYLE: Record<GradientTone, { gradient: string; shadow: string }> = {
  blue: {
    gradient: "bg-[linear-gradient(135deg,#60a5fa_0%,#3378e5_100%)]",
    shadow: "shadow-[0_12px_24px_rgba(51,120,229,.30)]",
  },
  green: {
    gradient: "bg-[linear-gradient(135deg,#34d399_0%,#16a96f_100%)]",
    shadow: "shadow-[0_12px_24px_rgba(22,169,111,.30)]",
  },
  orange: {
    gradient: "bg-[linear-gradient(135deg,#fbbf24_0%,#f59e0b_100%)]",
    shadow: "shadow-[0_12px_24px_rgba(245,158,11,.30)]",
  },
  purple: {
    gradient: "bg-[linear-gradient(135deg,#a78bfa_0%,#8b5cf6_100%)]",
    shadow: "shadow-[0_12px_24px_rgba(139,92,246,.28)]",
  },
  pink: {
    gradient: "bg-[linear-gradient(135deg,#fb7185_0%,#ec4899_100%)]",
    shadow: "shadow-[0_12px_24px_rgba(236,72,153,.30)]",
  },
};
