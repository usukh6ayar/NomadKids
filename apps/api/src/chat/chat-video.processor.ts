import { Injectable, Logger } from "@nestjs/common";
import { CHAT_VIDEO_MAX_SECONDS } from "@kinder/contracts";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageService } from "../storage/storage.service";
import { probeVideo, transcodeVideo } from "./chat-video";
import { ChatRepository } from "./chat.repository";

export type VideoOutcome = "ready" | "failed" | "gone";

/**
 * Turns one raw chat upload into the stored video.
 *
 * Called by `ChatVideoWorker` in production and directly by the tests, the
 * same split `ReportGeneratorService.run()` makes.
 *
 * ★ The raw object is deleted whatever happens — it is the phone's original,
 * with its location metadata still inside, and nothing may ever serve it.
 */
@Injectable()
export class ChatVideoProcessor {
  private readonly logger = new Logger(ChatVideoProcessor.name);

  constructor(
    private readonly repo: ChatRepository,
    private readonly storage: StorageService,
  ) {}

  async run(mediaId: string): Promise<VideoOutcome> {
    const media = await this.repo.findPendingVideo(mediaId);
    // Expired, failed or already done — nothing to do, and not an error.
    if (!media) return "gone";

    const dir = await mkdtemp(join(tmpdir(), "chat-video-"));
    const input = join(dir, "raw");
    const output = join(dir, "out.mp4");

    try {
      await this.storage.getToFile(media.storageKey, input);

      const probe = await probeVideo(input);
      if (!probe || probe.durationSec > CHAT_VIDEO_MAX_SECONDS) {
        await this.repo.failVideo(mediaId);
        return "failed";
      }

      await transcodeVideo(input, output);
      const result = await probeVideo(output);
      if (!result) {
        await this.repo.failVideo(mediaId);
        return "failed";
      }

      const { size } = await stat(output);
      // A fresh random key — the raw one is deleted below, never overwritten
      // in place, so a half-written object can never be what is served.
      const prefix = media.storageKey.split("/").slice(0, -1).join("/");
      const storageKey = `${prefix}/${randomUUID()}`;
      await this.storage.putFile(storageKey, output, "video/mp4");

      const finished = await this.repo.finishVideo(mediaId, {
        storageKey,
        // The bytes are MP4 now, whatever the phone called them.
        originalName: media.originalName.replace(/\.[^.]*$/, "") + ".mp4",
        sizeBytes: size,
        width: result.width,
        height: result.height,
        durationSec: result.durationSec,
      });
      if (!finished) {
        // Expired while it was encoding: the new object has no row to serve it.
        await this.storage.delete(storageKey).catch(() => undefined);
        return "gone";
      }
      return "ready";
    } catch (error) {
      this.logger.error(`Chat video ${mediaId} failed to transcode`, error as Error);
      await this.repo.failVideo(mediaId);
      return "failed";
    } finally {
      await this.storage.delete(media.storageKey).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  }
}
