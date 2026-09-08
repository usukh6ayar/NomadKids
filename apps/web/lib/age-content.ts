import type { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import type { GradientTone } from "@/lib/gradient-tones";

type Age = (typeof PORTFOLIO_AGES)[number];

/**
 * A per-age tint, matching the reference build's own 2/3/4 нас colours
 * (`GRADIENT_TONE_STYLE`'s doc comment has the source) — shared by
 * `child-growth-ages.tsx`'s own nav and `AgeStepper`, so an age reads the
 * same colour on the staff accordion and the parent's pages.
 */
export const AGE_TONE: Record<Age, GradientTone> = {
  2: "green",
  3: "blue",
  4: "orange",
  5: "purple",
};

/**
 * Starter option lists for the age-2–5 preset pickers — client reference
 * screenshot, 2026-08-30, of a "сонгож эсвэл шинээр бичээрэй" (choose from a
 * list, or write your own) card for `newSkills` and `familyMembers`.
 *
 * ★ These are a reasonable starting set I wrote, not a curriculum the client
 * supplied — the same honesty `child-about-me.tsx`'s `EYE_COLOR_OPTIONS`
 * states about its own swatches being a placeholder. Both fields stay plain
 * strings on the wire (`ChildAgeProfile.newSkills` / `.familyMembers`); a
 * chip only sets the field's text, the same as typing it by hand. A real,
 * per-kindergarten curriculum list would be admin-configurable data
 * (CLAUDE.md §2.3) — its own, larger piece of work, not this one.
 */
export const AGE_SKILL_OPTIONS: Record<Age, string[]> = {
  2: [
    "Хувцасаа өөрөө тайлах",
    "Халбагаар дангаараа идэх",
    "Тоглоомоо цэгцлэх",
    "Гараа угаах",
    "Товч үг, өгүүлбэр хэлэх",
  ],
  3: [
    "Товчоо зангидах, тайлах",
    "Шүдээ угаах",
    "Зурган номын зургийг тайлбарлах",
    "Өөрийн нэрээ хэлэх",
    "Бие засах газраа бие даан хэрэглэх",
  ],
  4: [
    "Гутлаа өөрөө өмсөх",
    "Хайчаар энгийн дүрс зүсэх",
    "1-ээс 10 хүртэл тоолох",
    "Дугуй унах дадлага хийх",
    "Найзтайгаа тоглоомоо хуваалцах",
  ],
  5: [
    "Нэрээ бичиж сурах",
    "Өнгө, дүрс ялгаж таних",
    "Богино үлгэр ярьж өгөх",
    "Дугуй унах чадвартай болох",
    "Цаг хугацааны ойлголттой болох",
  ],
};

/**
 * The emotion picker on "Миний зан аранши" — client reference screenshot,
 * 2026-09-08. Unicode emoji rather than custom illustration (confirmed with
 * the client that day); a reasonable starting vocabulary I wrote, the same
 * honesty `AGE_SKILL_OPTIONS`'s own comment states about its list.
 */
export const CHARACTER_TRAIT_OPTIONS: { label: string; icon: string }[] = [
  { label: "Хөгжилтэй", icon: "😄" },
  { label: "Эелдэг", icon: "😊" },
  { label: "Бахархамаар", icon: "🥰" },
  { label: "Тайван", icon: "😌" },
  { label: "Гунигтай", icon: "😢" },
  { label: "Зөрүүд", icon: "😤" },
  { label: "Уурламтгай", icon: "😠" },
  { label: "Сандрамтгай", icon: "😰" },
  { label: "Нойрмог", icon: "😴" },
  { label: "Ичимхий", icon: "😳" },
  { label: "Зоригтой", icon: "💪" },
];

/**
 * The family-member picker on "Гэр бүл" — same source as `AGE_SKILL_OPTIONS`.
 *
 * ★ Real artwork, not emoji, since 2026-09-08 — the client's own character
 * set, delivered in Google Drive, one drawing per relation
 * (`age-preset-field.tsx`'s own doc comment has the crop/rendering story).
 * "Налх охин"/"Налх хүү" read from the delivered "охин дүү"/"эрэгтэй дүү"
 * artwork — infants in the source images, not the older-sibling reading
 * their filenames suggest; the drawings, not the filenames, are what a
 * parent actually sees in the picker.
 *
 * ★★ No "Хүү"/"Охин" entry. Those two drawings (`boy.png`/`girl.png`) are the
 * child's *own* sex-based avatar fallback now (`ChildAvatar`'s `sexFallback`,
 * `media-image.tsx`) — a household member picker listing "a boy" or "a girl"
 * as who lives with the child never made sense next to the child's own
 * `sex` field describing the same thing. Client, 2026-09-08.
 */
export const FAMILY_MEMBER_OPTIONS: { label: string; icon: string }[] = [
  { label: "Эмээ", icon: "/icons/family/grandma.png" },
  { label: "Өвөө", icon: "/icons/family/grandpa.png" },
  { label: "Аав", icon: "/icons/family/dad.png" },
  { label: "Ээж", icon: "/icons/family/mom.png" },
  { label: "Ах", icon: "/icons/family/older-brother.png" },
  { label: "Эгч", icon: "/icons/family/older-sister.png" },
  { label: "Налх охин", icon: "/icons/family/baby-girl.png" },
  { label: "Налх хүү", icon: "/icons/family/baby-boy.png" },
];

/** Same shape, for the "гэр бүлээсээ суралцсан зүйлс" card. */
export const AGE_FAMILY_OPTIONS: Record<Age, string[]> = {
  2: [
    "Ээж, аавыгаа таньж дуудах",
    "Гэрийн тэжээвэр амьтдад хайртай болох",
    "«Баярлалаа», «Уучлаарай» гэж хэлэх",
  ],
  3: [
    "Гэр бүлийн гишүүдийнхээ нэрийг мэдэх",
    "Хэрэгтэй үедээ тусламж хүсэх",
    "Гэр бүлээрээ хамт хооллох дадал",
  ],
  4: [
    "Ах, эгчтэйгээ хамт тоглох",
    "Гэрийн жижиг ажилд туслах",
    "Гэр бүлийн уламжлалт зан заншлыг мэдэх",
  ],
  5: [
    "Гэр бүлийн түүхийг сонирхох",
    "Бусдын мэдрэмжинд санаа тавих",
    "Гэр бүлийн баяр ёслолд оролцох",
  ],
};
