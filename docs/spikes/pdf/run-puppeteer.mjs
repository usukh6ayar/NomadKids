// Puppeteer + Chromium benchmark.
//
// Measures the two scenarios that matter in production:
//   cold  — launch a browser, render once, close. What a serverless/one-shot
//           worker pays on every job.
//   warm  — launch once, render N times on fresh pages. What a long-lived
//           Railway/Fly worker pays after the first job.
//
// Run: node run-puppeteer.mjs

import puppeteer from "puppeteer";
import { writeFileSync, statSync } from "node:fs";
import { buildHtml } from "./content.mjs";

const OUT = new URL("./out/", import.meta.url).pathname;

const HEADER = `
  <div style="font-size:8px; color:#6b7280; width:100%; padding:0 16mm;
              font-family: sans-serif; display:flex; justify-content:space-between;">
    <span>Бяцхан Нүүдэлчид · Хүүхдийн хөгжлийн хавтас</span>
    <span>Батбаяр Ганболд</span>
  </div>`;

const FOOTER = `
  <div style="font-size:8px; color:#6b7280; width:100%; padding:0 16mm;
              font-family: sans-serif; text-align:center;">
    <span class="pageNumber"></span> / <span class="totalPages"></span>
  </div>`;

const PDF_OPTS = {
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: HEADER,
  footerTemplate: FOOTER,
  margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
};

function pageCount(buf) {
  // Cheap structural count; good enough to confirm the document paginated and
  // did not collapse to one enormous page.
  const m = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function render(browser, html, file) {
  const page = await browser.newPage();
  // networkidle0 is unnecessary — every asset is a data: URI, so nothing is
  // fetched. 'load' is enough and avoids a fixed 500 ms idle penalty per job.
  await page.setContent(html, { waitUntil: "load" });
  const t0 = performance.now();
  const buf = await page.pdf(PDF_OPTS);
  const renderMs = performance.now() - t0;
  await page.close();
  writeFileSync(OUT + file, buf);
  return { renderMs, bytes: buf.length, pages: pageCount(buf) };
}

async function main() {
  const html = buildHtml({ observations: 14, photos: 12 });
  writeFileSync(OUT + "source.html", html);
  console.log(`source HTML: ${mb(Buffer.byteLength(html))} MB (fonts + 12 photos inlined as data URIs)\n`);

  // ---- cold ----
  const c0 = performance.now();
  let browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const launchMs = performance.now() - c0;
  const cold = await render(browser, html, "puppeteer-cold.pdf");
  const coldTotal = performance.now() - c0;
  await browser.close();

  console.log("COLD (launch + 1 render + close)");
  console.log(`  browser launch : ${launchMs.toFixed(0)} ms`);
  console.log(`  page.pdf()     : ${cold.renderMs.toFixed(0)} ms`);
  console.log(`  total          : ${coldTotal.toFixed(0)} ms`);
  console.log(`  output         : ${mb(cold.bytes)} MB, ${cold.pages} pages\n`);

  // ---- warm ----
  const w0 = performance.now();
  browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const warmLaunchMs = performance.now() - w0;
  const runs = [];
  for (let i = 0; i < 5; i++) {
    runs.push(await render(browser, html, `puppeteer-warm-${i + 1}.pdf`));
  }
  const rss = process.memoryUsage().rss;
  await browser.close();

  const times = runs.map((r) => r.renderMs).sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log("WARM (browser reused, 5 renders)");
  console.log(`  browser launch : ${warmLaunchMs.toFixed(0)} ms (paid once)`);
  console.log(`  per render     : min ${times[0].toFixed(0)} / median ${times[2].toFixed(0)} / max ${times[4].toFixed(0)} ms (mean ${mean.toFixed(0)})`);
  console.log(`  output         : ${mb(runs[0].bytes)} MB, ${runs[0].pages} pages`);
  console.log(`  node RSS       : ${mb(rss)} MB (excludes the Chromium process tree)\n`);

  // ---- stress: a bigger portfolio than the MVP promises ----
  const bigHtml = buildHtml({ observations: 40, photos: 12 });
  browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const big = await render(browser, bigHtml, "puppeteer-stress.pdf");
  await browser.close();
  console.log("STRESS (40 observations)");
  console.log(`  page.pdf()     : ${big.renderMs.toFixed(0)} ms`);
  console.log(`  output         : ${mb(big.bytes)} MB, ${big.pages} pages\n`);

  console.log("files written to out/:");
  for (const f of ["puppeteer-cold.pdf", "puppeteer-warm-1.pdf", "puppeteer-stress.pdf"]) {
    console.log(`  ${f} — ${mb(statSync(OUT + f).size)} MB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
