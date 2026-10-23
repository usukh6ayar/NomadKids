import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { OfficialDocumentsController } from "./official-documents.controller";
import { OfficialDocumentsRepository } from "./official-documents.repository";
import { OfficialDocumentsService } from "./official-documents.service";

@Module({
  imports: [AuditModule],
  controllers: [OfficialDocumentsController],
  providers: [OfficialDocumentsService, OfficialDocumentsRepository],
})
export class OfficialDocumentsModule {}
