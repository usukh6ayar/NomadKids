import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { AssessmentService } from "./assessment.service";
import {
  createTermSchema,
  groupColumnQuerySchema,
  publishTermSchema,
  requiredTermSchema,
  saveAssessmentSchema,
  saveGroupColumnSchema,
  saveTermReportSchema,
  termIdQuerySchema,
  updateTermSchema,
  type CreateTermDto,
  type GroupColumnQuery,
  type PublishTermDto,
  type SaveAssessmentDto,
  type SaveGroupColumnDto,
  type SaveTermReportDto,
  type UpdateTermDto,
} from "./assessment.dto";

/** Kindergarten-scoped configuration and terms. */
@Controller("kindergartens/:id")
export class AssessmentConfigController {
  constructor(private readonly service: AssessmentService) {}

  /** Every role reads this — a parent's screen shows domain and level names. */
  @Get("assessment-config")
  async config(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listConfig(actor, params.id);
  }

  @Get("terms")
  async listTerms(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(termIdQuerySchema.extend({}).partial()))
    query: Record<string, string>,
  ) {
    return this.service.listTerms(actor, params.id, query.schoolYearId);
  }

  @Post("terms")
  @Roles("ADMIN")
  async createTerm(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createTermSchema)) body: CreateTermDto,
  ) {
    return this.service.createTerm(actor, params.id, body);
  }
}

@Controller("terms")
export class TermsController {
  constructor(private readonly service: AssessmentService) {}

  @Patch(":id")
  @Roles("ADMIN")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateTermSchema)) body: UpdateTermDto,
  ) {
    return this.service.updateTerm(actor, params.id, body);
  }
}

@Controller("children/:id")
export class ChildAssessmentController {
  constructor(private readonly service: AssessmentService) {}

  @Get("assessments")
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(termIdQuerySchema)) query: { termId?: string },
  ) {
    return this.service.listForChild(actor, params.id, query.termId);
  }

  /**
   * The radar. `termId` is required: a radar without a term is an average of
   * everything, which describes no moment in a child's development.
   */
  @Get("assessment-radar")
  async radar(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(requiredTermSchema)) query: { termId: string },
  ) {
    return this.service.radarForChild(actor, params.id, query.termId);
  }

  @Put("assessments")
  @Roles("TEACHER", "ADMIN")
  async save(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(saveAssessmentSchema)) body: SaveAssessmentDto,
  ) {
    return this.service.saveForChild(actor, params.id, body);
  }

  /** Publishing is per term — see AssessmentService.publishTerm. */
  @Post("assessments/publish")
  @Roles("TEACHER", "ADMIN")
  async publish(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(publishTermSchema)) body: PublishTermDto,
  ) {
    return this.service.publishTerm(actor, params.id, body);
  }

  @Get("term-report")
  async getReport(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(requiredTermSchema)) query: { termId: string },
  ) {
    return this.service.getTermReport(actor, params.id, query.termId);
  }

  @Put("term-report")
  @Roles("TEACHER", "ADMIN")
  async saveReport(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(saveTermReportSchema)) body: SaveTermReportDto,
  ) {
    return this.service.saveTermReport(actor, params.id, body);
  }

  @Post("term-report/finalize")
  @Roles("TEACHER", "ADMIN")
  async finalizeReport(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(requiredTermSchema)) body: { termId: string },
  ) {
    return this.service.finalizeTermReport(actor, params.id, body.termId);
  }
}

/**
 * ★ The teacher's main assessment screen: one group, one term, ONE domain.
 *
 * `termId` and `domainId` are both required by the schema. That is deliberate —
 * making the domain optional is exactly how this endpoint would drift into the
 * children × domains matrix the MVP scope excludes.
 */
@Controller("groups/:id/assessments")
export class GroupAssessmentController {
  constructor(private readonly service: AssessmentService) {}

  @Get()
  @Roles("TEACHER", "ADMIN")
  async column(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(groupColumnQuerySchema)) query: GroupColumnQuery,
  ) {
    return this.service.getGroupColumn(actor, params.id, query);
  }

  @Put()
  @Roles("TEACHER", "ADMIN")
  async saveColumn(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(saveGroupColumnSchema)) body: SaveGroupColumnDto,
  ) {
    return this.service.saveGroupColumn(actor, params.id, body);
  }
}
