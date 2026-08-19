# PDF_SPIKE.md — PDF engine spike

**Date:** 2026-08-19
**Question:** can Puppeteer + Chromium produce the MVP's Mongolian child-portfolio
report reliably, in a container, at acceptable cost?
**Answer: yes — but only if the image installs a Cyrillic font system-wide.**
Without that one line in the Dockerfile the report renders **completely blank**,
silently, with no error.

Everything below was measured, not estimated. The spike code is in
[`spikes/pdf/`](spikes/pdf/) and is throwaway — it is not application code.

---

## 1. What was tested

A synthetic but realistic portfolio, deliberately heavier than the 8–15 pages
the MVP promises:

| Property    | Value                                                                           |
| ----------- | ------------------------------------------------------------------------------- |
| Output      | **19 pages**, A4 portrait                                                       |
| Text        | Long-form Mongolian Cyrillic, justified, incl. `Ө Ү ө ү` and `„ "` quotes       |
| Font        | Noto Sans Regular + Bold, embedded via `@font-face` base64                      |
| Images      | 12 JPEGs, 2.8 MB total, landscape / portrait / square                           |
| Layout      | `break-before: page`, `break-inside: avoid`, CSS grid, tables, definition lists |
| Chrome      | Running header + footer with `pageNumber` / `totalPages`                        |
| Source HTML | 9.26 MB with fonts and photos inlined                                           |
| Stress case | 40 observations → 27 pages                                                      |

Reference target: the Django/WeasyPrint output at
[`spikes/pdf/reference-django-weasyprint.pdf`](spikes/pdf/reference-django-weasyprint.pdf).

Correctness is not judged by eye alone. [`verify.mjs`](spikes/pdf/verify.mjs)
extracts the text back out of the finished PDF and asserts that ten specific
Mongolian strings survived the round trip — the same technique the Django suite
uses (`apps/reports/tests/test_reports.py` reads its output back with `pypdf`).

---

## 2. Results — macOS (development)

| Measurement                      | Value                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| First-ever browser launch        | 4,864 ms                                                                                   |
| Subsequent launch                | 662 ms                                                                                     |
| `page.pdf()` — warm, median of 5 | **1,935 ms** (min 1,901 / max 1,992)                                                       |
| Output                           | 1.06 MB, 19 pages                                                                          |
| Stress (40 observations)         | 1,918 ms → 1.13 MB, 27 pages                                                               |
| Text verification                | **PASS** — 10,266 Cyrillic characters extracted, 0 replacement glyphs, 10/10 strings found |

Render time is essentially flat between 19 and 27 pages, so page count is not
the cost driver — image decoding is.

## 3. Results — Debian container (deployment shape)

`node:22-slim` + Debian's `chromium` (151.0.7922.137), arm64, `--memory` capped.

| Measurement                      | Value                |
| -------------------------------- | -------------------- |
| Browser launch                   | 400–680 ms           |
| First render                     | ~2,900 ms            |
| `page.pdf()` — warm, median of 5 | **2,461–2,558 ms**   |
| Chromium process-tree RSS        | **~775 MB**          |
| Output                           | 1.0–1.1 MB, 19 pages |
| Image size                       | 1.41 GB              |

The container is ~30 % slower than macOS. A single report stays well inside the
"generate asynchronously, poll for the result" model the MVP already uses.

### 3.1 Memory floor — measured, not guessed

| `--memory` | Result              |
| ---------- | ------------------- |
| 1 GB       | PASS — 2,493 ms     |
| 768 MB     | PASS — 2,555 ms     |
| **512 MB** | **PASS — 2,528 ms** |
| 384 MB     | **FAIL**            |
| 256 MB     | **FAIL**            |

**512 MB is the floor. Provision 1 GB** so a second concurrent job does not push
the instance over.

---

## 4. The failure that matters

Chromium **cannot render any text if fontconfig has no fonts installed**, even
when the page's `@font-face` loads correctly.

Not tofu. Not boxes. **Nothing.** Images render, borders render, page breaks
happen — and every character is missing. The job reports success and the parent
downloads a blank portfolio.

Measured, with all system fonts removed from the image:

| Variant                                                   | Pages       | Body text  | Running header |
| --------------------------------------------------------- | ----------- | ---------- | -------------- |
| Bare `font-family: sans-serif` header                     | 11 (was 19) | **BROKEN** | **MISSING**    |
| Header with its own embedded `@font-face`                 | 11 (was 19) | **BROKEN** | OK             |
| **Any font installed to `/usr/share/fonts` + `fc-cache`** | **19**      | **OK**     | **OK**         |

