import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { ConsentService } from "./consent.service";
import { recordConsentSchema, type RecordConsentDto } from "./consent.dto";

/**
 * Consent — RFP §16.
 *
 * Staff read it (they need to know whether they may publish a photograph) and
 * only a guardian writes it. The service enforces the write side; there is no
 * `@Roles` here because both roles legitimately reach the GET.
 */
@Controller("children/:id/consent")
export class ChildConsentController {
  constructor(private readonly service: ConsentService) {}

  @Get()
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Post()
  async record(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(recordConsentSchema)) body: RecordConsentDto,
  ) {
    return this.service.record(actor, params.id, body);
  }
}
