import { Module } from "@nestjs/common";
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
  exports: [EsisService, EsisConfig],
})
export class EsisModule {}
