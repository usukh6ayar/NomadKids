import { Module } from "@nestjs/common";
import { ChildAccessFeeController } from "./access.controller";
import { AccessRepository } from "./access.repository";
import { AccessService } from "./access.service";

/**
 * Portal access subscriptions — the only thing QPay charges for.
 *
 * Exported so `QpayModule` can settle one; it imports this rather than the
 * other way round, the same direction `InvoicesModule` and `QpayModule`
 * already run in.
 */
@Module({
  controllers: [ChildAccessFeeController],
  providers: [AccessService, AccessRepository],
  exports: [AccessService],
})
export class AccessModule {}
