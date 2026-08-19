// Isolates one Puppeteer failure mode found during the spike.
//
// page.pdf()'s headerTemplate/footerTemplate are rendered in a SEPARATE
// document from the page. They do not inherit the page's <style>, and
// therefore do not inherit its @font-face. On a developer Mac this is
// invisible: the OS supplies a Cyrillic-capable fallback. In the minimal
// Linux container we deploy to, there is no fallback and the running header
// becomes tofu.
//
// This script renders three variants so the difference is visible in the
// output, and reports which fonts each PDF actually embeds.
//
// Run: node run-headerfont.mjs

import puppeteer from "puppeteer";
import { writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { buildHtml } from "./content.mjs";

const OUT = new URL("./out/", import.meta.url).pathname;
const FONT = readFileSync(new URL("./fonts/NotoSans-Regular.ttf", import.meta.url)).toString("base64");

// A: what you write first — a bare font-family the header cannot resolve.
const HEADER_NAIVE = `
  <div style="font-size:8px; color:#6b7280; width:100%; padding:0 16mm;
              font-family:'Noto Sans', sans-serif;">
    Бяцхан Нүүдэлчид · Хүүхдийн хөгжлийн хавтас
  </div>`;

// B: the fix — the header template carries its own @font-face.
const HEADER_FIXED = `
  <style>
    @font-face {
      font-family: "Noto Sans";
      src: url(data:font/ttf;base64,${FONT}) format("truetype");
      font-weight: 400;
    }
  </style>
  <div style="font-size:8px; color:#6b7280; width:100%; padding:0 16mm;
              font-family:'Noto Sans';">
    Бяцхан Нүүдэлчид · Хүүхдийн хөгжлийн хавтас
  </div>`;

const FOOTER = (f) => `
  ${f ? `<style>@font-face{font-family:"Noto Sans";src:url(data:font/ttf;base64,${FONT}) format("truetype");}</style>` : ""}
  <div style="font-size:8px; color:#6b7280; width:100%; text-align:center;
              font-family:${f ? "'Noto Sans'" : "sans-serif"};">
    <span class="pageNumber"></span> / <span class="totalPages"></span> хуудас
  </div>`;

function embeddedFonts(file) {
  try {
    const out = execSync(`pdffonts "${file}"`, { encoding: "utf8" });
    return out
      .split("\n")
      .slice(2)
      .filter(Boolean)
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((n, i, a) => n && a.indexOf(n) === i);
  } catch {
    return ["(pdffonts unavailable)"];
  }
}

const html = buildHtml({ observations: 4, photos: 2 });

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });

for (const [name, header, footer] of [
  ["header-naive", HEADER_NAIVE, FOOTER(false)],
  ["header-fixed", HEADER_FIXED, FOOTER(true)],
]) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  const buf = await page.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: header,
    footerTemplate: footer,
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });
  await page.close();
  const file = OUT + `puppeteer-${name}.pdf`;
  writeFileSync(file, buf);
  console.log(`${name}:`);
  for (const f of embeddedFonts(file)) console.log(`    ${f}`);
  console.log("");
}

await browser.close();
console.log("Compare the running header in the two PDFs. On Linux without system");
console.log("fonts, only 'header-fixed' renders Mongolian at all.");
