import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { idParamSchema, uuidSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { StaffService } from "./staff.service";
import {
  createStaffRecordSchema,
  listStaffRecordsQuerySchema,
  updateStaffRecordSchema,
  type CreateStaffRecordDto,
  type ListStaffRecordsQuery,
  type UpdateStaffRecordDto,
} from "./staff.dto";

/** `:id` is the kindergarten, `:userId` the member of staff the file is about. */
const staffParamsSchema = z.object({ id: uuidSchema, userId: uuidSchema });

/**
 * Хүний нөөц — Order А/261, criterion 51: a member of staff's experience,
 * certificates and grades.
 *
 * ★ **No `@Roles` on the read.**
 *
 * The decorator is a coarse gate and this endpoint has two audiences with
 * different answers: an administrator reads anybody's file, a member of staff
 * reads their own. `@Roles("ADMIN")` would lock a teacher out of their own
 * record, and `@Roles("ADMIN", "TEACHER")` would let them read a colleague's.
 * The service asks `canReadStaffRecords`, which is where that distinction
 * belongs (§1.1) — the same shape `ChildHealthController` uses for medication.
 *
 * ★★ The writes are administrator-only and say so through the service rather
 * than the decorator too, so that one authorization module answers for the
 * whole surface instead of two mechanisms that can drift apart.
 */
@Controller("kindergartens/:id/staff/:userId/records")
export class StaffController {
  constructor(private readonly service: StaffService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(staffParamsSchema)) params: { id: string; userId: string },
    @Query(new ZodValidationPipe(listStaffRecordsQuerySchema)) query: ListStaffRecordsQuery,
  ) {
    return this.service.list(actor, params.id, params.userId, query);
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(staffParamsSchema)) params: { id: string; userId: string },
    @Body(new ZodValidationPipe(createStaffRecordSchema)) body: CreateStaffRecordDto,
  ) {
    return this.service.create(actor, params.id, params.userId, body);
  }
}

@Controller("staff-records")
export class StaffRecordsController {
  constructor(private readonly service: StaffService) {}

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateStaffRecordSchema)) body: UpdateStaffRecordDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.remove(actor, params.id);
  }
}
