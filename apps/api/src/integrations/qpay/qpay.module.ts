import { Module } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { QpayClient } from "./qpay.client";
import { QpayConfig } from "./qpay.config";
import { QpayService } from "./qpay.service";

/**
 * The QPay integration boundary — `нэмэлт.md` §8.
 *
 * ★ Not `@Global()`, for the reason `EsisModule` gives: a module that consumes
 * a payment provider should have to say so by importing it. Today that is
 * `InvoicesModule` and nothing else.
 *
 * ★★ `QpayClient` is a **singleton holding a cached bearer token**, which is
 * the default Nest provider scope and is load-bearing here rather than
 * incidental. A request-scoped client would fetch a fresh token for every
 * call — hammering `/auth/token` and defeating the caching QPay's own
 * integration note asks for. Do not add `Scope.REQUEST` to it.
 */
@Module({
  providers: [
    // A factory, because `QpayConfig` takes the parsed `Env`, which is a type
    // rather than a provider. Reading the environment here — once, at module
    // construction — also means a malformed QPay setting stops the process at
    // boot rather than at the first payment.
    { provide: QpayConfig, useFactory: () => new QpayConfig(loadEnv()) },
    QpayClient,
    QpayService,
  ],
  exports: [QpayService, QpayConfig],
})
export class QpayModule {}
