import { Injectable, Logger } from "@nestjs/common";
import { StorageService } from "../storage/storage.service";
import { ReportsRepository } from "./reports.repository";
import { ReportsQueue } from "./reports.queue";

/**
 * How long a job may sit at QUEUED before it is assumed lost.
 *
 * Generously past the worst measured render (10 s for a photo-heavy portfolio,
 * PDF_SPIKE.md §9) plus queue wait, so a busy worker is never second-guessed.
 */
const STALE_QUEUED_MS = 30 * 60 * 1000;

/**
 * Removes generated PDFs once their retention window has passed.
 *
 * ★ A generated report is a **copy** of a child's record, sitting in object
 * storage outside the permission system that produced it. Everything else in
 * this system is authorized on every read; a stored PDF is authorized once, at
 * generation. Keeping those copies indefinitely accumulates exactly the
 * artefact the design works to avoid — and D13 put that storage outside
 * Mongolia, which makes "how long do copies live" a question with an answer the
 * client can be told.
 *
 * The job row survives; only the file goes. What was generated for whom stays
 * auditable.
 */
@Injectable()
export class ReportRetentionService {
  private readonly logger = new Logger(ReportRetentionService.name);

  constructor(
    private readonly repo: ReportsRepository,
    private readonly storage: StorageService,
    private readonly queue: ReportsQueue,
  ) {}

  /**
   * Re-enqueues jobs that were accepted but never picked up.
   *
   * The window is narrow but real: the row commits, and the enqueue happens
   * after. A process death in between leaves a `QUEUED` row nobody is working
   * on, and the client polls it for ever. `ReportsQueue.enqueue` uses the row
   * id as the BullMQ job id, so re-enqueueing something already queued is a
   * no-op rather than a duplicate render.
   */
  async requeueStale(now = new Date()): Promise<{ requeued: number }> {
    const stale = await this.repo.listStaleQueued(new Date(now.getTime() - STALE_QUEUED_MS));
    let requeued = 0;

    for (const job of stale) {
      try {
        await this.queue.enqueue(job.id);
        requeued += 1;
      } catch (error) {
        this.logger.warn(`Could not re-enqueue report job ${job.id}: ${(error as Error).name}`);
      }
    }

    if (requeued > 0) this.logger.log(`Re-enqueued ${requeued} stalled report job(s)`);
    return { requeued };
  }

  async sweep(now = new Date()): Promise<{ removed: number }> {
    const expired = await this.repo.listExpired(now);
    let removed = 0;

    for (const job of expired) {
      // Storage first, then the row. The reverse would leave an object nothing
      // points at — unreachable and uncollectable, because the only record of
      // its key has been deleted.
      if (job.resultMedia?.storageKey) {
        try {
          await this.storage.delete(job.resultMedia.storageKey);
        } catch (error) {
          // A storage failure must not stop the sweep: the next run retries
          // this one, and the remaining jobs still get cleaned.
          this.logger.warn(`Could not delete expired report object: ${(error as Error).name}`);
          continue;
        }
      }

      await this.repo.clearExpiredResult(job.id, job.resultMediaFileId);
      removed += 1;
    }

    if (removed > 0) this.logger.log(`Removed ${removed} expired report file(s)`);
    return { removed };
  }
}
