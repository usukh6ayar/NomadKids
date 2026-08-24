import { Module } from "@nestjs/common";
import { MealsController } from "./meals.controller";
import { MealsRepository } from "./meals.repository";
import { MealsService } from "./meals.service";

@Module({
  controllers: [MealsController],
  providers: [MealsService, MealsRepository],
  exports: [MealsService, MealsRepository],
})
export class MealsModule {}
