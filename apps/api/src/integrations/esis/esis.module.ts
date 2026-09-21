import { Module } from "@nestjs/common";
import { AuthzModule } from "../../authz/authz.module";
import { loadEnv } from "../../config/env";
import { EsisClient } from "./esis.client";
import { EsisConfig } from "./esis.config";
import { EsisService } from "./esis.service";
import { EsisAdminService } from "./esis-admin.service";
import { EsisSyncService } from "./esis-sync.service";
import { EsisSyncScheduler } from "./esis-sync.scheduler";
import { EsisRepository } from "./esis.repository";
import { EsisCoverageService } from "./esis-coverage.service";
import { EsisWriteRepository } from "./esis-write.repository";
import { EsisWriteRequestService } from "./esis-write.service";
import { EsisWriteSender } from "./esis-write.sender";
import { EsisWriteQueue, EsisWriteWorker } from "./esis-write.worker";
import { EsisInstitutionLookupService } from "./esis-institution-lookup.service";
import {
  KindergartenEsisController,
  PlatformEsisController,
  PlatformEsisInstitutionController,
} from "./esis.controller";

/**
 * The ESIS integration boundary.
 *
 * ★ Not `@Global()`, unlike `MailModule`.
 *
 * Mail is global because two unrelated features send the one message it has.
 * Nothing consumes ESIS yet, and when something does it should say so by
 * importing this module — an integration that any file can reach without
 * declaring it is one whose blast radius nobody can measure.
 */
@Module({
  /*
   * ★ `AuthzModule` — imported 2026-09-15 for `ChildAccessService`.
   *
   * A per-child ESIS read is gated by `canAccessChild`, the same rule every
   * other child route uses (CLAUDE.md §1.1). Importing the module is how this
   * one says it reaches child data, which the note below asks of anything that
   * consumes an integration.
   */
  imports: [AuthzModule],
  controllers: [
    KindergartenEsisController,
    PlatformEsisController,
    PlatformEsisInstitutionController,
  ],
  providers: [
    /*
     * A factory, because `EsisConfig` takes the parsed `Env` and that is a
     * type rather than a provider. Reading the environment here — once, at
     * module construction — also means a malformed ESIS setting stops the
     * process at boot rather than on the first call.
     */
    { provide: EsisConfig, useFactory: () => new EsisConfig(loadEnv()) },
    EsisClient,
    EsisService,
    EsisAdminService,
    /*
     * ★ `EsisSyncService` — added 2026-09-16 for tier 1's reference sweep
     * (plan Task 3). Registered here, not exported: Task 5's route and Task
     * 8's scheduler both live inside this module, so nothing outside it needs
     * to reach a sweep directly.
     */
    EsisSyncService,
    /*
     * ★ `EsisSyncScheduler` — added 2026-09-17, plan Task 8. The two
     * repeatable jobs that drive tiers 1 and 2 without an admin pulling
     * either by hand; see the class's own doc comment for the schedule and
     * why it copies `MaintenanceScheduler`'s structure. Not exported: it has
     * no methods anything outside this module would call.
     */
    EsisSyncScheduler,
    EsisRepository,
    /*
     * ★ The write harness — spec №3б. `EsisWriteQueue` and `EsisWriteWorker`
     * are two providers rather than one because the service depends on "a
     * thing that enqueues" and not on Redis: that is what lets a test replace
     * `add` and assert that approving enqueues exactly one job, which is the
     * assertion this whole design turns on.
     */
    EsisWriteRepository,
    EsisWriteRequestService,
    /*
     * ★ The 84/84 matrix — spec `2026-09-15-esis-full-coverage-design` §7. It
     * reads `AuditLog` and `EsisSyncRun` and never ESIS itself, so it carries
     * no client dependency at all.
     */
    EsisCoverageService,
    EsisWriteSender,
    EsisWriteQueue,
    EsisWriteWorker,
    /*
     * ★ The institution lookup behind `POST /platform/kindergartens` — it is
     * asked *before* a kindergarten row exists, so unlike every other service
     * here it takes an ESIS institution id rather than a tenant. Exported
     * because the onboarding service that creates the kindergarten lives in
     * another module and injects it.
     */
    EsisInstitutionLookupService,
  ],
  /*
   * ★ `EsisRepository` exported 2026-09-16 for `StaffRegistrationModule` —
   * `POST /v1/staff-registration` reads `EsisStaffRoster` through it, the one
   * ESIS-derived table a public route may touch (see the repository method's
   * doc comment). Nothing else outside this module needs it yet.
   */
  exports: [EsisService, EsisConfig, EsisRepository, EsisInstitutionLookupService],
})
export class EsisModule {}
