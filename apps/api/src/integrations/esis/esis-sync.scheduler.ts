import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../../config/env";
import { queuePrefix } from "../../reports/reports.queue";
import { EsisRepository } from "./esis.repository";
import { EsisSyncService } from "./esis-sync.service";

const ESIS_SYNC_QUEUE = "esis-sync";
const ROSTER_JOB_NAME = "esis-roster-sync";
const REFERENCE_JOB_NAME = "esis-reference-sync";

/** One kindergarten's mapping state, as `EsisRepository.findKindergartensWithEsisMapping` reads it. */
export interface EsisSchedulableKindergarten {
  id: string;
  esisInstitutionId: string | null;
  deletedAt: Date | null;
}

/**
 * Which kindergartens a scheduled ESIS sweep runs against.
 *
 * ★ This is the part of the scheduler that has an actual decision in it, so
 * it is the part with a unit test (`esis-sync.scheduler.test.ts`) — the
 * scheduler around it needs Redis and a Nest module, which is exactly why
 * `MaintenanceScheduler`, the file this one copies, has no test of its own
 * either.
 *
 * No actor parameter: there isn't one. A nightly or monthly sweep runs
 * unattended, so the selection cannot depend on anything a request would
 * normally supply — see `EsisRepository.findKindergartensWithEsisMapping`'s
 * doc comment for why that query is unscoped rather than tenant-filtered.
 *
 * Re-checks `esisInstitutionId` and `deletedAt` even though the repository
 * query already filters on both (CLAUDE.md §2.2's base filter) — see that
 * method's doc comment for why the decision is asserted twice on purpose.
 *
 * Sorted, so the result does not depend on the order rows came back in —
 * `findKindergartensWithEsisMapping` already orders by id, but a pure
 * function's own contract should not rely on its caller having done that.
 */
export function selectEsisSyncTargets(
  kindergartens: EsisSchedulableKindergarten[],
): { id: string }[] {
  return kindergartens
    .filter(
      (kindergarten) => kindergarten.esisInstitutionId !== null && kindergarten.deletedAt === null,
    )
    .map((kindergarten) => ({ id: kindergarten.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Runs the two ESIS tiers on a schedule.
 *
 * A BullMQ **repeatable** job, not `setInterval`, for the same two reasons
 * `MaintenanceScheduler` (`../../maintenance/maintenance.scheduler.ts`) gives
 * for the nightly cleanup — this file follows its structure rather than
 * re-deriving the argument:
 *
 *  1. With more than one API instance, `setInterval` would run a sweep on
 *     every kindergarten N times concurrently. `runReferenceSync` and
 *     `runRosterSync` each take a per-kindergarten run lock, so the
 *     duplicate attempts would not corrupt anything — but they would burn
 *     the deployment's one rate-limited ESIS token on calls that only
 *     `ConflictException` out, during a ministry trial where every call is
 *     watched.
 *  2. A repeatable job's schedule lives in Redis, so a container restart at
 *     03:40 or on the 1st at 04:10 does not skip that run.
 *
 * Gated on `REPORTS_WORKER_ENABLED`, the same flag `MaintenanceScheduler`
 * uses, for the same reason its comment gives: an instance that does not
 * process background work should not schedule it either.
 *
 * ★ Neither job lands on `MaintenanceScheduler`'s 03:20 — two heavy jobs at
 * the same minute on the same instance is a self-inflicted contention
 * problem, and picking a different minute avoids it for free.
 */
@Injectable()
export class EsisSyncScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EsisSyncScheduler.name);
  private readonly env = loadEnv();
  private connection: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly repo: EsisRepository,
    private readonly sync: EsisSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.REPORTS_WORKER_ENABLED) return;

    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    const prefix = queuePrefix(this.env.NODE_ENV);

    this.queue = new Queue(ESIS_SYNC_QUEUE, { connection: this.connection, prefix });
    this.worker = new Worker(ESIS_SYNC_QUEUE, async (job) => this.runTier(job.name), {
      connection: this.connection,
      prefix,
      concurrency: 1,
    });

    try {
      // 03:40 — after the nightly cleanup's 03:20 (MaintenanceScheduler) and
      // well clear of the reference sweep's monthly slot below.
      await this.queue.upsertJobScheduler(
        ROSTER_JOB_NAME,
        { pattern: "40 3 * * *" },
        { name: ROSTER_JOB_NAME },
      );
      // 04:10 on the 1st — monthly, tier 1's reference sweep. Also clear of
      // 03:20 and 03:40, and rare enough that sharing a night with the daily
      // jobs once a month is not worth a fourth time slot.
      await this.queue.upsertJobScheduler(
        REFERENCE_JOB_NAME,
        { pattern: "10 4 1 * *" },
        { name: REFERENCE_JOB_NAME },
      );
      this.logger.log("ESIS roster and reference sync scheduled");
    } catch (error) {
      // A Redis outage at boot must not stop the API serving requests. The
      // schedule is re-asserted on the next start.
      this.logger.error("Could not schedule the ESIS sync jobs", error as Error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }

  /**
   * One scheduled run: pick the targets, sweep every one, and let one
   * kindergarten's failure be that kindergarten's problem.
   *
   * ★ `runReferenceSync` and `runRosterSync` already write a `FAILED` run
   * row and throw on an unrecoverable error (e.g. the deployment has no ESIS
   * token). Catching per kindergarten here is what keeps that from also
   * cancelling every kindergarten queued after it — the same reasoning
   * `runReferenceSync` gives for using `Promise.allSettled` across resources
   * within one sweep, one level up: across kindergartens within one tier.
   *
   * ★★ The job name is matched explicitly against both known names, not
   * `if (roster) … else reference`. This queue carries the ministry's most
   * expensive tier — thirteen resources per mapped kindergarten, against a
   * token the ministry is watching during a one-month trial — so a stray or
   * renamed job landing here must not silently fall through to running it.
   */
  private async runTier(jobName: string): Promise<void> {
    if (jobName !== ROSTER_JOB_NAME && jobName !== REFERENCE_JOB_NAME) {
      this.logger.warn(`Unknown ESIS sync job "${jobName}"; nothing run`);
      return;
    }

    const targets = selectEsisSyncTargets(await this.repo.findKindergartensWithEsisMapping());

    for (const target of targets) {
      try {
        if (jobName === ROSTER_JOB_NAME) {
          await this.sync.runRosterSync({ kindergartenId: target.id, actorUserId: null });
        } else {
          await this.sync.runReferenceSync({ kindergartenId: target.id, actorUserId: null });
        }
      } catch (error) {
        this.logger.error(`ESIS ${jobName} failed for kindergarten ${target.id}`, error as Error);
      }
    }
  }
}
