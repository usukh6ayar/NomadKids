import { randomFillSync } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { createScenario, type Scenario } from "./support/fixtures";
import { StorageService } from "../src/storage/storage.service";
import { ReportGeneratorService } from "../src/reports/report-generator.service";
import { MAX_IMAGES_PER_REPORT } from "../src/reports/report-images";

/**
 * A worst-case portfolio, measured.
 *
 * The PDF spike established a 512 MB floor and a 384 MB failure — on a
 * **text-only** template. Photographs change the arithmetic completely, and
 * this is the number that decides the deployed instance size. `report-images.ts`
 * carries the reasoning; this file is the evidence, and its output is recorded
 * in docs/PDF_SPIKE.md §7.
 *
 * ★ Opt-in: `RUN_LOAD_MEASURE=1 pnpm vitest run test/reports-load.test.ts`.
 *
 * It generates ~45 distinct multi-megabyte JPEGs, which takes minutes. It is a
 * measurement, not a regression guard — the bounds it verifies are unit-tested
 * in `report-images.test.ts`, which runs every time.
 *
 * ★★ Two traps this test fell into, both of which made it pass while measuring
 * nothing:
 *
 *  1. **Flat-colour photos.** A solid 3000×2000 JPEG compresses to ~40 KB. The
 *     first run reported "0.0 MB each" and a 0.1 MB report.
 *  2. **Identical photos.** With the same buffer reused, Chromium embeds ONE
 *     image XObject and references it ninety times — 1 image in the output,
 *     where a real portfolio has forty. Every photo here is distinct.
 */

const ENABLED = process.env.RUN_LOAD_MEASURE === "1";

let app: INestApplication;
let generator: ReportGeneratorService;
let scenario: Scenario;
const db = testDb();

const OBSERVATIONS = 15;
const PHOTOS_EACH = 3;
const WIDTH = 3000;
const HEIGHT = 2000;

beforeAll(async () => {
  if (!ENABLED) return;
  app = await createTestApp();
  generator = app.get(ReportGeneratorService);
  await resetData();
  scenario = await createScenario("load");
}, 120_000);

afterAll(async () => {
  await app?.close();
});

/**
 * A distinct, incompressible photograph.
 *
 * `randomFillSync` rather than a `Math.random()` loop: 18 MB of raw pixels is
 * 18 million iterations in JS and dominates the measurement it is supposed to
 * support.
 */
async function distinctPhoto(): Promise<Buffer> {
  const raw = Buffer.allocUnsafe(WIDTH * HEIGHT * 3);
  randomFillSync(raw);
  return sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe.skipIf(!ENABLED)("a photo-heavy portfolio", () => {
  it("stays inside the image budget and a sane memory envelope", async () => {
    const storage = app.get(StorageService);
    const type = await db.observationType.findFirstOrThrow({ where: { kindergartenId: null } });

    let sourceBytes = 0;

    for (let i = 0; i < OBSERVATIONS; i += 1) {
      const observation = await db.observation.create({
        data: {
          kindergartenId: scenario.kindergarten.id,
          childId: scenario.child.id,
          enrollmentId: scenario.enrollment.id,
          typeId: type.id,
          source: "TEACHER",
          observedOn: new Date(2025, 8, (i % 28) + 1),
          situation: `Ажиглалт ${i + 1}: хүүхэд бүлгийн үйл ажиллагаанд идэвхтэй оролцов.`,
          teacherComment: "Багшийн тайлбар: анхаарал төвлөрөл сайжирч байна.",
          visibleToParents: true,
          reviewStatus: "APPROVED",
          includeInReport: true,
        },
      });

      for (let p = 0; p < PHOTOS_EACH; p += 1) {
        const photo = await distinctPhoto();
        sourceBytes += photo.byteLength;

        const key = storage.buildKey(scenario.child.id);
        await storage.put(key, photo, "image/jpeg");
        await db.mediaFile.create({
          data: {
            kindergartenId: scenario.kindergarten.id,
            childId: scenario.child.id,
            observationId: observation.id,
            purpose: "OBSERVATION",
            storageKey: key,
            originalName: `photo-${i}-${p}.jpg`,
            mimeType: "image/jpeg",
            sizeBytes: photo.byteLength,
            width: WIDTH,
            height: HEIGHT,
            order: p,
          },
        });
      }
    }

    const job = await db.reportJob.create({
      data: {
        kindergartenId: scenario.kindergarten.id,
        childId: scenario.child.id,
        type: "CHILD_PORTFOLIO",
        params: { audience: "STAFF", audienceUserId: scenario.teacherUser.id },
        requestedById: scenario.teacherUser.id,
      },
    });

    global.gc?.();
    const rssBefore = process.memoryUsage().rss;
    const started = Date.now();

    const result = await generator.run(job.id);

    const elapsedMs = Date.now() - started;
    const rssPeak = process.memoryUsage().rss;

    expect(result.status).toBe("DONE");

    const done = await db.reportJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { resultMedia: true },
    });

    const pdf = await storage.get(done.resultMedia!.storageKey);
    const embedded = (pdf.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;
    const totalPhotos = OBSERVATIONS * PHOTOS_EACH;

    // Printing the numbers IS the deliverable here — they get copied into
    // docs/PDF_SPIKE.md §9.
    // eslint-disable-next-line no-console
    console.log(
      `\n  Worst-case portfolio\n` +
        `    source         ${totalPhotos} photos, ${WIDTH}×${HEIGHT}, ` +
        `${(sourceBytes / 1024 / 1024).toFixed(0)} MB total\n` +
        `    embedded       ${embedded} image XObjects\n` +
        `    pages          ${done.pageCount}\n` +
        `    output         ${(done.fileSize / 1024 / 1024).toFixed(1)} MB\n` +
        `    wall time      ${(elapsedMs / 1000).toFixed(1)} s\n` +
        `    node RSS       ${(rssBefore / 1024 / 1024).toFixed(0)} → ` +
        `${(rssPeak / 1024 / 1024).toFixed(0)} MB\n`,
    );

    // ★ The cap engaged, and engaged exactly. Photos really did reach the
    // document (the dedupe trap above would show 1), and the ceiling stopped
    // them at the configured number rather than letting all 45 through.
    expect(totalPhotos).toBeGreaterThan(MAX_IMAGES_PER_REPORT);
    expect(embedded).toBe(MAX_IMAGES_PER_REPORT);

    // Each one was downscaled: the output is a small fraction of the source.
    expect(done.fileSize).toBeLessThan(sourceBytes / 10);
    // The bound that matters: a file a family can open on a phone.
    expect(done.fileSize).toBeLessThan(30 * 1024 * 1024);
  }, 900_000);
});
