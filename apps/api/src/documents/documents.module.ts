import { Module } from "@nestjs/common";
import { DocumentsController, KindergartenDocumentsController } from "./documents.controller";
import { DocumentsRepository } from "./documents.repository";
import { DocumentsService } from "./documents.service";
import { MediaModule } from "../media/media.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  // `MediaRepository` creates the MediaFile rows; the bytes go to R2 through
  // StorageService. Both are the same paths every other upload uses.
  imports: [MediaModule, StorageModule],
  controllers: [KindergartenDocumentsController, DocumentsController],
  providers: [DocumentsService, DocumentsRepository],
  exports: [DocumentsService, DocumentsRepository],
})
export class DocumentsModule {}
