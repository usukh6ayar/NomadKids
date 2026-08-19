import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ★ Refuses to start the report worker without a Cyrillic-capable font.
 *
 * This is the single most important line of defence in the reporting system,
 * and it exists because of what the spike found (`docs/PDF_SPIKE.md` §4):
 *
 * **Chromium renders no text at all when fontconfig has an empty font set.**
 * Not tofu. Not boxes. Nothing. Images render, borders render, page breaks
 * happen — and every character is missing. The job reports success and a
 * parent downloads a blank portfolio of their child.
 *
 * A failure that silently produces plausible-looking output is worse than a
 * crash, so this turns it into a crash. A container that will render blank PDFs
 * should never accept traffic.
 *
 * The hazard is not hypothetical: Debian's `chromium` package happens to pull
 * in DejaVu, so the bug is invisible until somebody slims the image, switches
 * to Alpine or distroless, or installs with `--no-install-recommends`. That is
 * a change made six months from now for image size, and the symptom is blank
 * parent-facing reports.
 */

export interface FontCheckResult {
  ok: boolean;
  detail: string;
}

/**
 * Checks that at least one installed font can render Mongolian Cyrillic.
 *
 * Two independent signals, because either alone can mislead:
 *
 *  1. `fc-list :lang=mn` — what Chromium will actually consult. Authoritative,
 *     but absent on a machine without fontconfig (macOS development).
 *  2. The bundled font files existing on disk — a weaker check that at least
 *     catches a broken `COPY` in the Dockerfile.
 */
export function checkCyrillicFont(fontDir: string): FontCheckResult {
  const bundled = existsSync(fontDir)
    ? readdirSync(fontDir).filter((f) => f.endsWith(".ttf") || f.endsWith(".otf"))
    : [];

  let fontconfigCount: number | null = null;
  try {
    const output = execFileSync("fc-list", [":lang=mn", "family"], {
      encoding: "utf8",
      timeout: 5000,
    });
    fontconfigCount = output.split("\n").filter((line) => line.trim()).length;
  } catch {
    // fc-list is not installed — normal on macOS, where the OS supplies fonts
    // through a different mechanism. Fall back to the bundled-files check.
    fontconfigCount = null;
  }

  if (fontconfigCount !== null) {
    if (fontconfigCount === 0) {
      return {
        ok: false,
        detail:
          "fontconfig reports no font covering Mongolian. Chromium will render " +
          "every PDF completely blank, with no error. Add to the image:\n" +
          "  COPY assets/fonts/ /usr/share/fonts/truetype/kinder/\n" +
          "  RUN fc-cache -f\n" +
          "See docs/PDF_SPIKE.md §4.",
      };
    }
    return { ok: true, detail: `${fontconfigCount} Mongolian-capable font(s) registered` };
  }

  if (bundled.length === 0) {
    return {
      ok: false,
      detail:
        `No fonts found in ${fontDir} and fontconfig is unavailable, so nothing ` +
        "can be verified. PDFs may render blank.",
    };
  }

  return {
    ok: true,
    detail: `fontconfig unavailable; ${bundled.length} bundled font file(s) present`,
  };
}

/** The directory the Dockerfile also copies into `/usr/share/fonts`. */
export function bundledFontDir(): string {
  // `__dirname` is `dist/reports` in a build and `src/reports` under tsx, so
  // both resolve to the package root's `assets/fonts`.
  return join(__dirname, "..", "..", "assets", "fonts");
}
