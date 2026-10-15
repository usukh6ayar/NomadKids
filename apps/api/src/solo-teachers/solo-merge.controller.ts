import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import {
  paginationQuerySchema,
  soloMergeInputSchema,
  uuidSchema,
  type PaginationQuery,
  type SoloMergeInput,
} from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { SoloMergeService } from "./solo-merge.service";

const idParams = z.object({ id: uuidSchema });

/**
 * The operator's solo workspaces and their merge. No `@Roles` — a superadmin
 * holds no membership; `PlatformAccessService` decides, as on every
 * `/platform` route.
 */
@Controller("platform/solo-workspaces")
export class SoloMergeController {
  constructor(private readonly service: SoloMergeService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.service.list(actor, query);
  }

  /** №9 — the operator's reset link for the workspace's teacher. */
  @Post(":id/password-reset")
  async issueTeacherReset(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParams)) params: { id: string },
  ) {
    return this.service.issueTeacherReset(actor, params.id);
  }

  @Post(":id/merge-preview")
  @HttpCode(HttpStatus.OK)
  async preview(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParams)) params: { id: string },
    @Body(new ZodValidationPipe(soloMergeInputSchema)) body: SoloMergeInput,
  ) {
    return this.service.preview(actor, params.id, body);
  }

  @Post(":id/merge")
  @HttpCode(HttpStatus.OK)
  async merge(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParams)) params: { id: string },
    @Body(new ZodValidationPipe(soloMergeInputSchema)) body: SoloMergeInput,
  ) {
    return this.service.merge(actor, params.id, body);
  }
}