Note the second row: embedding the font _inside the header template_ rescues the
header but not the body. Only a system-level font fixes both.

Two hypotheses were tested and **rejected**:

- _"`waitUntil: 'load'` races `@font-face`; await `document.fonts.ready`."_
  Added it. Body still blank. Not the cause.
- _"The running header will be tofu because `headerTemplate` renders in a
  separate document that does not inherit the page's `@font-face`."_
  Half true — the header genuinely does not inherit page styles, and on macOS it
  silently falls back to Times-Roman (confirmed with `pdffonts`, which shows
  `CAAAAA+Times-Roman` embedded alongside Noto Sans). But that is a _cosmetic_
  inconsistency, not the blank-page failure.

The real cause is fontconfig having an empty font set. Chromium needs at least
one installed font to initialise text shaping at all.

### 4.1 Why this nearly escaped

Debian's `chromium` package depends on `fonts-dejavu-core`, so a stock
`node:22-slim + apt-get install chromium` image happens to ship three DejaVu
families — and DejaVu covers Cyrillic. **The bug is invisible until someone
slims the image**, switches to a distroless or Alpine base, or installs Chromium
without its recommended packages. That is a change somebody makes six months
from now for image size, and the symptom is blank parent-facing reports.

The Django project already learned this — `assets/fonts/README.md` says _"Do not
rely on system fonts… If this directory is empty, Mongolian Cyrillic will render
as `□□□`."_ Its Dockerfile copies fonts in and runs `fc-cache`. **The new stack
must carry the same rule forward.** It is easy to lose in a stack change.

---

## 5. Required Dockerfile lines

```dockerfile
# Ship the Cyrillic font with the image. Do NOT rely on Chromium's package
# dependencies happening to pull DejaVu in — that is incidental, and slimming
# the base image silently produces blank reports. Measured: PDF_SPIKE.md §4.
COPY fonts/ /usr/share/fonts/truetype/kinder/
RUN fc-cache -f
```

Plus a startup assertion, so the failure is loud rather than silent:

```ts
// Refuse to boot the report worker if no font can render Cyrillic.
// A blank PDF that reports success is worse than a crash.
if (Number(execSync("fc-list :lang=mn | wc -l").toString().trim()) === 0) {
  throw new Error("No Cyrillic-capable font installed — reports would render blank");
}
```

**And a test that asserts on extracted text, not on exit status.** A generator
that returns a 1 MB PDF of blank pages passes every "did it produce a file"
check. `verify.mjs` is the shape that test should take.

---

## 6. What worked without any special handling

Verified visually and by text extraction:

- A4 page size and mm margins
- Mongolian Cyrillic including `Ө Ү ө ү`, and `„ "` typographic quotes
- Justified long-form Cyrillic with correct word spacing
- `break-before: page` — every section starts on a fresh page
- `break-inside: avoid` — no observation split across a page boundary
- Running header and footer, `pageNumber` / `totalPages` (`1 / 19`)
- `object-fit: cover` — aspect ratio preserved on landscape, portrait and square
- CSS grid and flexbox, tables with borders, definition lists
- Font subsetting — only used glyphs are embedded (1.0 MB output from 9.26 MB input)

---

## 7. The other two candidates

The brief originally asked for a three-way comparison; the stack decision then
named Puppeteer + Chromium. Puppeteer was therefore benchmarked in full and the
alternatives assessed against the same requirements. Puppeteer passed every one,
so neither alternative was benchmarked. That is a reasoned judgement, not a
measurement — stated plainly so it is not mistaken for one.

### Gotenberg

A Docker service wrapping **Chromium** behind an HTTP API. Rendering fidelity
would be identical because the renderer is identical; the differences are
operational, and all of them cost more here:

- a second always-on service to deploy, monitor and pay for on Railway/Fly
- HTML must cross the network — the 9.26 MB inlined document becomes an HTTP
  upload per job
- the font problem is unchanged, merely relocated into Gotenberg's image

Worth revisiting only if report volume justifies a dedicated render farm.

### react-pdf

A different paradigm: React primitives (`<Page>`, `<View>`, `<Text>`) with a
Yoga flexbox layout engine, no browser and no HTML/CSS.

- **Advantage:** no Chromium. ~100 MB image, tens of MB of RAM instead of 775 MB,
  and no font-shaping trap.
- **Disqualifying for this MVP:** the report layout is CSS — grid, `break-inside:
avoid`, `object-fit`, justified text. All of it would be rewritten in a
  restricted subset. Complex tables and page-break control are its known weak
  points, and the existing HTML report templates (which we have and can port)
  become worthless.

