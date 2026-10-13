import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import {
  acceptAgreementSchema,
  listAgreementAcceptancesQuerySchema,
  type AcceptAgreement,
  type ListAgreementAcceptancesQuery,
} from "@kinder/contracts";
import type { Request } from "express";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { SuperAdmin } from "../auth/decorators/super-admin.decorator";
import type { Actor } from "../authz/actor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AgreementsService } from "./agreements.service";

/** The person's own acceptances — `apps/web/components/agreements/agreement-gate.tsx`. */
@Controller("me/agreements")
export class MyAgreementsController {
  constructor(private readonly service: AgreementsService) {}

  @Get()
  mine(@CurrentActor() actor: Actor) {
    return this.service.mine(actor);
  }

  @Post()
  accept(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(acceptAgreementSchema)) body: AcceptAgreement,
    @Req() req: Request,
  ) {
    return this.service.accept(actor, body, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });
  }
}

/** Who accepted which version, and when — the platform operator only. */
@Controller("platform/agreements")
@SuperAdmin()
export class PlatformAgreementsController {
  constructor(private readonly service: AgreementsService) {}

  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listAgreementAcceptancesQuerySchema))
    query: ListAgreementAcceptancesQuery,
  ) {
    return this.service.list(actor, query);
  }
}
