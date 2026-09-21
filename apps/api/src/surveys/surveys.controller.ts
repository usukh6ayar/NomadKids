import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { idParamSchema, uuidSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { SurveysService } from "./surveys.service";
import {
  addPollOptionSchema,
  cloneSurveySchema,
  compareSurveyQuerySchema,
  createSurveySchema,
  questionAnswersParamsSchema,
  saveQuestionsSchema,
  submitResponseSchema,
  surveyResultsQuerySchema,
  type AddPollOptionDto,
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

/**
 * The child in the path and the poll under it.
 *
 * Composed from `idParamSchema` rather than spelled out so the child id keeps
 * one definition — the same reason every dated register extends it.
 */
const pollParamsSchema = idParamSchema.extend({ surveyId: uuidSchema });
const pollQuestionParamsSchema = pollParamsSchema.extend({ questionId: uuidSchema });

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

  /*
   * ★ Both poll routes hang off the *child*, not off `/surveys/:id`.
   *
   * The survey-scoped controller answers to staff; these two answer to a
   * family, and the child in the path is what makes the authorization
   * question askable at all — `canAccessChild` first, then whether the poll is
   * on that child's board. A `/surveys/:id/tally` open to guardians would have
   * no child to check and would have to re-derive the audience from the actor,
   * which is the second copy of the visibility rule §1.1 forbids.
   *
   * No `@Roles`: a guardian reads these, and so may a teacher looking at a
   * child they are entitled to. The service decides, as `submit` does.
   */

  /** A poll's running count, as the family answering it sees it. */
  @Get(":surveyId/tally")
  async tally(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(pollParamsSchema)) params: { id: string; surveyId: string },
  ) {
    return this.service.pollTally(actor, params.id, params.surveyId);
  }

  /** A family adds a choice of their own to an open poll. */
  @Post(":surveyId/questions/:questionId/options")
  async addOption(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(pollQuestionParamsSchema))
    params: { id: string; surveyId: string; questionId: string },
    @Body(new ZodValidationPipe(addPollOptionSchema)) body: AddPollOptionDto,
  ) {
    return this.service.addPollOption(
      actor,
      params.id,
      params.surveyId,
      params.questionId,
      body.label,
    );
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

  /**
   * Takes the lock off — the same roles that put it on.
   *
   * ★ Its own route rather than a toggle on `close`: a "flip it" request would
   * close a survey somebody else had just re-opened, and the audit row would
   * then say the opposite of what happened.
   */
  @Post(":id/reopen")
  @Roles("TEACHER", "ADMIN")
  async reopen(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.reopen(actor, params.id);
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

  /** Who said what to one question — the "Хариултууд" list. */
  @Get(":id/questions/:questionId/answers")
  @Roles("TEACHER", "ADMIN")
  async questionAnswers(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(questionAnswersParamsSchema))
    params: { id: string; questionId: string },
  ) {
    return this.service.questionAnswers(actor, params.id, params.questionId);
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
