import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  listOfficialDocumentsQuerySchema,
  officialDocumentInputSchema,
  officialDocumentPatchSchema,
  type ListOfficialDocumentsQuery,
  type OfficialDocumentInput,
  type OfficialDocumentPatch,
} from "./official-documents.dto";
import { OfficialDocumentsService } from "./official-documents.service";

/**
 * The ministry register (№7). No `@Roles`: a superadmin holds no membership,
 * and the read is the staff of any kindergarten — the service asks
 * `PlatformAccessService`, the one place that decides.
 */
@Controller("official-documents")
export class OfficialDocumentsController {
  constructor(private readonly service: OfficialDocumentsService) {}

  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listOfficialDocumentsQuerySchema))
    query: ListOfficialDocumentsQuery,
  ) {
    return this.service.list(actor, query);
  }

  @Post()
  create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(officialDocumentInputSchema)) body: OfficialDocumentInput,
  ) {
    return this.service.create(actor, body);
  }

  @Patch(":id")
  update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(officialDocumentPatchSchema)) body: OfficialDocumentPatch,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.remove(actor, params.id);
  }
}
