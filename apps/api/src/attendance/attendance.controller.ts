import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { idParamSchema, paginationQuerySchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { AttendanceService } from "./attendance.service";
import {
  createAttendanceRequestSchema,
  dateParamSchema,
  groupDaySheetQuerySchema,
  listAttendanceQuerySchema,
  recordAttendanceSchema,
  recordPickupSchema,
  reviewAttendanceRequestSchema,
  type CreateAttendanceRequestDto,
  type DateParam,
  type GroupDaySheetQuery,
  type ListAttendanceQuery,
  type RecordAttendanceDto,
  type RecordPickupDto,
  type ReviewAttendanceRequestDto,
} from "./attendance.dto";

const childDateParamsSchema = idParamSchema.extend({ date: dateParamSchema.shape.date });

/**
 * Child-scoped attendance. No `@Roles` on the read paths — `ChildAccessService`
 * decides who may see this child, same as observations.
 */
@Controller("children/:id/attendance")
export class ChildAttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listAttendanceQuerySchema)) query: ListAttendanceQuery,
  ) {
    return this.service.listForChild(actor, params.id, query.month);
  }

  @Get("summary")
  async summary(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listAttendanceQuerySchema)) query: ListAttendanceQuery,
  ) {
    return this.service.summaryForChild(actor, params.id, query.month);
  }

  /** Staff only — enforced inside the service via `assertCanRecord`. */
  @Put(":date")
  async record(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(childDateParamsSchema)) params: { id: string } & DateParam,
    @Body(new ZodValidationPipe(recordAttendanceSchema)) body: RecordAttendanceDto,
  ) {
    return this.service.record(actor, params.id, params.date, body);
  }

  /** Independent of `record()` — see `RecordPickupDto`'s own note. */
  @Patch(":date/pickup")
  async pickup(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(childDateParamsSchema)) params: { id: string } & DateParam,
    @Body(new ZodValidationPipe(recordPickupSchema)) body: RecordPickupDto,
  ) {
    return this.service.recordPickup(actor, params.id, params.date, body);
  }
}

/** A guardian's advance notice, and the staff review of it. */
@Controller("children/:id/attendance-requests")
export class ChildAttendanceRequestController {
  constructor(private readonly service: AttendanceService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listRequestsForChild(actor, params.id);
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createAttendanceRequestSchema)) body: CreateAttendanceRequestDto,
  ) {
    return this.service.createRequest(actor, params.id, body);
  }
}

/** Request-scoped routes, where the child is derived from the record. */
@Controller("attendance-requests")
export class AttendanceRequestController {
  constructor(private readonly service: AttendanceService) {}

  /** Declared before `:id` so the literal path is not captured by it. */
  @Get("review-queue")
  @Roles("TEACHER", "ADMIN")
  async reviewQueue(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: { page: number; pageSize: number },
  ) {
    return this.service.reviewQueue(actor, query);
  }

  @Post(":id/review")
  @Roles("TEACHER", "ADMIN")
  async review(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(reviewAttendanceRequestSchema)) body: ReviewAttendanceRequestDto,
  ) {
    return this.service.reviewRequest(actor, params.id, body);
  }
}

/** The group day sheet — every enrolled child, one day. */
@Controller("groups/:id/attendance")
export class GroupAttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Get()
  @Roles("TEACHER", "ADMIN")
  async daySheet(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(groupDaySheetQuerySchema)) query: GroupDaySheetQuery,
  ) {
    return this.service.groupDaySheet(actor, params.id, query.date);
  }

  /**
   * The month behind the day sheet — what the register's own panel draws.
   *
   * Declared after the bare `@Get()` and on a literal path, so `summary` is
   * never read as a date.
   */
  @Get("summary")
  @Roles("TEACHER", "ADMIN")
  async monthSummary(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listAttendanceQuerySchema)) query: ListAttendanceQuery,
  ) {
    return this.service.groupMonthSummary(actor, params.id, query.month);
  }
}
