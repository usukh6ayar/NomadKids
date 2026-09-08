/**
 * The growth reference — RFP §7.2's "насанд тохирсон жишиг үзүүлэлттэй
 * харьцуулах".
 *
 * ★ The RFP attaches three conditions to this feature, and they are the
 * feature. §7.2: "Жишиг үзүүлэлтийн эх сурвалж, хувилбар болон шинэчлэгдсэн
 * огноог тодорхой харуулна. Систем эмнэлгийн онош өгөхгүй бөгөөд зөвхөн
 * мэдээллийн зориулалттай анхааруулга харуулна."
 *
 * So the source travels with the numbers rather than living in a comment: every
 * response that carries a reference band also carries `REFERENCE_SOURCE`, and
 * the UI has no way to render one without the other.
 *
 * ★★ Median and ±2 SD only, deliberately NOT percentile curves.
 *
 * A percentile is a claim about where one child sits in a population, and it is
 * read as a verdict — "your child is on the 12th percentile" is the sentence
 * that sends a family to a clinic. The band this system draws answers the
 * question a kindergarten actually has: is this measurement inside the range
 * most children of this age fall in. Anything finer is a clinical instrument,
 * and CLAUDE.md §7 had percentiles out of scope for exactly this reason before
 * the scope changed; the change added the comparison, not the diagnosis.
 *
 * The values come from WHO's published month-by-month z-score workbooks. They
 * are kept as monthly observations rather than interpolated from yearly points,
 * so filtering a chart to one age does not invent precision the source lacks.
 */

import {
  BOYS_HEIGHT,
  BOYS_WEIGHT,
  GIRLS_HEIGHT,
  GIRLS_WEIGHT,
  type MonthlyReferenceTuple,
} from "./growth-reference-data";

export interface ReferenceSource {
  name: string;
  /** The edition, so a future update is visibly a different one. */
  version: string;
  /** When these numbers were published, not when the file was edited. */
  publishedOn: string;
  url: string;
  /** Shown beside every chart. RFP §7.2 requires it in as many words. */
  disclaimer: string;
}

export const REFERENCE_SOURCE: ReferenceSource = {
  name: "WHO Child Growth Standards",
  version: "2006 (0–5 нас)",
  publishedOn: "2006-04-27",
  url: "https://www.who.int/tools/child-growth-standards",
  disclaimer:
    "Энэ график нь зөвхөн мэдээллийн зориулалттай бөгөөд эмнэлгийн онош биш. " +
    "Санаа зовоосон зүйл байвал эмчид хандана уу.",
};

/** Height-for-age, centimetres. WHO 2006, boys and girls separately. */
const HEIGHT_BY_SEX: Record<"MALE" | "FEMALE", readonly MonthlyReferenceTuple[]> = {
  MALE: BOYS_HEIGHT,
  FEMALE: GIRLS_HEIGHT,
};

/** Weight-for-age, kilograms. WHO 2006. */
const WEIGHT_BY_SEX: Record<"MALE" | "FEMALE", readonly MonthlyReferenceTuple[]> = {
  MALE: BOYS_WEIGHT,
  FEMALE: GIRLS_WEIGHT,
};

export interface ReferenceBand {
  age: number;
  median: number;
  /** −2 SD, the conventional lower edge of "expected". */
  low: number;
  /** +2 SD. */
  high: number;
}

function toBands(rows: readonly MonthlyReferenceTuple[]): ReferenceBand[] {
  return rows.map(([median, low, high], month) => ({
    // The chart axis is years; fractions preserve the source's monthly grain.
    age: month / 12,
    median,
    low,
    high,
  }));
}

/**
 * The bands a chart draws behind a child's own line.
 *
 * ★ Returns `null` when the sex is unknown rather than picking one.
 *
 * `Child.sex` is not nullable today, but the reference differs between boys and
 * girls by more than a centimetre at five years old, and defaulting to either
 * would draw a band that is quietly wrong for half of them. A chart with no
 * reference line is honest; a chart with the wrong one is not.
 */
export function referenceBands(sex: "MALE" | "FEMALE" | null | undefined): {
  height: ReferenceBand[];
  weight: ReferenceBand[];
  source: ReferenceSource;
} | null {
  if (sex !== "MALE" && sex !== "FEMALE") return null;

  return {
    height: toBands(HEIGHT_BY_SEX[sex]),
    weight: toBands(WEIGHT_BY_SEX[sex]),
    source: REFERENCE_SOURCE,
  };
}
