import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../config/env";
import { queuePrefix } from "../reports/reports.queue";
import { MaterialPreviewProcessor } from "./material-preview.processor";
import { MATERIAL_PREVIEW_QUEUE, type MaterialPreviewJob } from "./material-preview.queue";

/**
 * The consumer side of the sample-page queue.
 *
 * ★ Gated on `REPORTS_WORKER_ENABLED`, as `ChatVideoWorker` is: LibreOffice and
 * poppler run in the 2 GB `reports-worker`, never in a 512 MB `api` replica.
 * Off in tests, which call `MaterialPreviewProcessor.run()` directly.
 *
 * Concurrency 1: a LibreOffice conversion beside a Chromium render is as much
 * as the container should hold at once.
 */
@Injectable()
export class MaterialPreviewWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MaterialPreviewWorker.name);
  private readonly env = loadEnv();
  private worker: Worker | null = null;
  private connection: Redis | null = null;

  constructor(private readonly processor: MaterialPreviewProcessor) {}

  onModuleInit(): void {
    if (!this.env.REPORTS_WORKER_ENABLED) return;

    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<MaterialPreviewJob>(
      MATERIAL_PREVIEW_QUEUE,
      async (job) => this.processor.run(job.data),
      {
        connection: this.connection,
        prefix: queuePrefix(this.env.NODE_ENV),
        concurrency: 1,
        // A first LibreOffice start can run past BullMQ's 30 s default lock.
        lockDuration: 5 * 60_000,
      },
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error(`Material preview ${job?.data?.materialId ?? "?"} failed`, error);
    });
    this.logger.log("Material preview worker started");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    this.connection?.disconnect();
  }
}
