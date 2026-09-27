import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../../config/env";
import { queuePrefix } from "../../reports/reports.queue";
import { EsisWriteSender } from "./esis-write.sender";

export const ESIS_WRITE_QUEUE = "esis-write";
const JOB_NAME = "esis-write-send";

/**
 * The one way a prepared write reaches ESIS.
 *
 * ★ Its own class so `EsisWriteRequestService` can depend on "something that
 * enqueues" rather than on Redis, which is what lets an integration test
 * replace `add` and assert that approving enqueues **exactly one** job. A
 * service that constructed its own `Queue` would make that assertion
 * unwritable, and "approve posted twice" is the failure this whole design is
 * built around.
 */
@Injectable()
export class EsisWriteQueue implements OnApplicationShutdown {
  private connection?: Redis;
  private queue?: Queue;

  /**
   * ★ Connected on first use, not in the constructor.
   *
   * Every API process instantiates this provider and every `createTestApp()`
   * in the suite instantiates it 84 more times; connecting eagerly would open
   * that many Redis connections for a queue most of them never touch. The
   * worker already gates on its flag before reaching Redis, and this is the
   * producer side doing the same thing by a different route — the sync
   * scheduler's shape, not a second one.
   */
  private lazy() {
    if (!this.queue) {
      const env = loadEnv();
      this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
      this.queue = new Queue(ESIS_WRITE_QUEUE, {
        connection: this.connection,
        prefix: queuePrefix(env.NODE_ENV),
      });
    }
    return this.queue;
  }

  /**
   * ★ `jobId` is the request id, so BullMQ itself refuses a second job for a
   * write already queued. That is the outer of two guards; the inner one —
   * `EsisWriteSender`'s `sentAt` check — is the one that matters, because a job
   * id only lives as long as Redis keeps it and a row lives forever.
   *
   * ★★ `attempts: 1`. A retry against a service with no idempotency header is
   * how one approved group becomes two in the ministry's register. A failure
   * is left `FAILED` for a director to look at and prepare again.
   */
  async add(writeRequestId: string) {
    await this.lazy().add(JOB_NAME, { writeRequestId }, { jobId: writeRequestId, attempts: 1 });
  }

  async onApplicationShutdown() {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}

/**
 * Drains the queue, one write at a time.
 *
 * ★ `concurrency: 1` because the deployment has **one** rate-limited ESIS token
 * and this is a month the ministry is watching its logs.
 */
@Injectable()
export class EsisWriteWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EsisWriteWorker.name);
  private connection?: Redis;
  private worker?: Worker;

  constructor(private readonly sender: EsisWriteSender) {}

  onModuleInit() {
    const env = loadEnv();
    /*
     * ★ Its **own** flag, not `REPORTS_WORKER_ENABLED`.
     *
     * That flag means two things at once: "drain the report queue" and, by
     * implication, "this host has Chromium and a gigabyte of RAM" — CLAUDE.md
     * §6 says the report worker cannot run on Vercel for exactly that reason.
     * Gating ESIS writes on it would mean a deployment that turns reports off
     * silently stops writing to the ministry: approvals would queue, the
     * director would see APPROVED for ever, and nothing would log an error. An
     * ESIS write needs no browser and no memory.
     */
    if (env.ESIS_WRITE_WORKER_ENABLED !== true) {
      this.logger.log("ESIS write worker disabled");
      return;
    }
    this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      ESIS_WRITE_QUEUE,
      async (job) => this.sender.send(String(job.data.writeRequestId)),
      { connection: this.connection, prefix: queuePrefix(env.NODE_ENV), concurrency: 1 },
    );
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
