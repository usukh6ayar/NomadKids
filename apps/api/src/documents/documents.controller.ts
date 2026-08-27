import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { idParamSchema } from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { MAX_PDF_BYTES } from "../media/upload-validation";
import { DocumentsService } from "./documents.service";
import {
  createDocumentSchema,
  listDocumentsQuerySchema,
  updateDocumentSchema,
  type ListDocumentsQuery,
  type UpdateDocumentDto,
} from "./documents.dto";

type Upload = { buffer: Buffer; originalname: string };
type UploadFields = { file?: Upload[]; cover?: Upload[] };

/**
 * The document library — RFP §9.
 *
 * ★ Staff only, on reading as well as writing. §9 opens with "Багшид зориулсан
 * PDF баримт бичгийн сан": curricula and methodology are professional material,
 * and a family has no route to them.
 */
@Controller("kindergartens/:id/documents")
@Roles("TEACHER", "ADMIN")
@UseGuards(RateLimitGuard)
export class KindergartenDocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listDocumentsQuerySchema)) query: ListDocumentsQuery,
  ) {
    return this.service.list(actor, params.id, query, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /** The categories in use — what the filter chips are built from. */
  @Get("categories")
  async categories(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listCategories(actor, params.id);
  }

  @Post()
  @RateLimit({ limit: 30, windowMs: 60 * 60 * 1000, byUser: true })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "file", maxCount: 1 },
        { name: "cover", maxCount: 1 },
      ],
      { limits: { fileSize: MAX_PDF_BYTES, files: 2 } },
    ),
  )
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @UploadedFiles() files: UploadFields | undefined,
    @Body(new ZodValidationPipe(createDocumentSchema)) body: z.infer<typeof createDocumentSchema>,
  ) {
    const file = files?.file?.[0];
    if (!file) throw new BadRequestException("PDF файл хавсаргаагүй байна");

    return this.service.create(actor, params.id, body, file, files?.cover?.[0]);
  }
}

@Controller("documents")
@Roles("TEACHER", "ADMIN")
@UseGuards(RateLimitGuard)
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateDocumentSchema)) body: UpdateDocumentDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  /** RFP §9 — "Баримт шинэ хувилбараар солих". */
  @Post(":id/file")
  @RateLimit({ limit: 30, windowMs: 60 * 60 * 1000, byUser: true })
  @UseInterceptors(
    FileFieldsInterceptor([{ name: "file", maxCount: 1 }], {
      limits: { fileSize: MAX_PDF_BYTES, files: 1 },
    }),
  )
  async replaceFile(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @UploadedFiles() files: UploadFields | undefined,
    @Body(new ZodValidationPipe(z.object({ version: z.string().max(40).optional() })))
    body: { version?: string },
  ) {
    const file = files?.file?.[0];
    if (!file) throw new BadRequestException("PDF файл хавсаргаагүй байна");

    return this.service.replaceFile(actor, params.id, file, body.version ?? null);
  }

  @Post(":id/bookmark")
  async bookmark(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.setBookmark(actor, params.id, true);
  }

  @Delete(":id/bookmark")
  async unbookmark(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.setBookmark(actor, params.id, false);
  }

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.remove(actor, params.id);
  }
}
