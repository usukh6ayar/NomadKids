import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { SurveysService } from "./surveys.service";
import {
  createSurveySchema,
  saveQuestionsSchema,
  submitResponseSchema,
  type CreateSurveyDto,
  type SaveQuestionsDto,
  type SubmitResponseDto,
} from "./surveys.dto";

/** Kindergarten-scoped survey management — staff only. */
@Controller("kindergartens/:id/surveys")
export class KindergartenSurveysController {
  constructor(private readonly service: SurveysService) {}

  @Get()
  @Roles("TEACHER", "ADMIN")
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listForKindergarten(actor, params.id);
  }

  @Post()
  @Roles("TEACHER", "ADMIN")
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createSurveySchema)) body: CreateSurveyDto,
  ) {
    return this.service.create(actor, params.id, body);
  }
}

/** A child's own view — which published surveys are relevant right now. */
@Controller("children/:id/surveys")
export class ChildSurveysController {
  constructor(private readonly service: SurveysService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listActiveForChild(actor, params.id);
  }
}

/** Survey-scoped routes. No blanket `@Roles` — `submit` is answerable by a
 * guardian or an ordinary member; the service decides case by case. */
@Controller("surveys")
export class SurveysController {
  constructor(private readonly service: SurveysService) {}

  @Get(":id")
  @Roles("TEACHER", "ADMIN")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.getOne(actor, params.id);
  }

  @Put(":id/questions")
  @Roles("TEACHER", "ADMIN")
  async saveQuestions(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(saveQuestionsSchema)) body: SaveQuestionsDto,
  ) {
    return this.service.saveQuestions(actor, params.id, body);
  }

  @Post(":id/publish")
  @Roles("TEACHER", "ADMIN")
  async publish(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.publish(actor, params.id);
  }

  @Post(":id/close")
  @Roles("TEACHER", "ADMIN")
  async close(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.close(actor, params.id);
  }

  @Get(":id/results")
  @Roles("TEACHER", "ADMIN")
  async results(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.results(actor, params.id);
  }

  @Post(":id/responses")
  async submit(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(submitResponseSchema)) body: SubmitResponseDto,
  ) {
    return this.service.submitResponse(actor, params.id, body);
  }
}
