import { Module } from "@nestjs/common";
import {
  KindergartenNotificationsController,
  NotificationsController,
} from "./notifications.controller";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationsService } from "./notifications.service";

@Module({
  controllers: [NotificationsController, KindergartenNotificationsController],
  providers: [NotificationsService, NotificationsRepository],
  exports: [NotificationsService, NotificationsRepository],
})
export class NotificationsModule {}
