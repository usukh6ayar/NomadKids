import { Body, Controller, Delete, Get, Param, Put, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { GrowthService } from "./growth.service";
import {
  growthDateParamSchema,
  listGrowthQuerySchema,
  recordGrowthSchema,
  type ListGrowthQuery,
  type RecordGrowthDto,
} from "./growth.dto";

/**
 * Growth measurements and the chart — RFP §7.
 *
 * ★ `PUT :date`, not `POST`.
 *
 * One measurement per child per day is enforced by a partial unique index, so
 * the day *is* the identity of the record. A POST would invite a second row for
 * the same date, which the database refuses — and a re-measurement after a bad
 * reading corrects that day rather than adding to it. The verb says so.
 *
 * No `@Roles`: guardians legitimately read and write here (RFP §2.3 lists both),
 * and the service decides. A role guard would be the wrong check in the right
 * place.
 */
@Controller("children/:id/growth")
export class ChildGrowthController {
  constructor(private readonly service: GrowthService) {}

  @Get()
  async chart(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listGrowthQuerySchema)) query: ListGrowthQuery,
  ) {
    return this.service.chart(actor, params.id, query.from, query.to);
  }

  @Put(":date")
  async record(
    @Param(new ZodValidationPipe(idParamSchema.extend(growthDateParamSchema.shape)))
    params: { id: string; date: string },
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(recordGrowthSchema)) body: RecordGrowthDto,
  ) {
    return this.service.record(actor, params.id, params.date, body);
  }
}

@Controller("growth-measurements")
export class GrowthMeasurementController {
  constructor(private readonly service: GrowthService) {}

  /** Staff only — see `GrowthService.remove` for why a guardian may not. */
  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.remove(actor, params.id);
  }
}
