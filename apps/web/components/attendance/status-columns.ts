/**
 * The four attendance columns' colours — Ирсэн, Өвчтэй, Чөлөөтэй, Тасалсан.
 * Put `data-tone` on the header cell, or the workspace theme repaints it.
 *
 * ★ 2026-09-26, after the ministry's SIS register, which tints each status
 * column so a row reads as colour before it reads as numbers (the client:
 * «ирц бүртгэл нтр ни иймэрхүү байвал зүгээр»). One map, so the director's
 * register and the board beside it cannot drift into two palettes.
 *
 * The header takes the tint with the tone's own ink (4.5:1 or better on the
 * full tint); a figure takes the ink only when it is not nought, so a column
 * of zeros stays quiet and the one absence in it is what the eye finds.
 */
export const STATUS_COLUMN = {
  present: { head: "bg-mint/70 text-mint-ink", value: "text-mint-ink" },
  sick: { head: "bg-peach/70 text-peach-ink", value: "text-peach-ink" },
  excused: { head: "bg-sun/70 text-sun-ink", value: "text-sun-ink" },
  absent: { head: "bg-danger-soft text-danger", value: "text-danger" },
} as const;

export type StatusColumn = keyof typeof STATUS_COLUMN;
