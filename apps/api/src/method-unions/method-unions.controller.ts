import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { MethodUnionsService } from "./method-unions.service";
import {
  addMethodUnionMemberSchema,
  createMethodUnionSchema,
  listMethodUnionsQuerySchema,
  updateMethodUnionSchema,
  type AddMethodUnionMemberDto,
  type CreateMethodUnionDto,
  type ListMethodUnionsQuery,
  type UpdateMethodUnionDto,
} from "./method-unions.dto";

/** «Заах аргын нэгдэл» — administrators only; the service re-checks the tenant. */
@Controller("kindergartens/:id/method-unions")
@Roles("ADMIN")
export class KindergartenMethodUnionsController {
  constructor(private readonly service: MethodUnionsService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listMethodUnionsQuerySchema)) query: ListMethodUnionsQuery,
  ) {
    return this.service.list(actor, params.id, query, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createMethodUnionSchema)) body: CreateMethodUnionDto,
  ) {
    return this.service.create(actor, params.id, body);
  }
}

@Controller("method-unions")
@Roles("ADMIN")
export class MethodUnionsController {
  constructor(private readonly service: MethodUnionsService) {}

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateMethodUnionSchema)) body: UpdateMethodUnionDto,
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

  @Post(":id/members")
  async addMember(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(addMethodUnionMemberSchema)) body: AddMethodUnionMemberDto,
  ) {
    return this.service.addMember(actor, params.id, body.membershipId);
  }
}

@Controller("method-union-members")
@Roles("ADMIN")
export class MethodUnionMembersController {
  constructor(private readonly service: MethodUnionsService) {}

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.removeMember(actor, params.id);
  }
}
