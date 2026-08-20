import { Module } from "@nestjs/common";
import {
  ChildMediaController,
  MediaController,
  NotificationMediaController,
} from "./media.controller";
import { MediaRepository } from "./media.repository";
import { MediaService } from "./media.service";
import { StorageModule } from "../storage/storage.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  // For `NotificationsService.isReadable` — a class-board photo is readable
  // exactly when its notice is, and that rule lives there.
  imports: [StorageModule, NotificationsModule],
  controllers: [ChildMediaController, MediaController, NotificationMediaController],
  providers: [MediaService, MediaRepository],
  exports: [MediaService, MediaRepository],
})
export class MediaModule {}
