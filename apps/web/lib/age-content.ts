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
