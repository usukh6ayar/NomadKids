import { Module } from "@nestjs/common";
import { ChildMediaController, MediaController } from "./media.controller";
import { MediaRepository } from "./media.repository";
import { MediaService } from "./media.service";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [StorageModule],
  controllers: [ChildMediaController, MediaController],
  providers: [MediaService, MediaRepository],
  exports: [MediaService, MediaRepository],
})
export class MediaModule {}
