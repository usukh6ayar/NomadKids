// In-container run: measures Puppeteer on the actual deployment shape and
// proves the header-font failure mode on a system with no Cyrillic fonts.
//
// Executed as the image's CMD.

import puppeteer from "puppeteer";
import { writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { extractText, getDocumentProxy } from "unpdf";
import { buildHtml } from "./content.mjs";

const FONT = readFileSync("./fonts/NotoSans-Regular.ttf").toString("base64");

const HEADER_NAIVE = `<div style="font-size:8px;color:#6b7280;width:100%;padding:0 16mm;font-family:sans-serif;">
    Бяцхан Нүүдэлчид · Хүүхдийн хөгжлийн хавтас</div>`;

const HEADER_FIXED = `<style>@font-face{font-family:"Noto Sans";src:url(data:font/ttf;base64,${FONT}) format("truetype");}</style>
  <div style="font-size:8px;color:#6b7280;width:100%;padding:0 16mm;font-family:'Noto Sans';">
    Бяцхан Нүүдэлчид · Хүүхдийн хөгжлийн хавтас</div>`;

const FOOTER = `<style>@font-face{font-family:"Noto Sans";src:url(data:font/ttf;base64,${FONT}) format("truetype");}</style>
  <div style="font-size:8px;color:#6b7280;width:100%;text-align:center;font-family:'Noto Sans';">
    <span class="pageNumber"></span> / <span class="totalPages"></span> хуудас</div>`;

const mb = (b) => (b / 1024 / 1024).toFixed(1);

function systemFonts() {
  try {
    return execSync("fc-list 2>/dev/null | wc -l", { encoding: "utf8" }).trim();
  } catch {
    return "fontconfig not present";
  }
}

function rssOfChromium() {
  // Sum RSS across the whole Chromium process tree — the number that decides
  // which Railway/Fly instance size the report worker needs.
  try {
    const out = execSync("ps -eo rss,comm --no-headers", { encoding: "utf8" });
    let total = 0;
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (m && /chrom/i.test(m[2])) total += Number(m[1]) * 1024;
    }
    return total;
  } catch {
    return 0;
  }
}

console.log(`system fonts installed : ${systemFonts()}`);
console.log(`chromium               : ${execSync("chromium --version", { encoding: "utf8" }).trim()}`);
console.log("");

const html = buildHtml({ observations: 14, photos: 12 });

const t0 = Date.now();
const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const launchMs = Date.now() - t0;

// Kept as a belt-and-braces barrier, but note what the spike actually found:
// awaiting document.fonts.ready does NOT rescue a container with an empty
// fontconfig set. With zero fonts installed system-wide, Chromium renders no
// text at all — not tofu, nothing — even though the @font-face data: URI loads
// successfully. The fix is to install a Cyrillic font into /usr/share/fonts and
// run fc-cache; see PDF_SPIKE.md §5.
const FONT_READY = process.env.WAIT_FOR_FONTS !== "0";

const results = {};
for (const [name, header] of [["naive", HEADER_NAIVE], ["fixed", HEADER_FIXED]]) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  if (FONT_READY) await page.evaluate(() => document.fonts.ready);
  const t = Date.now();
  const buf = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: header,
    footerTemplate: FOOTER,
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });
  const ms = Date.now() - t;
  await page.close();
  writeFileSync(`out/docker-${name}.pdf`, buf);
  results[name] = { ms, bytes: buf.length, buf };
}

// Repeat renders on the warm browser to get a stable per-job figure.
const warm = [];
for (let i = 0; i < 5; i++) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const t = Date.now();
  await page.pdf({ format: "A4", printBackground: true, margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" } });
  warm.push(Date.now() - t);
  await page.close();
}

const chromiumRss = rssOfChromium();
await browser.close();

console.log(`browser launch         : ${launchMs} ms`);
console.log(`render (cold page)     : ${results.naive.ms} ms`);
console.log(`render (warm, 5 runs)  : ${warm.map((x) => x + "ms").join(" ")}`);
console.log(`median warm render     : ${warm.sort((a, b) => a - b)[2]} ms`);
console.log(`chromium tree RSS      : ${mb(chromiumRss)} MB`);
console.log(`output size            : ${mb(results.fixed.bytes)} MB`);
console.log("");

// The decisive check: what does the running header actually contain?
for (const name of ["naive", "fixed"]) {
  const doc = await getDocumentProxy(new Uint8Array(results[name].buf));
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  const header = "Бяцхан Нүүдэлчид";
  const bodyOk = text.includes("Батбаяр Ганболд");
  const headerOk = text.includes(header);
  const tofu = (text.match(/[�□]/g) || []).length;
  console.log(`header-${name}: pages=${totalPages} body=${bodyOk ? "OK" : "BROKEN"} runningHeader=${headerOk ? "OK" : "MISSING/TOFU"} tofu=${tofu}`);
}
