import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { ChildRoutineController, GroupRoutineController } from "./routine.controller";
import { RoutineRepository } from "./routine.repository";
import { RoutineService } from "./routine.service";

@Module({
  imports: [MediaModule],
  controllers: [GroupRoutineController, ChildRoutineController],
  providers: [RoutineService, RoutineRepository],
})
export class RoutineModule {}
