import { Controller, Get, Param, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { GroupReportsService } from "./group-reports.service";
import { groupReportQuerySchema, type GroupReportQuery } from "./group-reports.dto";

/**
 * The teacher's report over one group.
 *
 * ★ Its own controller, like `observation-stats`: these routes authorise per
 * *group*, and a controller answering to two authorization paths is the shape
 * §1.1 exists to prevent.
 */
@Controller("groups/:id/report")
export class GroupReportsController {
  constructor(private readonly service: GroupReportsService) {}

  @Get()
  @Roles("TEACHER", "ADMIN")
  async summary(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(groupReportQuerySchema)) query: GroupReportQuery,
  ) {
    return this.service.summary(actor, params.id, query.from, query.to);
  }
}
