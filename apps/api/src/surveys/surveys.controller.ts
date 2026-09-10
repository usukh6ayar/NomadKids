import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { SurveysService } from "./surveys.service";
import {
  cloneSurveySchema,
  compareSurveyQuerySchema,
  createSurveySchema,
  saveQuestionsSchema,
  submitResponseSchema,
  surveyResultsQuerySchema,
  type CloneSurveyDto,
  type CompareSurveyQuery,
  type CreateSurveyDto,
  type SaveQuestionsDto,
  type SubmitResponseDto,
  type SurveyResultsQuery,
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

  /** Copies a survey into the next wave — RFP Module 1.2. */
  @Post(":id/clone")
  @Roles("TEACHER", "ADMIN")
  async clone(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(cloneSurveySchema)) body: CloneSurveyDto,
  ) {
    return this.service.clone(actor, params.id, body);
  }

  /** Begin-to-end progress per indicator and per child — RFP Module 1.2. */
  @Get(":id/comparison")
  @Roles("TEACHER", "ADMIN")
  async comparison(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(compareSurveyQuerySchema)) query: CompareSurveyQuery,
  ) {
    return this.service.compare(actor, params.id, query.baselineId);
  }

  /**
   * The five-sheet workbook — RFP Module 1.3.
   *
   * ★ Streams the bytes rather than returning JSON, so a browser saves a file
   * instead of rendering base64. `@Res` opts this handler out of Nest's
   * serializer, which is why it sets its own headers.
   */
  @Get(":id/export")
  @Roles("TEACHER", "ADMIN")
  async exportWorkbook(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportWorkbook(actor, params.id);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    // RFC 5987 `filename*` because the title is Mongolian — a bare `filename=`
    // with Cyrillic bytes is mangled by every browser.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="survey.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(buffer);
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

  /** Withdraws a survey. Soft — the answers behind it stay (§3.2). */
  @Delete(":id")
  @Roles("TEACHER", "ADMIN")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.remove(actor, params.id);
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

  /** Who answered and who has not — the card's "Оролцоо". */
  @Get(":id/participation")
  @Roles("TEACHER", "ADMIN")
  async participation(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.participation(actor, params.id);
  }

  @Get(":id/results")
  @Roles("TEACHER", "ADMIN")
  async results(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(surveyResultsQuerySchema)) query: SurveyResultsQuery,
  ) {
    return this.service.results(actor, params.id, query.groupId);
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
