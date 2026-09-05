import { Body, Controller, Get, Param, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { MealsService } from "./meals.service";
import {
  dateParamSchema,
  groupMealSheetQuerySchema,
  listMenuQuerySchema,
  mealSummaryQuerySchema,
  recordGroupMealsSchema,
  saveMenuDaySchema,
  type DateParam,
  type GroupMealSheetQuery,
  type ListMenuQuery,
  type MealSummaryQuery,
  type RecordGroupMealsDto,
  type SaveMenuDayDto,
} from "./meals.dto";

const dayParamsSchema = idParamSchema.extend({ date: dateParamSchema.shape.date });

/** The weekly menu — RFP §989. Kindergarten-scoped, not child-scoped. */
@Controller("kindergartens/:id/menu")
export class MealsController {
  constructor(private readonly service: MealsService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listMenuQuerySchema)) query: ListMenuQuery,
  ) {
    return this.service.listForKindergarten(actor, params.id, query.from, query.to);
  }

  /**
   * The same week, with the allergy warnings each dish raises — RFP Module 2.
   *
   * ★ A separate route rather than a flag on the one above, because it is a
   * different audience. The warnings name other people's children and what they
   * react to, which is medical information about another family; a parent reads
   * the menu and never this.
   */
  @Get("with-warnings")
  @Roles("TEACHER", "ADMIN", "COOK")
  async listWithWarnings(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listMenuQuerySchema)) query: ListMenuQuery,
  ) {
    return this.service.listWithAllergenWarnings(actor, params.id, query.from, query.to);
  }

  /**
   * The same range as a spreadsheet — "өдрөөр, 7 хоногоор, сараар татаж
   * авах". One route for all three: the frontend picks `from`/`to`, this
   * does not know or care which button was pressed.
   */
  @Get("export")
  @Roles("TEACHER", "ADMIN", "COOK")
  async export(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listMenuQuerySchema)) query: ListMenuQuery,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportMenu(
      actor,
      params.id,
      query.from,
      query.to,
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Put(":date")
  @Roles("TEACHER", "ADMIN", "COOK")
  async save(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(dayParamsSchema)) params: { id: string } & DateParam,
    @Body(new ZodValidationPipe(saveMenuDaySchema)) body: SaveMenuDayDto,
  ) {
    return this.service.saveDay(actor, params.id, params.date, body);
  }

  /** Батлагдсан цэс — COOK/ADMIN only, narrower than `save` above. */
  @Post(":date/approve")
  @Roles("COOK", "ADMIN")
  async approve(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(dayParamsSchema)) params: { id: string } & DateParam,
  ) {
    return this.service.approveDay(actor, params.id, params.date);
  }

  /** Зарцуулалт — deducts this day's cooking from stock. */
  @Post(":date/consume")
  @Roles("COOK", "ADMIN")
  async consume(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(dayParamsSchema)) params: { id: string } & DateParam,
  ) {
    return this.service.consumeDay(actor, params.id, params.date);
  }
}

/**
 * The meal register — нэмэлт.md §2.
 *
 * ★ Group-scoped, like the attendance day sheet, because that is the screen: a
 * teacher marks a whole group at a serving hatch, not one child at a time.
 */
@Controller("groups/:id/meals")
@Roles("TEACHER", "ADMIN")
export class GroupMealsController {
  constructor(private readonly service: MealsService) {}

  @Get()
  async sheet(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(groupMealSheetQuerySchema)) query: GroupMealSheetQuery,
  ) {
    return this.service.groupMealSheet(actor, params.id, query.date, query.kind);
  }

  @Put()
  async record(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(recordGroupMealsSchema)) body: RecordGroupMealsDto,
  ) {
    return this.service.recordGroupMeals(actor, params.id, body);
  }
}

/** A child's month — the "days fed" a food-cost calculation needs (§3). */
@Controller("children/:id/meals")
export class ChildMealsController {
  constructor(private readonly service: MealsService) {}

  @Get("summary")
  async summary(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(mealSummaryQuerySchema)) query: MealSummaryQuery,
  ) {
    return this.service.childMealSummary(actor, params.id, query.month);
  }
}
