import { Module } from "@nestjs/common";
import { ChildMilestonesController, MilestonesController } from "./milestones.controller";
import { MilestonesRepository } from "./milestones.repository";
import { MilestonesService } from "./milestones.service";

@Module({
  controllers: [ChildMilestonesController, MilestonesController],
  providers: [MilestonesService, MilestonesRepository],
  exports: [MilestonesService, MilestonesRepository],
})
export class MilestonesModule {}
