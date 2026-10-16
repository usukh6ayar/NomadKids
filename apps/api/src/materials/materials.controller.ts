import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Redirect,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import {
  MATERIAL_PREVIEWS_MAX,
  materialFormSchema,
  materialListQuerySchema,
  uuidSchema,
  type MaterialForm,
  type MaterialListQuery,
} from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { AllowSuperAdmin } from "../auth/decorators/allow-super-admin.decorator";
import { Public } from "../auth/decorators/public.decorator";
import type { Actor } from "../authz/actor";
import { MAX_MATERIAL_BYTES } from "./material-file";
import { MaterialsService, type UploadedPart } from "./materials.service";

const HOUR = 60 * 60 * 1000;

const idParams = z.object({ id: uuidSchema });
const previewParams = z.object({
  id: uuidSchema,
  order: z.coerce
    .number()
    .int()
    .min(0)
    .max(MATERIAL_PREVIEWS_MAX - 1),
});

type UploadFields = { file?: UploadedPart[]; previews?: UploadedPart[] };

const UPLOAD = FileFieldsInterceptor(
  [
    { name: "file", maxCount: 1 },
    { name: "previews", maxCount: MATERIAL_PREVIEWS_MAX },
  ],
  { limits: { fileSize: MAX_MATERIAL_BYTES, files: 1 + MATERIAL_PREVIEWS_MAX } },
);

/**
 * The shop — teachers only (client, 2026-10-09: "not a director, not a
 * family"). `@Roles` answers 404 to everyone else.
 */
@Controller("materials")
@UseGuards(RateLimitGuard)
export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  @Roles("TEACHER")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(materialListQuerySchema)) query: MaterialListQuery,
  ) {
    return this.service.shop(actor, query);
  }

  /** Draws a QR — or, for a free material, adds it at once. */
  @Post(":id/qpay")
  @Roles("TEACHER")
  @RateLimit({ limit: 30, windowMs: HOUR, byUser: true })
  async buy(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParams)) params: { id: string },
  ) {
    return this.service.startPurchase(actor, params.id);
  }

  /** Polled while the QR is on screen. */
  @Get(":id/qpay")
  @Roles("TEACHER")
  async purchaseStatus(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParams)) params: { id: string },
  ) {
    return this.service.purchaseStatus(actor, params.id);
  }

  /** A 302 to a five-minute presigned URL, for the owner only. */
  @Get(":id/download")
  @Roles("TEACHER")
  @Redirect()
  async download(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParams)) params: { id: string },
  ) {
    return { url: await this.service.downloadUrl(actor, params.id), statusCode: 302 };
  }

  /** A sample page, as an `<img src>`. The operator reads them too. */
  @Get(":id/previews/:order")
  @Roles("TEACHER")
  @AllowSuperAdmin()
  @Redirect()
  async preview(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(previewParams)) params: { id: string; order: number },
  ) {
    return {
      url: await this.service.previewUrl(actor, params.id, params.order),
      statusCode: 302,
    };
  }
}

/**
 * The page behind a copied `/m/:id` link. Only published, live materials and
 * their reduced sample images are exposed; the purchased source file remains
 * behind `MaterialsController.download`.
 */
@Controller("public/materials")
@UseGuards(RateLimitGuard)
export class PublicMaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get(":id")
  @Public()
  async detail(@Param(new ZodValidationPipe(idParams)) params: { id: string }) {
    return this.service.publicMaterial(params.id);
  }

  @Get(":id/previews/:order")
  @Public()
  @Redirect()
  async preview(
    @Param(new ZodValidationPipe(previewParams)) params: { id: string; order: number },
  ) {
    return {
      url: await this.service.publicPreviewUrl(params.id, params.order),
      statusCode: 302,
    };
  }
}

/** «Миний сан» — what this teacher owns, on sale or not. */
@Controller("me/materials")
export class OwnMaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  @Roles("TEACHER")
  async list(@CurrentActor() actor: Actor) {
    return this.service.owned(actor);
  }
}

/**
 * The platform operator's catalog. No `@Roles` — a superadmin holds no
 * membership; `PlatformAccessService` decides, as on every `/platform` route.
 */
@Controller("platform/materials")
@UseGuards(RateLimitGuard)
export class PlatformMaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  async list(@CurrentActor() actor: Actor) {
    return this.service.catalog(actor);
  }

  @Post()
  @RateLimit({ limit: 60, windowMs: HOUR, byUser: true })
  @UseInterceptors(UPLOAD)
  async create(
    @CurrentActor() actor: Actor,
    @UploadedFiles() files: UploadFields | undefined,
    @Body(new ZodValidationPipe(materialFormSchema)) body: MaterialForm,
  ) {
    return this.service.create(actor, body, files?.file?.[0], files?.previews ?? []);
  }

  @Put(":id")
  @RateLimit({ limit: 60, windowMs: HOUR, byUser: true })
  @UseInterceptors(UPLOAD)
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParams)) params: { id: string },
    @UploadedFiles() files: UploadFields | undefined,
    @Body(new ZodValidationPipe(materialFormSchema)) body: MaterialForm,
  ) {
    return this.service.update(actor, params.id, body, files?.file?.[0], files?.previews ?? []);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParams)) params: { id: string },
  ) {
    await this.service.remove(actor, params.id);
  }

  @Post(":id/previews/regenerate")
  @HttpCode(HttpStatus.ACCEPTED)
  async regenerate(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParams)) params: { id: string },
  ) {
    return this.service.regeneratePreviews(actor, params.id);
  }
}
