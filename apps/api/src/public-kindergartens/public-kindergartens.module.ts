import { Module } from "@nestjs/common";
import { PublicKindergartensController } from "./public-kindergartens.controller";
import { PublicKindergartensRepository } from "./public-kindergartens.repository";
import { PublicKindergartensService } from "./public-kindergartens.service";

/** The contracted kindergartens a stranger may see — #211. */
@Module({
  controllers: [PublicKindergartensController],
  providers: [PublicKindergartensService, PublicKindergartensRepository],
  exports: [PublicKindergartensService],
})
export class PublicKindergartensModule {}
