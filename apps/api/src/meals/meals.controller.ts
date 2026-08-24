import { Body, Controller, Get, Param, Put, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { MealsService } from "./meals.service";
import {
  dateParamSchema,
  listMenuQuerySchema,
  saveMenuDaySchema,
  type DateParam,
  type ListMenuQuery,
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

  @Put(":date")
  @Roles("TEACHER", "ADMIN")
  async save(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(dayParamsSchema)) params: { id: string } & DateParam,
    @Body(new ZodValidationPipe(saveMenuDaySchema)) body: SaveMenuDayDto,
  ) {
    return this.service.saveDay(actor, params.id, params.date, body);
  }
}
