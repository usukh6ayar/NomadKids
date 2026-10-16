import { Module } from "@nestjs/common";
import { QpayModule } from "../integrations/qpay/qpay.module";
import { StorageModule } from "../storage/storage.module";
import {
  MaterialsController,
  OwnMaterialsController,
  PlatformMaterialsController,
  PublicMaterialsController,
} from "./materials.controller";
import { MaterialPreviewProcessor } from "./material-preview.processor";
import { MaterialPreviewQueue } from "./material-preview.queue";
import { MaterialPreviewWorker } from "./material-preview.worker";
import { MaterialsRepository } from "./materials.repository";
import { MaterialsService } from "./materials.service";

@Module({
  imports: [QpayModule, StorageModule],
  controllers: [
    MaterialsController,
    PublicMaterialsController,
    OwnMaterialsController,
    PlatformMaterialsController,
  ],
  providers: [
    MaterialsService,
    MaterialsRepository,
    MaterialPreviewQueue,
    MaterialPreviewProcessor,
    MaterialPreviewWorker,
  ],
})
export class MaterialsModule {}
