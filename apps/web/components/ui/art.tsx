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
 * `child`, `teacher`, `register` and `report` arrived on 2026-08-31 and are
 * placed where the owner put them — three on the administration board's stat
 * cards, one on the dashboard's attendance section. The rest of those screens
 * still render lucide glyphs, and the names stay reserved rather than pointed
 * at files that do not exist: a key here that resolves to a 404 is worse than
 * no key, because the call site looks correct.
 *
 * Still pending, in the same `icon-<name>.png` convention, 1024×1024 with a
 * transparent background:
 *
 *   school-year · term · group · users · parent · storage · settings
 *
 * ★★★★★ The four that landed were rebuilt, not dropped in.
 *
 * They arrived as 570×426 screenshots against a set that is 1024×1024 — a
 * landscape crop of a square icon. What the crop removed is the bottom of each
 * *tinted square*, not the drawing on it, so a square cut to the file's own
 * height keeps every element whole; where an element reaches that edge it
 * bleeds off it, which is how the artwork was drawn (`child`'s identity card
 * does exactly that in the original).
 *
 * The fifth, a school building, is `kindergarten` already — it has been in the
 * set since it was created, at full size, so it was placed rather than added.
 *
 * ★★★★ One family, not two.
 *
 * ★★★★★ `survey` and `finance` were dropped when the parent home's tile grid
 * went away — PR #60's squash-merge (`2f1bfa9`) was cut from a branch that had
 * not rebased past the commits that finished migrating that grid onto this
 * registry, so merging it silently reverted both keys, their two PNGs, and
 * the whole `QuickTileGrid` section of `(app)/home/page.tsx`. Restored from
 * the commit immediately before the squash rather than redrawn — see
 * `ui/quick-tile.tsx` for the grid itself. They are the only two keys nothing
 * else on the product draws, which is why they are the two that went missing
 * without anyone noticing sooner.
 *
 * ★★★★★★ 2026-09-08 — nine of the thirteen were separately replaced with the
 * client's own icon pack (`analytics`, `attendance`, `child`, `kindergarten`,
 * `menu`, `notice`, `portfolio`, `progress`, `teacher`), delivered as bare
 * cut-outs — no tinted square baked in, unlike the set they replaced.
 * `register` and `report` are two of the four left in the old padded style
 * (`survey`/`finance` above are the other two, for an unrelated reason): the
 * delivered pack had no icon for either concept, so nothing was swapped
 * rather than guessing. Side by side in one grid the two styles read as
 * different sizes, because one has a chip's worth of padding baked in and the
 * other does not — expected until the rest get a matching replacement or the
 * nine get padded to match them. Anything added should match the family it
 * will sit beside rather than the set as a whole.
 */
const SOURCE = {
  analytics: "/icons/icon-analytics.png",
  attendance: "/icons/icon-attendance.png",
  child: "/icons/icon-child.png",
  finance: "/icons/icon-finance.png",
  kindergarten: "/icons/icon-kindergarten.png",
  menu: "/icons/icon-menu.png",
  notice: "/icons/icon-notice.png",
  portfolio: "/icons/icon-portfolio.png",
  progress: "/icons/icon-progress.png",
  register: "/icons/icon-register.png",
  report: "/icons/icon-report.png",
  survey: "/icons/icon-survey.png",
  teacher: "/icons/icon-teacher.png",
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
