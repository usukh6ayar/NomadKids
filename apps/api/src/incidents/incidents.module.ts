import { Module } from "@nestjs/common";
import {
  ChildIncidentsController,
  IncidentsController,
  KindergartenIncidentsController,
} from "./incidents.controller";
import { IncidentsRepository } from "./incidents.repository";
import { IncidentsService } from "./incidents.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  // Reporting an incident to a family goes through the notice machinery, which
  // already owns delivery and read receipts — RFP Module 2.1 asks for both.
  imports: [NotificationsModule],
  controllers: [ChildIncidentsController, KindergartenIncidentsController, IncidentsController],
  providers: [IncidentsService, IncidentsRepository],
  exports: [IncidentsService, IncidentsRepository],
})
export class IncidentsModule {}
