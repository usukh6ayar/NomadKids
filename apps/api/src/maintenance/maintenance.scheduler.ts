import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../config/env";
import { queuePrefix } from "../reports/reports.queue";
import { MaintenanceService } from "./maintenance.service";

const MAINTENANCE_QUEUE = "maintenance";
const JOB_NAME = "nightly-cleanup";

/**
 * Runs the cleanup on a schedule.
 *
 * A BullMQ **repeatable** job rather than `setInterval`, for two reasons that
 * only show up in production:
 *
 *  1. With more than one instance, `setInterval` runs the sweep N times
 *     concurrently. The deletes are idempotent, but they contend on the same
 *     rows and the log becomes unreadable.
 *  2. A repeatable job's schedule lives in Redis, so a container restart at
 *     03:59 does not skip that night's run.
 *
 * Gated on the same flag as the report worker: an instance that does not
 * process background work does not schedule it either.
 */
@Injectable()
export class MaintenanceScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceScheduler.name);
  private readonly env = loadEnv();
  private connection: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly maintenance: MaintenanceService) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.REPORTS_WORKER_ENABLED) return;

    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    const prefix = queuePrefix(this.env.NODE_ENV);

    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.connection, prefix });
    this.worker = new Worker(MAINTENANCE_QUEUE, async () => this.maintenance.runCleanup(), {
      connection: this.connection,
      prefix,
      concurrency: 1,
    });

    try {
      // 03:20 — quiet, and far enough from midnight that a daily backup running
      // at 03:00 has finished.
      await this.queue.upsertJobScheduler(JOB_NAME, { pattern: "20 3 * * *" });
      this.logger.log("Nightly cleanup scheduled");
    } catch (error) {
      // A Redis outage at boot must not stop the API serving requests. The
      // schedule is re-asserted on the next start.
      this.logger.error("Could not schedule the nightly cleanup", error as Error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }
}
