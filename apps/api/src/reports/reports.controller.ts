import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { idParamSchema, paginationQuerySchema } from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { ReportsService } from "./reports.service";
import { createReportSchema, type CreateReportDto } from "./reports.dto";

const jobIdParamSchema = z.object({ jobId: z.uuid() });

/**
 * Report jobs.
 *
 * No `@Roles`: who may generate a report is decided by the caller's
 * relationship to the child, and a parent generating their own child's
 * portfolio is the point of RFP §10.3. Every route resolves authorization
 * through `ChildAccessService`.
 */
@Controller("reports")
@UseGuards(RateLimitGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  /**
   * ★ Rate limited hard. One report is seconds of Chromium and a 1 GB memory
   * floor; a loop that queues a hundred is a denial of service against the
   * worker that costs the caller one line of JavaScript. Twenty an hour is well
   * past what a teacher preparing for parents' evening needs.
   */
  @Post()
  @RateLimit({ limit: 20, windowMs: 60 * 60 * 1000, byUser: true })
  async create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportDto,
  ) {
    return this.service.create(actor, body);
  }

  /** Polled by the client while the job runs — there is no realtime channel in the MVP. */
  @Get(":jobId")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(jobIdParamSchema)) params: { jobId: string },
  ) {
    return this.service.get(actor, params.jobId);
  }

  /**
   * Returns a short-lived URL rather than the bytes.
   *
   * The file never travels through the API: that is what keeps one
   * authorization rule in one place and the API container out of the path of a
   * multi-megabyte download.
   */
  @Get(":jobId/download")
  async download(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(jobIdParamSchema)) params: { jobId: string },
  ) {
    return this.service.downloadUrl(actor, params.jobId);
  }
}

@Controller("children/:id/reports")
export class ChildReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: { page: number; pageSize: number },
  ) {
    return this.service.listForChild(actor, params.id, query);
  }
}
