import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import puppeteer, { type Browser } from "puppeteer";

/**
 * Renders HTML to A4 PDF with Puppeteer + Chromium.
 *
 * Every parameter here comes from a measurement in `docs/PDF_SPIKE.md`, not
 * from a preference:
 *
 *  - **One browser, reused.** Launch costs ~500 ms; each render ~2.5 s in a
 *    container. A launch per job nearly doubles the cost.
 *  - **≥ 1 GB RAM for this process.** 512 MB is the measured floor; 384 MB
 *    fails. The Chromium process tree alone is ~775 MB.
 *  - **Fonts must be installed system-wide**, which `FontCheckService` asserts
 *    at boot. `@font-face` alone is not enough — §4.
 */
@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  /**
   * The shared browser.
   *
   * The in-flight promise is cached so that two jobs arriving together launch
   * one browser rather than two — the second would leak, because only the last
   * assignment to `this.browser` is ever closed.
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    this.launching ??= puppeteer
      .launch({
        args: [
          "--no-sandbox",
          // /dev/shm is 64 MB in most containers; Chromium needs more and
          // crashes in ways that look like random renderer failures.
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      })
      .then((browser) => {
        this.browser = browser;
        this.launching = null;
        return browser;
      })
      .catch((error: unknown) => {
        this.launching = null;
        throw error;
      });

    return this.launching;
  }

  /**
   * Renders one document.
   *
   * `waitUntil: "load"` is sufficient because every asset is inlined as a data:
   * URI — nothing is fetched. `networkidle0` would add a fixed 500 ms idle
   * period per job for no benefit.
   */
  async render(html: string, options: RenderOptions = {}): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: "load" });

      // Belt and braces after the spike: with fonts installed this resolves
      // immediately, and it costs nothing.
      // A string rather than a callback: the callback form would need the DOM
      // lib in a Node-targeted tsconfig, and pulling `dom` into the API's types
      // would make `window` and `localStorage` autocomplete everywhere.
      await page.evaluateHandle("document.fonts.ready");

      const pdf = await page.pdf({
        format: "A4",
        landscape: options.landscape ?? false,
        printBackground: true,
        displayHeaderFooter: Boolean(options.headerTemplate ?? options.footerTemplate),
        headerTemplate: options.headerTemplate ?? "<span></span>",
        footerTemplate: options.footerTemplate ?? "<span></span>",
        margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
      });

      return Buffer.from(pdf);
    } finally {
      // Always closed, even on failure: a leaked page holds a renderer process
      // and the worker's memory climbs until the platform kills it.
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }

  /** Diagnostic for the health endpoint. */
  async isReady(): Promise<boolean> {
    try {
      const browser = await this.getBrowser();
      return browser.connected;
    } catch (error) {
      this.logger.warn(`Chromium unavailable: ${(error as Error).message}`);
      return false;
    }
  }
}

export interface RenderOptions {
  headerTemplate?: string;
  footerTemplate?: string;
  /**
   * Rotates the page to A4 landscape.
   *
   * ★ Added for `нэмэлт.md` §16's financial reports, which are up to eight
   * columns of names and money. In portrait every row wraps to three lines and
   * the document becomes unreadable — the class of failure `docs/PDF_SPIKE.md`
   * §4 warns about, where the file is produced successfully and is useless.
   *
   * Defaults to portrait: every child report is a reading document, and a
   * portfolio in landscape would be the same mistake in the other direction.
   */
  landscape?: boolean;
}
