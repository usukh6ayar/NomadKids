import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../../config/env";
import { queuePrefix } from "../../reports/reports.queue";
import { QpayService } from "./qpay.service";

const QPAY_SWEEP_QUEUE = "qpay-sweep";
const JOB_NAME = "qpay-sweep";

/**
 * Runs `QpayService.sweepUnsettled` every ten minutes — the money a family
 * paid with no callback reaching us is credited without anyone calling the
 * operator.
 *
 * A BullMQ repeatable job for `MaintenanceScheduler`'s reasons: one run
 * however many instances, and the schedule survives a restart. Gated on the
 * same flag, so only `reports-worker` sweeps; with QPay not configured the
 * sweep itself does nothing.
 */
@Injectable()
export class QpaySweepScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QpaySweepScheduler.name);
  private readonly env = loadEnv();
  private connection: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly qpay: QpayService) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.REPORTS_WORKER_ENABLED || !this.qpay.isConfigured) return;

    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    const prefix = queuePrefix(this.env.NODE_ENV);

    this.queue = new Queue(QPAY_SWEEP_QUEUE, { connection: this.connection, prefix });
    this.worker = new Worker(QPAY_SWEEP_QUEUE, async () => this.qpay.sweepUnsettled(), {
      connection: this.connection,
      prefix,
      concurrency: 1,
    });

    try {
      await this.queue.upsertJobScheduler(JOB_NAME, { pattern: "*/10 * * * *" });
      this.logger.log("QPay sweep scheduled");
    } catch (error) {
      // A Redis outage at boot must not stop the worker. Re-asserted next start.
      this.logger.error("Could not schedule the QPay sweep", error as Error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }
}
