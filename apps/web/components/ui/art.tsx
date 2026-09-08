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
 * statement about the tile; `src="/icons/icon-progress-3d.png"` is a statement
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
 * Only artwork that exists belongs in this registry: a key that resolves to a
 * 404 is worse than no key because the call site looks correct while the UI is
 * broken.
 *
 * Still pending, in the same `icon-<name>.png` convention, square with a
 * transparent background:
 *
 *   school-year · term · users · parent · storage · settings
 *
 * ★★★★ Keep the supplied feature drawings central.
 *
 * `child`, `group`, `attendance`, `teacher`, `food`, `kindergarten`, `finance`,
 * `notice`, `survey`, `progress`, and the four portfolio launcher drawings are
 * the owner's 1254×1254 transparent PNGs, kept at their original resolution.
 * Every dashboard tile, navigation item and page identity reaches them through
 * this registry rather than carrying a second copy or a route-specific file
 * path. Replacing one source here therefore replaces that feature consistently
 * across the product.
 */
const SOURCE = {
  analytics: "/icons/icon-analytics.png",
  attendance: "/icons/icon-attendance-3d.png",
  child: "/icons/icon-children-3d.png",
  finance: "/icons/icon-finance-payment-3d.png",
  food: "/icons/icon-food-3d.png",
  group: "/icons/icon-group-3d.png",
  kindergarten: "/icons/icon-kindergarten-3d.png",
  menu: "/icons/icon-menu.png",
  notice: "/icons/icon-notice-3d.png",
  portfolio: "/icons/icon-portfolio.png",
  portfolioAboutMe: "/icons/icon-portfolio-about-me-3d.png",
  portfolioAgeComparison: "/icons/icon-portfolio-age-comparison-3d.png",
  portfolioDevelopment: "/icons/icon-portfolio-development-3d.png",
  portfolioGallery: "/icons/icon-portfolio-gallery-3d.png",
  progress: "/icons/icon-progress-3d.png",
  register: "/icons/icon-register.png",
  report: "/icons/icon-report.png",
  survey: "/icons/icon-survey-3d.png",
  teacher: "/icons/icon-teacher-3d.png",
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
