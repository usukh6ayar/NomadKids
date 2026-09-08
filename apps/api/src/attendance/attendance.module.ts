import { Module } from "@nestjs/common";
import {
  AttendanceRequestController,
  ChildAttendanceController,
  ChildAttendanceRequestController,
  GroupAttendanceController,
  KindergartenAttendanceController,
} from "./attendance.controller";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";
import { EsisModule } from "../integrations/esis/esis.module";

@Module({
  imports: [EsisModule],
  controllers: [
    ChildAttendanceController,
    ChildAttendanceRequestController,
    AttendanceRequestController,
    GroupAttendanceController,
    KindergartenAttendanceController,
  ],
  providers: [AttendanceService, AttendanceRepository],
  exports: [AttendanceService, AttendanceRepository],
})
export class AttendanceModule {}