Reconsider if the 775 MB Chromium footprint drives hosting cost.

---

## 8. Recommendation

**Adopt Puppeteer + Chromium**, with four conditions:

1. **Install the Cyrillic font into the image** (`/usr/share/fonts` + `fc-cache`)
   and pin the licence in the repo — Noto Sans, SIL OFL, redistributable (RFP §19
   requires a list of licensed materials).
2. **Assert on boot** that a Cyrillic-capable font exists.
3. **Reuse one browser** across jobs; launch costs ~500 ms, each render ~2.5 s.
   A per-job launch nearly doubles the cost.
4. **Provision ≥ 1 GB** for the report worker (512 MB floor measured).

Reports remain asynchronous — enqueued, tracked by `ReportJob`, delivered as a
private R2 object behind a presigned URL. At 2.5 s per report, generating inside
a request would still be wrong: it blocks a worker and there is no retry story.

### Deployment consequence

The report worker cannot run on Vercel — a 775 MB Chromium and a 2.5 s job do
not fit a serverless function. It belongs on the Railway/Fly side, either inside
the NestJS container or as a separate worker process sharing the image. This is
the architectural fact the spike was run to establish.

---

## 9. Photographs — measured in the application (2026-08-19)

Sections 2 and 3 measured a **text-only** template. That left the number that
actually decides the instance size unmeasured, because photographs change the
arithmetic completely: base64 adds a third to every image, and a 4000×3000 JPEG
decodes to ~48 MB of bitmap in Chromium no matter how well it compressed on
disk. Twenty observations of three photos each is enough to leave the envelope
section 3 established.

`apps/api/test/reports-load.test.ts` measures the real generator against real
MinIO and real Chromium. It is opt-in — it produces ~200 MB of test images:

```bash
cd apps/api
RUN_LOAD_MEASURE=1 pnpm vitest run test/reports-load.test.ts
```

Measured on the development machine (macOS, arm64):

|                     |                                                |
| ------------------- | ---------------------------------------------- |
| Source              | 45 photos, 3000×2000, **212 MB** total         |
| Embedded in the PDF | **40** image XObjects — the configured ceiling |
| Pages               | 16                                             |
| Output              | **4.7 MB**                                     |
| Wall time           | **10.3 s**                                     |
| Node RSS            | ~270 MB (excludes the Chromium process tree)   |

The three bounds in `apps/api/src/reports/report-images.ts` are what produce
that 45 → 40 → 4.7 MB shape: downscale to 1000 px before embedding, cap the
count per report, cap the total bytes. Without them the same portfolio hands
Chromium 212 MB of base64 and the renderer is OOM-killed on a 1 GB instance —
surfacing as `Target closed`, which reads like a Puppeteer bug rather than a
capacity problem, and only for the families who have used the system most.

### Two ways this measurement lied before it was right

Both produced a passing test that measured nothing, and both are worth
remembering when changing it:

1. **Flat-colour test images.** A solid 3000×2000 JPEG compresses to ~40 KB.
   The first run reported "0.0 MB each" and a 0.1 MB report — it would have
   passed at any budget. The images must be incompressible noise.
2. **Identical test images.** With one buffer reused for every photo, Chromium
   embeds a **single** image XObject and references it ninety times. The report
   came out at 0.2 MB with 1 embedded image while appearing to carry 90. Every
   photo in the measurement is now distinct, and the test asserts on the
   XObject count for exactly this reason.

---

## 10. Reproducing

From the repository root:

```bash
cd docs/spikes/pdf
npm install                       # puppeteer + unpdf
node run-puppeteer.mjs            # macOS benchmark
node verify.mjs out/puppeteer-warm-1.pdf
node run-headerfont.mjs           # header/footer font inheritance

docker build -t pdf-spike .
docker run --rm --memory=1g pdf-spike     # container benchmark

# Reproduce the blank-page failure:
docker run --rm pdf-spike sh -c \
  'rm -rf /usr/share/fonts/*; fc-cache -f; node run-docker.mjs'

# And the fix:
docker run --rm pdf-spike sh -c \
  'rm -rf /usr/share/fonts/*; mkdir -p /usr/share/fonts/truetype/kinder;
   cp /spike/fonts/*.ttf /usr/share/fonts/truetype/kinder/; fc-cache -f;
   node run-docker.mjs'
```

Outputs land in `docs/spikes/pdf/out/`, which is gitignored — the scripts and
their inputs are tracked, the generated PDFs are not.
