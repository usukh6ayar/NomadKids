import { Module } from "@nestjs/common";
import { ArtworkComparisonController, ChildArtworkController } from "./artwork.controller";
import { ArtworkRepository } from "./artwork.repository";
import { ArtworkService } from "./artwork.service";

@Module({
  controllers: [ChildArtworkController, ArtworkComparisonController],
  providers: [ArtworkService, ArtworkRepository],
  exports: [ArtworkService, ArtworkRepository],
})
export class ArtworkModule {}
