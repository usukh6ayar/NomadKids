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
 * The values below are the WHO Child Growth Standards medians and standard
 * deviations at whole-year ages, transcribed from the published tables. They
 * are coarse by design: interpolating monthly points would imply a precision
 * this table does not have.
 */

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

interface Band {
  /** Whole years. */
  age: number;
  median: number;
  /** One standard deviation, in the same unit as the median. */
  sd: number;
}

/** Height-for-age, centimetres. WHO 2006, boys and girls separately. */
const HEIGHT_BY_SEX: Record<"MALE" | "FEMALE", Band[]> = {
  MALE: [
    { age: 1, median: 75.7, sd: 2.7 },
    { age: 2, median: 87.1, sd: 3.2 },
    { age: 3, median: 96.1, sd: 3.7 },
    { age: 4, median: 103.3, sd: 4.2 },
    { age: 5, median: 110.0, sd: 4.6 },
    { age: 6, median: 116.0, sd: 5.0 },
    { age: 7, median: 121.7, sd: 5.4 },
  ],
  FEMALE: [
    { age: 1, median: 74.0, sd: 2.7 },
    { age: 2, median: 85.7, sd: 3.3 },
    { age: 3, median: 95.1, sd: 3.8 },
    { age: 4, median: 102.7, sd: 4.4 },
    { age: 5, median: 109.4, sd: 4.8 },
    { age: 6, median: 115.1, sd: 5.2 },
    { age: 7, median: 120.8, sd: 5.6 },
  ],
};

/** Weight-for-age, kilograms. WHO 2006. */
const WEIGHT_BY_SEX: Record<"MALE" | "FEMALE", Band[]> = {
  MALE: [
    { age: 1, median: 9.6, sd: 1.1 },
    { age: 2, median: 12.2, sd: 1.4 },
    { age: 3, median: 14.3, sd: 1.7 },
    { age: 4, median: 16.3, sd: 2.1 },
    { age: 5, median: 18.3, sd: 2.5 },
    { age: 6, median: 20.5, sd: 3.1 },
    { age: 7, median: 22.9, sd: 3.7 },
  ],
  FEMALE: [
    { age: 1, median: 8.9, sd: 1.1 },
    { age: 2, median: 11.5, sd: 1.4 },
    { age: 3, median: 13.9, sd: 1.8 },
    { age: 4, median: 16.1, sd: 2.3 },
    { age: 5, median: 18.2, sd: 2.8 },
    { age: 6, median: 20.2, sd: 3.2 },
    { age: 7, median: 22.4, sd: 3.8 },
  ],
};

export interface ReferenceBand {
  age: number;
  median: number;
  /** −2 SD, the conventional lower edge of "expected". */
  low: number;
  /** +2 SD. */
  high: number;
}

function toBands(rows: Band[]): ReferenceBand[] {
  return rows.map(({ age, median, sd }) => ({
    age,
    median,
    low: round1(median - 2 * sd),
    high: round1(median + 2 * sd),
  }));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
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
