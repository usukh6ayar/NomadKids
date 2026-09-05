import { Module } from "@nestjs/common";
import { StaffController, StaffRecordsController } from "./staff.controller";
import { StaffRepository } from "./staff.repository";
import { StaffService } from "./staff.service";

@Module({
  controllers: [StaffController, StaffRecordsController],
  providers: [StaffService, StaffRepository],
})
export class StaffModule {}
