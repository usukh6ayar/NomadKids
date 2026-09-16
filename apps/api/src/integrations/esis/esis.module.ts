import { Module } from "@nestjs/common";
import { AuthzModule } from "../../authz/authz.module";
import { loadEnv } from "../../config/env";
import { EsisClient } from "./esis.client";
import { EsisConfig } from "./esis.config";
import { EsisService } from "./esis.service";
import { EsisAdminService } from "./esis-admin.service";
import { EsisRepository } from "./esis.repository";
import { KindergartenEsisController, PlatformEsisController } from "./esis.controller";

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
  controllers: [KindergartenEsisController, PlatformEsisController],
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
    EsisRepository,
  ],
  /*
   * ★ `EsisRepository` exported 2026-09-16 for `StaffRegistrationModule` —
   * `POST /v1/staff-registration` reads `EsisStaffRoster` through it, the one
   * ESIS-derived table a public route may touch (see the repository method's
   * doc comment). Nothing else outside this module needs it yet.
   */
  exports: [EsisService, EsisConfig, EsisRepository],
})
export class EsisModule {}
