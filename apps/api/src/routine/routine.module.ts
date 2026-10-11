import { Module } from "@nestjs/common";
import { ChildRoutineController, GroupRoutineController } from "./routine.controller";
import { RoutineRepository } from "./routine.repository";
import { RoutineService } from "./routine.service";

@Module({
  controllers: [GroupRoutineController, ChildRoutineController],
  providers: [RoutineService, RoutineRepository],
})
export class RoutineModule {}
