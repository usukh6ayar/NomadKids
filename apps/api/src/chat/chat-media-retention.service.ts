import { Injectable, Logger } from "@nestjs/common";
import { CHAT_MEDIA_RETENTION_DAYS } from "@kinder/contracts";
import { StorageService } from "../storage/storage.service";
import { ChatRepository } from "./chat.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;
/** Bounds one night's work; anything left over is collected the next night. */
const MAX_BATCHES = 25;
/** A transcode that has not finished in this long is not going to. */
const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * Chat photographs and videos live `CHAT_MEDIA_RETENTION_DAYS` — the user,
 * 2026-10-09. Run nightly from `MaintenanceService.runCleanup`.
 *
 * ★ The object is deleted; the row is kept, `EXPIRED` and soft-deleted (§3.2),
 * so the message keeps its text and can say an attachment was removed. Object
 * first, then the row, and only the rows whose object really went: a storage
 * outage leaves them for the next night rather than leaving an object no row
 * points at, which nothing would ever collect.
 *
 * ★★ `scripts/backup.sh` excludes the `chat/` prefix from its media mirror, or
 * the backup would keep every expired video on the same disk for ever.
 */
@Injectable()
export class ChatMediaRetentionService {
  private readonly logger = new Logger(ChatMediaRetentionService.name);

  constructor(
    private readonly repo: ChatRepository,
    private readonly storage: StorageService,
  ) {}

  async sweep(now = new Date()): Promise<{ expired: number; stuck: number }> {
    const cutoff = new Date(now.getTime() - CHAT_MEDIA_RETENTION_DAYS * DAY_MS);
    let expired = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await this.repo.expiredMedia(cutoff, BATCH);
      if (rows.length === 0) break;
      const removed = await this.removeObjects(rows);
      await this.repo.markExpired(removed, now);
      expired += removed.length;
      // Storage refused every one — the same rows would come back next batch.
      if (removed.length === 0 || rows.length < BATCH) break;
    }

    const stuck = await this.repo.stuckVideos(new Date(now.getTime() - STUCK_AFTER_MS), BATCH);
    for (const id of await this.removeObjects(stuck)) await this.repo.failVideo(id);

    return { expired, stuck: stuck.length };
  }

  /** The ids whose object is gone. S3 answers a delete of a missing key with success. */
  private async removeObjects(rows: { id: string; storageKey: string }[]): Promise<string[]> {
    const removed: string[] = [];
    for (const row of rows) {
      try {
        await this.storage.delete(row.storageKey);
        removed.push(row.id);
      } catch (error) {
        this.logger.warn(`Could not delete chat media ${row.id}: ${(error as Error).message}`);
      }
    }
    return removed;
  }
}
