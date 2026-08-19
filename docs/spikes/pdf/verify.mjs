// Correctness check for a generated PDF.
//
// Timing numbers are worthless if the document renders Mongolian as boxes, so
// this extracts the text back out and asserts that specific Cyrillic strings
// from the source survived the round trip. This mirrors how the Django project
// verified its own WeasyPrint output (apps/reports/tests/test_reports.py reads
// the PDF back with pypdf and asserts on the extracted text).
//
// Run: node verify.mjs out/puppeteer-warm-1.pdf

import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

// Strings chosen to exercise different failure modes: plain Cyrillic, the
// letters unique to Mongolian (Ө, Ү), typographic quotes, a long agglutinative
// word, and digits mixed with Cyrillic units.
const MUST_CONTAIN = [
  "Батбаяр Ганболд",
  "Бяцхан Нүүдэлчид",
  "Миний тухай",
  "Хөгжлийн үнэлгээ",
  "нийгэмшихүйн",
  "Өндөр",
  "Үлгэр",
  "„Яагаад туулай",
  "Багшийн нэгтгэсэн дүгнэлт",
  "Урлаг, гоо зүйн хүмүүжил",
];

const file = process.argv[2];
if (!file) {
  console.error("usage: node verify.mjs <file.pdf>");
  process.exit(1);
}

const buf = new Uint8Array(readFileSync(file));
const doc = await getDocumentProxy(buf);
const { totalPages, text } = await extractText(doc, { mergePages: true });

// PDF text extraction inserts breaks at line ends; collapse whitespace so a
// phrase split across two lines still matches.
const flat = text.replace(/\s+/g, " ");

console.log(`file       : ${file}`);
console.log(`pages      : ${totalPages}`);
console.log(`characters : ${text.length}`);

const cyrillic = (text.match(/[Ѐ-ӿ]/g) || []).length;
const replacement = (text.match(/[�□]/g) || []).length;
console.log(`cyrillic   : ${cyrillic} chars`);
console.log(`tofu/boxes : ${replacement}`);
console.log("");

let failed = 0;
for (const needle of MUST_CONTAIN) {
  const ok = flat.includes(needle.replace(/\s+/g, " "));
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${needle}`);
}

console.log("");
if (failed === 0 && replacement === 0 && cyrillic > 1000) {
  console.log(`RESULT: PASS — ${cyrillic} Cyrillic characters extracted, no replacement glyphs`);
} else {
  console.log(`RESULT: FAIL — ${failed} missing strings, ${replacement} replacement glyphs`);
  process.exitCode = 1;
}
