import type { Response } from "express";
import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
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
  attendanceRegisterQuerySchema,
  listAttendanceQuerySchema,
  recordAttendanceSchema,
  recordGroupAttendanceSchema,
  submitAttendanceSchema,
  recordPickupSchema,
  reviewAttendanceRequestSchema,
  type CreateAttendanceRequestDto,
  type DateParam,
  type GroupDaySheetQuery,
  type AttendanceRegisterQuery,
  type ListAttendanceQuery,
  type RecordAttendanceDto,
  type RecordGroupAttendanceDto,
  type SubmitAttendanceDto,
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
/**
 * The kindergarten-wide attendance register — the director's and the
 * accountant's view.
 *
 * ★ `@Roles("ADMIN", "ACCOUNTANT")` gates the route; the service still checks
 * the membership against the kindergarten in the URL, because the decorator
 * alone would let an accountant employed by one kindergarten read another's
 * register by changing the id.
 *
 * ★★ TEACHER is absent by design. A teacher reads their own group through
 * `GroupAttendanceController` below — the view their job needs — and
 * `нэмэлт.md` §13 keeps them out of the kindergarten-wide figures that feed
 * funding.
 */
@Controller("kindergartens/:id/attendance")
export class KindergartenAttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Get("register")
  @Roles("ADMIN", "ACCOUNTANT")
  async register(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(attendanceRegisterQuerySchema)) query: AttendanceRegisterQuery,
  ) {
    return this.service.register(actor, params.id, query);
  }

  /**
   * "Өдөр тутмын ирц" — the director's read-only register.
   *
   * ★ Same roles and same query schema as `register` above, deliberately.
   *
   * It is the same data at a coarser grain, so it must not be reachable by
   * anybody the detailed grid is not: `нэмэлт.md` §13 keeps teachers out of the
   * kindergarten-wide figures that feed funding, and a summary of those figures
   * is still those figures.
   */
  @Get("daily")
  @Roles("ADMIN", "ACCOUNTANT")
  async daily(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(attendanceRegisterQuerySchema)) query: AttendanceRegisterQuery,
  ) {
    return this.service.dailySummary(actor, params.id, query);
  }

  /**
   * "Ирц илгээх" — declares a set of group-days final and submitted.
   *
   * ★ `POST`, not `PUT`, even though re-submitting is idempotent.
   *
   * The resource created is a submission, and the request names which days to
   * submit rather than the state a collection should end in. Pressing the
   * button twice updates the existing row (see `submitDays`), which makes the
   * *effect* idempotent without making the request a replacement.
   */
  @Post("daily/submit")
  @Roles("ADMIN", "ACCOUNTANT")
  async submitDaily(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(submitAttendanceSchema)) body: SubmitAttendanceDto,
  ) {
    return this.service.submitDays(actor, params.id, body);
  }

  /**
   * The same register as a spreadsheet — нэмэлт.md §16's "Excel экспорт".
   *
   * ★ Inline, not a queued job. ExcelJS over a quarter's grid is fast and
   * light; only the PDF path needs Chromium and a queue (CLAUDE.md §6).
   */
  @Get("register/export")
  @Roles("ADMIN", "ACCOUNTANT")
  async exportRegister(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(attendanceRegisterQuerySchema)) query: AttendanceRegisterQuery,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportRegister(actor, params.id, query);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}

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
   * Many children, one status, one request — the register's batch save.
   *
   * ★ `@Put()` on the bare group path, mirroring `GroupMealsController`.
   *
   * Idempotent by construction: sending the same entries twice leaves the same
   * six rows saying the same thing, which is what a teacher correcting a
   * mis-tap actually does. That is `PUT`, not `POST`.
   *
   * The per-child `PUT /children/:id/attendance/:date` stays and is not
   * superseded: it is the one that carries a note, a drop-off and an arrival
   * time, none of which are true of six children at once.
   */
  @Put()
  @Roles("TEACHER", "ADMIN")
  async recordGroup(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(recordGroupAttendanceSchema)) body: RecordGroupAttendanceDto,
  ) {
    return this.service.recordGroupAttendance(actor, params.id, body);
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
