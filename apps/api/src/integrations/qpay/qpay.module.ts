import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { AccessModule } from "../../access/access.module";
import { ChildAccessQpayController, QpayCallbackController } from "./qpay.controller";
import { QpayClient } from "./qpay.client";
import { QpayConfig } from "./qpay.config";
import { QpayRepository } from "./qpay.repository";
import { QpayService } from "./qpay.service";

/**
 * The QPay integration boundary — нэмэлт.md §8.
 *
 * ★ Imports `InvoicesModule` rather than importing `InvoicesRepository`
 * bare: repositories are provided by their own feature module (which also
 * exports them), the same way `EsisModule` provides `EsisClient` for anyone
 * who needs ESIS rather than each caller constructing one.
 */
@Module({
  imports: [AccessModule],
  controllers: [ChildAccessQpayController, QpayCallbackController],
  providers: [
    // A factory, same reason as `EsisModule`: `QpayConfig` takes the parsed
    // `Env`, which is a type rather than a provider, and reading it here means
    // a malformed QPay setting stops the process at boot.
    { provide: QpayConfig, useFactory: () => new QpayConfig(loadEnv()) },
    QpayClient,
    QpayRepository,
    QpayService,
  ],
  exports: [QpayService, QpayConfig],
})
export class QpayModule {}
