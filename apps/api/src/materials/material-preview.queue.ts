import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../config/env";
import { queuePrefix } from "../reports/reports.queue";

export const MATERIAL_PREVIEW_QUEUE = "material-preview";

export interface MaterialPreviewJob {
  materialId: string;
  /** The file the job was asked to draw — a job for a replaced file discards itself. */
  storageKey: string;
}

/**
 * The producer side of the sample-page queue — the API enqueues, the
 * `reports-worker` container draws (`MaterialPreviewWorker`).
 *
 * ★ A fresh job id per request, not the material id. BullMQ drops an `add`
 * whose id it still remembers, and a completed job is remembered for an hour:
 * «дахин үүсгэх» pressed twice in that hour would leave the material PENDING
 * for ever. Two jobs for the same file are harmless — both draw the same pages.
 */
@Injectable()
export class MaterialPreviewQueue implements OnApplicationShutdown {
  private readonly env = loadEnv();

  private readonly connection: Redis = new IORedis(this.env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  private readonly queue = new Queue<MaterialPreviewJob>(MATERIAL_PREVIEW_QUEUE, {
    connection: this.connection,
    prefix: queuePrefix(this.env.NODE_ENV),
    defaultJobOptions: {
      // The processor records FAILED itself; a broken file fails the same way twice.
      attempts: 1,
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: { age: 24 * 3600 },
    },
  });

  async enqueue(job: MaterialPreviewJob): Promise<void> {
    await this.queue.add(MATERIAL_PREVIEW_QUEUE, job, {
      jobId: `${job.materialId}-${randomUUID()}`,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
  }
}
