import { Module } from "@nestjs/common";
import {
  AttendanceRequestController,
  ChildAttendanceController,
  ChildAttendanceRequestController,
  GroupAttendanceController,
} from "./attendance.controller";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";

@Module({
  controllers: [
    ChildAttendanceController,
    ChildAttendanceRequestController,
    AttendanceRequestController,
    GroupAttendanceController,
  ],
  providers: [AttendanceService, AttendanceRepository],
  exports: [AttendanceService, AttendanceRepository],
})
export class AttendanceModule {}
