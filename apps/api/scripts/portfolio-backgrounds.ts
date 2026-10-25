/**
 * Builds the portfolio PDF's page backgrounds from the designer's SVG pages.
 *
 *   pnpm --filter api exec tsx scripts/portfolio-backgrounds.ts
 *
 * ★ Why the SVGs are not used as they are (2026-10-24, the user: «давхар
 * цагаан дөрвөлжин, давхар зургууд — бүгдийг зас»). Each SVG is the designer's
 * finished sample page: a made-up child («Ариунболдын Тэмүүлэн»), sample notes,
 * sample photographs. The template used to hide them under white boxes, which
 * showed as extra white squares wherever a box did not match the design, let
 * sample text show at its edges, and stacked the child's photographs on top of
 * the sample ones. Chromium also prints the SVGs' masked images with a hairline
 * at their bounds — the black frames round every picture.
 *
 * So the sample content is removed here, once: every drawn element that lies
 * wholly inside one of a page's `ERASE` rectangles is deleted, and the page is
 * rendered to a JPEG (no masks left to print). The template draws the child's
 * own content into the empty places. The SVGs stay the source; re-run this
 * when the designer sends a new page.
 *
 * Rectangles are CSS pixels on the 794 × 1123 page (A4 at 96 dpi), measured on
 * the SVG as the designer drew it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

type Rect = [left: number, top: number, right: number, bottom: number];

const DIR = join(__dirname, "..", "src", "reports", "assets", "portfolio-template");
const WIDTH = 794;
const HEIGHT = 1123;

/** Per page: what of the designer's sample is erased. A page not listed is kept whole. */
const ERASE: Record<number, Rect[]> = {
  // The cover card's sample name, group and age — the card itself stays.
  1: [[108, 166, 688, 260]],
  // The sample name, age and group pill; the identity values (labels stay);
  // the four «Хавтасны бүрдэл» figures.
  2: [
    [55, 348, 302, 462],
    [468, 176, 728, 440],
    [280, 595, 378, 622],
    [280, 651, 378, 678],
    [598, 595, 708, 622],
    [598, 651, 708, 678],
  ],
  // Both sample kindergarten cards — the template draws one per enrolment.
  3: [[55, 64, 770, 300]],
  // The four sample notes under «Миний зан чанар» (their boxes stay).
  4: [
    [82, 716, 708, 772],
    [82, 819, 708, 875],
    [82, 922, 708, 978],
    [82, 1026, 708, 1082],
  ],
  // The family cards' sample text.
  6: [
    [97, 257, 380, 388],
    [447, 257, 716, 388],
    [102, 570, 386, 700],
    [455, 570, 735, 700],
  ],
  // The learning cards' headings and sample «хариу».
  7: [
    [80, 186, 355, 548],
    [427, 186, 703, 553],
    [80, 672, 355, 1030],
    [433, 676, 707, 1035],
  ],
  8: [
    [76, 186, 355, 548],
    [427, 186, 703, 553],
    [80, 672, 355, 1030],
    [433, 676, 707, 1035],
  ],
  // The six sample history cards.
  9: [[50, 160, 745, 920]],
  // The sample growth table and both charts' sample lines (their titles stay).
  10: [
    [55, 178, 742, 420],
    [55, 570, 370, 815],
    [408, 570, 725, 815],
  ],
  // The sample artwork type and its four pictures.
  11: [
    [68, 128, 340, 182],
    [68, 185, 742, 1080],
  ],
  // The sample album name and its six photographs.
  12: [
    [35, 133, 335, 182],
    [50, 185, 745, 1000],
  ],
  // A teacher's photographs by age: the six samples (the age heading stays).
  15: [[50, 185, 745, 1000]],
  16: [[50, 185, 745, 1000]],
  17: [[50, 185, 745, 1000]],
  18: [[50, 185, 745, 1000]],
  // The sample letter: the greeting, the body, the signature and the date.
  19: [
    [195, 198, 600, 238],
    [105, 298, 692, 862],
  ],
};

/**
 * ★ Sample content that is not an element of its own — page 3's two cards
 * and their number badges are one raster image — is painted over in the
 * page's own colour instead. Same CSS-pixel rectangles, plus the colour.
 */
const PAINT: Record<number, [...Rect, string][]> = {
  3: [[55, 66, 770, 300, "#ffffff"]],
};

/**
 * Runs in the page: deletes every drawn element wholly inside one of the
 * rectangles — never a clip path's or a mask's own shape — and counts them.
 */
const ERASE_IN_PAGE = `(rects) => {
  const inside = (r) => rects.some(([left, top, right, bottom]) =>
    r.left >= left && r.top >= top && r.right <= right && r.bottom <= bottom);
  const drawn = document.querySelectorAll(
    "svg path, svg image, svg rect, svg use, svg circle, svg ellipse, svg polygon, svg line, svg text");
  let count = 0;
  for (const element of Array.from(drawn)) {
    if (element.closest("defs, clipPath, mask")) continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    if (inside(box)) { element.remove(); count += 1; }
  }
  return count;
}`;

/** The pages the template prints (13 and 14 are not used). */
const PAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19];

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH
      ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
      : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
    for (const n of PAGES) {
      const svg = readFileSync(join(DIR, `${n}.svg`), "utf8");
      await page.setContent(
        `<!doctype html><html><body style="margin:0">${svg.replace(
          /<svg /,
          `<svg style="display:block;width:${WIDTH}px;height:${HEIGHT}px" `,
        )}</body></html>`,
        { waitUntil: "load" },
      );
      // A string, not a function: tsx would wrap a function in helpers the page lacks.
      const removed = (await page.evaluate(
        `(${ERASE_IN_PAGE})(${JSON.stringify(ERASE[n] ?? [])})`,
      )) as number;
      for (const [left, top, right, bottom, colour] of PAINT[n] ?? []) {
        await page.evaluate(
          `document.body.insertAdjacentHTML("beforeend", '<div style="position:absolute;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;background:${colour}"></div>')`,
        );
      }
      await page.screenshot({
        path: join(DIR, `clean-${n}.jpg`) as `${string}.jpeg`,
        type: "jpeg",
        quality: 88,
        clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      });
      console.log(`page ${n}: ${removed} sample element(s) erased → clean-${n}.jpg`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
