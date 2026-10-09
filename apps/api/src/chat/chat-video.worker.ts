import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../config/env";
import { queuePrefix } from "../reports/reports.queue";
import { ChatVideoProcessor } from "./chat-video.processor";
import { CHAT_VIDEO_QUEUE } from "./chat-video.queue";

/**
 * The consumer side of the chat video queue.
 *
 * ★ Gated on `REPORTS_WORKER_ENABLED`, because that flag already means "this is
 * the slow-work container": `reports-worker` has 2 GB and ffmpeg, the `api`
 * replicas have 512 MB and must not transcode. Off in tests, which call
 * `ChatVideoProcessor.run()` directly.
 *
 * Concurrency 1: one encode at two threads leaves the other cores to the API,
 * Postgres and a report render.
 */
@Injectable()
export class ChatVideoWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ChatVideoWorker.name);
  private readonly env = loadEnv();
  private worker: Worker | null = null;
  private connection: Redis | null = null;

  constructor(private readonly processor: ChatVideoProcessor) {}

  onModuleInit(): void {
    if (!this.env.REPORTS_WORKER_ENABLED) return;

    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<{ mediaId: string }>(
      CHAT_VIDEO_QUEUE,
      async (job) => this.processor.run(job.data.mediaId),
      {
        connection: this.connection,
        prefix: queuePrefix(this.env.NODE_ENV),
        concurrency: 1,
        // An encode of three minutes can run past BullMQ's 30 s default lock.
        lockDuration: 5 * 60_000,
      },
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error(`Chat video ${job?.data?.mediaId ?? "?"} failed in the queue`, error);
    });
    this.logger.log("Chat video worker started");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    this.connection?.disconnect();
  }
}
