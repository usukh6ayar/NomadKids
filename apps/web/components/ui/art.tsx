import Image from "next/image";

/**
 * The illustrated icon set, by name.
 *
 * ★ Thirteen call sites spelled a file path instead.
 *
 * Every screen using the drawn icons wrote `<Image src="/icons/icon-menu.png"
 * alt="" width={48} height={48} />` in full, which is three decisions repeated
 * per call: where the file lives, that it is decorative, and how big it is. The
 * third had already drifted — the parent home renders them at 44 and the
 * teacher dashboard at 48, so the same drawing is two sizes in one product.
 *
 * A name also says what the caller means. `art={<Art name="progress" />}` is a
 * statement about the tile; `src="/icons/icon-progress.png"` is a statement
 * about the filesystem, and it is the one that breaks silently when a file is
 * renamed — a wrong path renders a broken image, and nothing fails in CI.
 *
 * ★★ `alt=""` is not an omission.
 *
 * These sit inside `IconChip` or `StatCard`'s `art` slot, both of which are
 * `aria-hidden` and both of which document why: the drawing repeats the label
 * beside it, and a screen reader announcing "picture of a calendar, Хичээлийн
 * жил" reads the same thing twice. The accessible name belongs to the heading,
 * not to the illustration.
 *
 * ★★★ Adding one is a file and a line.
 *
 * The set does not yet cover the administration screens — there is no calendar,
 * no group of children, no people, no storage and no report — so those still
 * render lucide glyphs. The names are reserved below rather than pointed at
 * files that do not exist: a key here that resolves to a 404 is worse than no
 * key, because the call site looks correct.
 *
 * Pending, in the same `icon-<name>.png` convention, 1024×1024 with a
 * transparent background:
 *
 *   school-year · term · group · users · child · teacher · parent
 *   storage · report · settings
 *
 * ★★★★ One family, not two.
 *
 * The thirteen below are already two styles: nine carry their own tinted
 * rounded square (`kindergarten`, `attendance`, `chat-blue`, `menu`, `notice`,
 * `portfolio`, `progress`, `survey`, `finance`) and four are bare cut-outs
 * (`analytics`, `chat-gradient`, `chat-simple`, `checklist`). Side by side in
 * one grid the two read as different sizes, because one has a chip's worth of
 * padding baked in and the other does not. Anything added should match the
 * family it will sit beside rather than the set as a whole.
 */
const SOURCE = {
  analytics: "/icons/icon-analytics.png",
  attendance: "/icons/icon-attendance.png",
  chatBlue: "/icons/icon-chat-blue.png",
  chatGradient: "/icons/icon-chat-gradient.png",
  chatSimple: "/icons/icon-chat-simple.png",
  checklist: "/icons/icon-checklist.png",
  finance: "/icons/icon-finance.png",
  kindergarten: "/icons/icon-kindergarten.png",
  menu: "/icons/icon-menu.png",
  notice: "/icons/icon-notice.png",
  portfolio: "/icons/icon-portfolio.png",
  progress: "/icons/icon-progress.png",
  survey: "/icons/icon-survey.png",
} as const;

export type ArtName = keyof typeof SOURCE;

/** Every name in the set, for a gallery or a test that walks them. */
export const ART_NAMES = Object.keys(SOURCE) as ArtName[];

export function Art({
  name,
  /**
   * Rendered size in CSS pixels.
   *
   * 48 is the dashboard's tile art and the default. The parent home passes 44,
   * and that difference is preserved rather than quietly normalised — it is a
   * design decision somebody should make deliberately, not a side effect of
   * this file existing.
   */
  size = 48,
  className,
}: {
  name: ArtName;
  size?: number;
  className?: string;
}) {
  return <Image src={SOURCE[name]} alt="" width={size} height={size} className={className} />;
}
