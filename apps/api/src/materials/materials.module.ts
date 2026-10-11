import { Module } from "@nestjs/common";
import { QpayModule } from "../integrations/qpay/qpay.module";
import { StorageModule } from "../storage/storage.module";
import {
  MaterialsController,
  OwnMaterialsController,
  PlatformMaterialsController,
} from "./materials.controller";
import { MaterialsRepository } from "./materials.repository";
import { MaterialsService } from "./materials.service";

@Module({
  imports: [QpayModule, StorageModule],
  controllers: [MaterialsController, OwnMaterialsController, PlatformMaterialsController],
  providers: [MaterialsService, MaterialsRepository],
})
export class MaterialsModule {}
