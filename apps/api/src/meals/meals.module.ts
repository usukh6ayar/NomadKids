import { Module } from "@nestjs/common";
import { ChildMealsController, GroupMealsController, MealsController } from "./meals.controller";
import { MealsRepository } from "./meals.repository";
import { MealsService } from "./meals.service";
import { HealthRecordsModule } from "../health-records/health-records.module";
import { KitchenModule } from "../kitchen/kitchen.module";
import { MediaModule } from "../media/media.module";

@Module({
  imports: [
    // For the allergy cross-check — RFP Module 2's automatic menu warning.
    HealthRecordsModule,
    // For resolving a menu dish's технологийн карт (name/allergens/nutrition)
    // at save time, and for writing the stock ledger on `.../consume`.
    KitchenModule,
    // For verifying a dish's photoMediaFileId is a real MENU_DISH upload from
    // this kindergarten, not a guessed id — see `MediaService.isMenuDishPhoto`.
    MediaModule,
  ],
  controllers: [MealsController, GroupMealsController, ChildMealsController],
  providers: [MealsService, MealsRepository],
  exports: [MealsService, MealsRepository],
})
export class MealsModule {}
