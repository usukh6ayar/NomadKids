import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { CurrentActor } from "../../auth/decorators/actor.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { SuperAdmin } from "../../auth/decorators/super-admin.decorator";
import type { Actor } from "../../authz/actor";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { EsisAdminService } from "./esis-admin.service";
import {
  esisPreviewSchema,
  esisReadSchema,
  updateEsisMappingSchema,
  type EsisPreviewDto,
  type EsisReadDto,
  type UpdateEsisMappingDto,
} from "./esis.dto";

/** `?resource=groups&studentGroupId=10001` — path values arrive flat. */
const esisReadQuerySchema = esisReadSchema.shape.params
  .unwrap()
  .extend({ resource: esisReadSchema.shape.resource })
  .transform(({ resource, ...params }) => ({ resource, params }) satisfies EsisReadDto);

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

  /** Minimized ESIS student output for the staff child-registration form. */
  @Get("student-registration-template")
  @Roles("ADMIN", "TEACHER")
  studentRegistrationTemplate(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.studentRegistrationTemplate(actor, params.id);
  }

  /** Teacher/staff ESIS fields matched to the authenticated user's identity. */
  @Get("my-profile")
  @Roles("ADMIN", "TEACHER", "COOK", "ACCOUNTANT")
  myProfile(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.myProfile(actor, params.id);
  }

  /**
   * One read-only fetch, for the "ESIS-ээс татах" button on a working screen.
   *
   * A `GET` because it changes no NomadKids record — the only row it writes is
   * the `AuditLog` entry that says who looked.
   */
  @Get("resource")
  read(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(esisReadQuerySchema)) query: EsisReadDto,
  ) {
    return this.service.read(actor, params.id, query);
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
