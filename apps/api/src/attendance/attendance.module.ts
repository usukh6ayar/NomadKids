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

@Module({
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
