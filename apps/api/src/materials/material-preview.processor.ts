import { Injectable, Logger } from "@nestjs/common";
import { StorageService } from "../storage/storage.service";
import { materialExtension } from "./material-file";
import { preparePreview } from "./material-preview";
import type { MaterialPreviewJob } from "./material-preview.queue";
import { renderFirstPages } from "./material-render";
import { MaterialsRepository, type PreviewData } from "./materials.repository";

export type PreviewOutcome = "ready" | "failed" | "stale";

/**
 * Draws one material's sample pages from its file.
 *
 * Called by `MaterialPreviewWorker` in production and directly by the tests,
 * the split `ChatVideoProcessor` makes.
 *
 * ★ **A stale job discards its result.** The operator may replace the file, or
 * switch to their own pictures, while a job runs. The pages are saved only if
 * the material is still PENDING on the very file the job drew — checked inside
 * the write (`savePreviewsIfCurrent`), not before it — and otherwise the
 * objects just stored are removed.
 */
@Injectable()
export class MaterialPreviewProcessor {
  private readonly logger = new Logger(MaterialPreviewProcessor.name);

  constructor(
    private readonly repo: MaterialsRepository,
    private readonly storage: StorageService,
  ) {}

  async run(job: MaterialPreviewJob): Promise<PreviewOutcome> {
    const material = await this.repo.findPendingRender(job.materialId, job.storageKey);
    if (!material) return "stale";

    const stored: PreviewData[] = [];
    try {
      const file = await this.storage.get(material.storageKey);
      const pages = await renderFirstPages(
        file,
        materialExtension(material.mimeType) as ".pdf" | ".ppt" | ".pptx",
      );
      if (pages.length === 0) throw new Error("the file has no pages to draw");

      for (const page of pages) {
        const preview = await preparePreview(page);
        const storageKey = this.storage.buildPlatformKey("material-previews");
        await this.storage.put(storageKey, preview.buffer, preview.mimeType);
        stored.push({ storageKey, mimeType: preview.mimeType });
      }

      const unused = await this.repo.savePreviewsIfCurrent(job.materialId, job.storageKey, stored);
      if (unused === null) {
        await this.remove(stored.map((p) => p.storageKey));
        return "stale";
      }
      // After the commit: nothing points at the pages these replaced.
      await this.remove(unused);
      return "ready";
    } catch (error) {
      this.logger.warn(`Sample pages for material ${job.materialId} failed: ${String(error)}`);
      await this.remove(stored.map((p) => p.storageKey));
      await this.repo.failPreviewsIfCurrent(job.materialId, job.storageKey);
      return "failed";
    }
  }

  private async remove(keys: string[]): Promise<void> {
    await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
  }
}
