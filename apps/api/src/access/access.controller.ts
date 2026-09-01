import { Controller, Get, Param, Post } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { AccessService } from "./access.service";

/**
 * The unlock screen's own endpoints — `нэмэлт.md` has nothing on this; it is
 * the client's 2026-09-01 instruction that QPay charges parents for the right
 * to use the site.
 *
 * ★ No `@Roles`, and deliberately **not** gated by the fee. These are the two
 * routes a family with an unpaid subscription must still reach, or the 402
 * everywhere else is a dead end.
 */
@Controller("children/:id/access")
export class ChildAccessFeeController {
  constructor(private readonly service: AccessService) {}

  /** Is a fee owed for this child, how much, for which school year. */
  @Get()
  async status(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.statusForChild(actor, params.id);
  }

  /** Raises the subscription a QPay QR will be drawn against, if none exists. */
  @Post()
  async ensure(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.ensureForChild(actor, params.id);
  }
}
