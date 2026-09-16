import { Controller, Param, Post } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { StaffRegistrationService } from "./staff-registration.service";

/**
 * The director's side of staff self-registration: issuing the kindergarten's
 * registration code.
 *
 * ★ Not on `KindergartenEsisController` (`kindergartens/:id/esis/…`), though
 * the plan first suggested it. This route calls no ESIS service and needs no
 * institution mapping — an unmapped kindergarten may still issue a code — so
 * nesting it under `/esis/` would describe it as something it is not. See
 * `StaffRegistrationService.issueCode`'s doc comment for what the code is.
 */
@Controller("kindergartens/:id")
export class StaffRegistrationController {
  constructor(private readonly service: StaffRegistrationService) {}

  @Post("staff-registration-code")
  @Roles("ADMIN")
  issueCode(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.issueCode(actor, params.id);
  }
}
