import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../config/env";

export const REPORTS_QUEUE = "reports";

/**
 * ★ Namespaces every BullMQ key, so a test run and a running dev server cannot
 * share a queue.
 *
 * They otherwise do, and the failure is genuinely confusing: the test suite
 * enqueues a report, the developer's `pnpm dev` worker — same Redis, same
 * database — picks it up and generates a PDF, while the test *also* calls
 * `ReportGeneratorService.run()` directly. Two renders, two `MediaFile` rows,
 * and the idempotency test fails with "expected 2 to be 1" pointing at code
 * that is perfectly correct.
 *
 * It presents as flakiness (it depends on whether a dev server happens to be
 * running) which is the worst way for a real invariant to be reported. The
 * prefix removes the interference entirely rather than asking anyone to
 * remember.
 */
export function queuePrefix(nodeEnv: string): string {
  return nodeEnv === "test" ? "bull-test" : "bull";
}

/**
 * The producer side of the report queue.
 *
 * Split from the worker (`reports.worker.ts`) so that the API can enqueue
 * without ever running a job. That separation is what makes it a configuration
 * change rather than a rewrite when PDF generation needs its own container: a
 * 1 GB Chromium floor (`PDF_SPIKE.md` §3) is a poor reason to size every API
 * instance for it.
 */
@Injectable()
export class ReportsQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(ReportsQueue.name);
  private readonly env = loadEnv();

  private readonly connection: Redis = new IORedis(this.env.REDIS_URL, {
    // BullMQ requires this: it uses blocking commands, and a retry limit would
    // make a queue silently stop draining after a transient outage.
    maxRetriesPerRequest: null,
  });

  private readonly queue = new Queue(REPORTS_QUEUE, {
    connection: this.connection,
    prefix: queuePrefix(this.env.NODE_ENV),
    defaultJobOptions: {
      // Three attempts with backoff. Chromium failures are frequently
      // transient — a renderer killed under memory pressure succeeds on a
      // quieter retry.
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: { age: 24 * 3600 },
    },
  });

  /**
   * Queues one job.
   *
   * ★ The BullMQ job id is the `ReportJob` row id. That makes enqueueing
   * idempotent: a retry of the same row cannot produce two PDFs, because BullMQ
   * refuses a duplicate id while the job is still known.
   */
  async enqueue(reportJobId: string): Promise<void> {
    await this.queue.add(REPORTS_QUEUE, { reportJobId }, { jobId: reportJobId });
  }

  /** Diagnostic for the health endpoint. */
  async isReachable(): Promise<boolean> {
    try {
      await this.connection.ping();
      return true;
    } catch (error) {
      this.logger.warn(`Redis unreachable: ${(error as Error).message}`);
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    this.connection.disconnect();
  }
}
