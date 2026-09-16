import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import {
  listSelfRegisteredQuerySchema,
  staffSelfRegistrationSchema,
  type ListSelfRegisteredQuery,
  type StaffSelfRegistrationDto,
} from "./staff-registration.dto";
import { StaffRegistrationService } from "./staff-registration.service";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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

  /**
   * The director's review list — "хэн хэн бүртгүүлсэн байгаа эсэх мэдээлэл",
   * not an approval queue: there is nothing here to accept or reject.
   * Revocation is `DELETE /v1/memberships/:id`, already built
   * (`UsersController.revokeMembership`) — this route only reads.
   */
  @Get("staff-registrations")
  @Roles("ADMIN")
  listSelfRegistered(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listSelfRegisteredQuerySchema)) query: ListSelfRegisteredQuery,
  ) {
    return this.service.listSelfRegistered(actor, params.id, query);
  }
}

/**
 * The teacher's side of staff self-registration: `POST /v1/staff-registration`.
 *
 * ★ **A separate controller and a separate route root**, not a method on
 * `StaffRegistrationController` above. That class is scoped under
 * `kindergartens/:id/…`, which this route is not — the whole point of
 * matching a code is that the caller does not yet know, or get to claim,
 * which kindergarten they mean (`StaffRegistrationService.register`'s doc
 * comment on `matchCode`). Nest has no way to give one method in a
 * `@Controller("kindergartens/:id")` class a path outside that prefix.
 *
 * ★★ Its own `@RateLimit`, not `auth/`'s budget — a teacher who mistypes
 * their register number a few times must not spend down the same counter a
 * signed-in colleague's login depends on. See the module's own doc comment
 * for the fuller version of this argument.
 */
@Controller("staff-registration")
@UseGuards(RateLimitGuard)
export class StaffRegistrationPublicController {
  constructor(private readonly service: StaffRegistrationService) {}

  @Public()
  @Post()
  @RateLimit({ limit: 10, windowMs: HOUR })
  register(
    @Body(new ZodValidationPipe(staffSelfRegistrationSchema)) dto: StaffSelfRegistrationDto,
  ) {
    return this.service.register(dto);
  }
}
