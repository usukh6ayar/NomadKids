import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../config/env";
import { checkCyrillicFont, bundledFontDir } from "./font-check";
import { ReportGeneratorService } from "./report-generator.service";
import { queuePrefix, REPORTS_QUEUE } from "./reports.queue";

/**
 * The consumer side of the report queue.
 *
 * Runs in-process by default — one container is the right shape for a
 * kindergarten's volume, and a separate worker deployment is operational
 * overhead nobody is paid to watch. `REPORTS_WORKER_ENABLED=false` turns it off
 * per instance, which is how it splits out later without a code change.
 *
 * ★ Concurrency is 1, deliberately. Each job holds a Chromium page, and the
 * spike measured a 512 MB floor for **one** render. Two concurrent renders on a
 * 1 GB instance is an OOM kill, and the symptom — `Target closed` — reads like
 * a Puppeteer bug rather than a capacity problem.
 */
@Injectable()
export class ReportsWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReportsWorker.name);
  private readonly env = loadEnv();
  private worker: Worker | null = null;
  private connection: Redis | null = null;

  constructor(private readonly generator: ReportGeneratorService) {}

  onModuleInit(): void {
    if (!this.env.REPORTS_WORKER_ENABLED) {
      this.logger.log("Report worker disabled (REPORTS_WORKER_ENABLED=false)");
      return;
    }

    // ★ The boot assertion. A container that would render blank PDFs must not
    // accept jobs — `font-check.ts` explains why this is fatal rather than a
    // warning. It runs here, in the worker, because the API instance that only
    // enqueues has no need of a font.
    const font = checkCyrillicFont(bundledFontDir());
    if (!font.ok) {
      throw new Error(
        `Refusing to start the report worker: ${font.detail}\n` +
          "Set REPORTS_WORKER_ENABLED=false to run this instance as API-only.",
      );
    }
    this.logger.log(`Font check passed: ${font.detail}`);

    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });

    this.worker = new Worker<{ reportJobId: string }>(
      REPORTS_QUEUE,
      // `rethrow: true` — a failure must reject, or BullMQ records the job as
      // successful and `attempts: 3` never fires.
      async (job) => this.generator.run(job.data.reportJobId, true),
      {
        connection: this.connection,
        // Must match the producer's prefix, or the worker watches a queue
        // nothing writes to — see `queuePrefix`.
        prefix: queuePrefix(this.env.NODE_ENV),
        concurrency: 1,
      },
    );

    // `run()` records its own failures on the row and resolves, so reaching
    // here means the failure was outside it — Redis, or the process. The row
    // would otherwise sit at RUNNING for ever with nobody to tell the user.
    this.worker.on("failed", (job, error) => {
      this.logger.error(`Report job ${job?.data?.reportJobId ?? "?"} failed in the queue`, error);
    });

    this.logger.log("Report worker started");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    this.connection?.disconnect();
  }
}
