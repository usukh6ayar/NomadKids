import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { CurrentActor } from "../../auth/decorators/actor.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { SuperAdmin } from "../../auth/decorators/super-admin.decorator";
import type { Actor } from "../../authz/actor";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { EsisAdminService } from "./esis-admin.service";
import {
  esisPreviewSchema,
  updateEsisMappingSchema,
  type EsisPreviewDto,
  type UpdateEsisMappingDto,
} from "./esis.dto";

@Controller("kindergartens/:id/esis")
@Roles("ADMIN")
export class KindergartenEsisController {
  constructor(private readonly service: EsisAdminService) {}

  @Get()
  overview(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.overview(actor, params.id);
  }

  @Post("preview")
  preview(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(esisPreviewSchema)) body: EsisPreviewDto,
  ) {
    return this.service.preview(actor, params.id, body);
  }
}
@Controller("platform/kindergartens/:id/esis")
@SuperAdmin()
export class PlatformEsisController {
  constructor(private readonly service: EsisAdminService) {}

  @Put("mapping")
  updateMapping(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateEsisMappingSchema)) body: UpdateEsisMappingDto,
  ) {
    return this.service.updateMapping(actor, params.id, body);
  }
}
