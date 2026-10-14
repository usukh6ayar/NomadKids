/**
 * A login name suggested from a kindergarten's name — «Бамбарууш цэцэрлэг» →
 * `bambaruush` (the user, 2026-10-14: from the organisation, because two
 * directors can share a name). Only a suggestion: the operator can change it,
 * and the API still refuses one already taken.
 */

/** Cyrillic → Latin, the way Mongolians write their names in Latin letters. */
const LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "ye",
  ё: "yo",
  ж: "j",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  ө: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ү: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sh",
  ъ: "",
  ы: "y",
  ь: "i",
  э: "e",
  ю: "yu",
  я: "ya",
};

/** Words every kindergarten's name carries, which tell nothing apart. */
const GENERIC = new Set(["цэцэрлэг", "цэцэрлэгт", "хүүхдийн", "ххк", "төхк", "ноп"]);

function latin(word: string): string {
  return [...word].map((char) => LATIN[char] ?? char).join("");
}

export function suggestUsername(organisation: string): string {
  const words = organisation
    .toLocaleLowerCase("mn")
    .replace(/\([^)]*\)/g, " ") // «(жишээ)», «(салбар)»
    .replace(/(\d+)\s*-?\s*(р|дугаар)(?![а-яёөү])/gu, "$1") // «23-р», «5 дугаар»
    .split(/[^0-9a-zа-яёөү]+/u)
    .filter((word) => word && !GENERIC.has(word))
    .map((word) => latin(word).replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  const name = words.join(".").slice(0, 40).replace(/\.+$/, "");
  // «23-р цэцэрлэг» leaves only a number — say what it is.
  if (!/[a-z]/.test(name)) return `tsetserleg${name.replaceAll(".", "")}`;
  return name.length >= 3 ? name : `${name}.tsetserleg`;
}
