import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../config/env";
import { queuePrefix } from "../reports/reports.queue";

export const CHAT_VIDEO_QUEUE = "chat-video";

/**
 * The producer side of the chat video queue — the API enqueues, the
 * `reports-worker` container transcodes (`ChatVideoWorker`).
 *
 * ★ The BullMQ job id is the `MediaFile` id, so a retried request cannot
 * transcode the same upload twice.
 */
@Injectable()
export class ChatVideoQueue implements OnApplicationShutdown {
  private readonly env = loadEnv();

  private readonly connection: Redis = new IORedis(this.env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  private readonly queue = new Queue(CHAT_VIDEO_QUEUE, {
    connection: this.connection,
    prefix: queuePrefix(this.env.NODE_ENV),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: { age: 24 * 3600 },
    },
  });

  async enqueue(mediaId: string): Promise<void> {
    await this.queue.add(CHAT_VIDEO_QUEUE, { mediaId }, { jobId: mediaId });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
  }
}
