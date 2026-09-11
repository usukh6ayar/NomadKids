import { Injectable, Logger } from "@nestjs/common";
import { ReportRetentionService } from "../reports/report-retention.service";
import { MaintenanceRepository } from "./maintenance.repository";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long operational records survive past their usefulness. */
export const RETENTION = {
  /** Long enough to investigate a brute-force attempt; AuditLog keeps it forever. */
  loginAttempts: 30 * DAY_MS,
  /** A revoked session must outlive its refresh token for reuse detection. */
  sessions: 7 * DAY_MS,
  /**
   * How long a notice stays on the board — the client, 2026-09-11.
   *
   * ★ The one entry here that is not an operational record. It is measured
   * from `publishedAt` and skips anything the author marked important, so
   * "seven days" is the default life of a notice rather than a ceiling on all
   * of them. `MaintenanceRepository.retireNotifications` has the reasoning.
   */
  notifications: 7 * DAY_MS,
} as const;

/**
 * Periodic cleanup.
 *
 * Driven by a BullMQ repeatable job in production (`MaintenanceScheduler`) and
 * callable directly from tests. Written before the queue existed because
 * `LoginAttempt` is scanned on every login and an unbounded table degrades the
 * exact endpoint under attack.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly repo: MaintenanceRepository,
    private readonly reportRetention: ReportRetentionService,
  ) {}

  async runCleanup(now = new Date()): Promise<CleanupResult> {
    const result = {
      loginAttempts: await this.repo.pruneLoginAttempts(
        new Date(now.getTime() - RETENTION.loginAttempts),
      ),
      authTokens: await this.repo.pruneAuthTokens(now),
      sessions: await this.repo.pruneSessions(new Date(now.getTime() - RETENTION.sessions)),
      // ★ Generated PDFs are copies of a child's record living outside the
      // permission system that produced them. They expire.
      reportFiles: (await this.reportRetention.sweep(now)).removed,
      // And jobs the queue never picked up get another chance, rather than
      // leaving a client polling something nobody is working on.
      reportsRequeued: (await this.reportRetention.requeueStale(now)).requeued,
      // ★ Soft, unlike everything above it — see the repository.
      notifications: await this.repo.retireNotifications(
        new Date(now.getTime() - RETENTION.notifications),
      ),
    };

    this.logger.log(
      `Cleanup: ${result.loginAttempts} login attempts, ` +
        `${result.authTokens} auth tokens, ${result.sessions} sessions, ` +
        `${result.reportFiles} report files, ${result.reportsRequeued} jobs requeued, ` +
        `${result.notifications} notices retired`,
    );
    return result;
  }
}

export interface CleanupResult {
  loginAttempts: number;
  authTokens: number;
  sessions: number;
  reportFiles: number;
  reportsRequeued: number;
  /** Notices soft-deleted a week after publication. */
  notifications: number;
}
