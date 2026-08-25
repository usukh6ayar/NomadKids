import { Module } from "@nestjs/common";
import { ChildConsentController } from "./consent.controller";
import { ConsentRepository } from "./consent.repository";
import { ConsentService } from "./consent.service";

@Module({
  controllers: [ChildConsentController],
  providers: [ConsentService, ConsentRepository],
  exports: [ConsentService, ConsentRepository],
})
export class ConsentModule {}
