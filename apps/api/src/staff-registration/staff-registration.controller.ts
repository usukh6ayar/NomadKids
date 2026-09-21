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
 * The director's side of staff self-registration: seeing who has registered.
 *
 * ★ It used to also issue a registration code. That route is gone — 2026-09-20,
 * at the client's instruction the first field of the public form is now the
 * kindergarten's ESIS institution number, which a director already has and
 * cannot mislay. There is nothing left to issue, so there is no endpoint.
 */
@Controller("kindergartens/:id")
export class StaffRegistrationController {
  constructor(private readonly service: StaffRegistrationService) {}

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
 * `kindergartens/:id/…` and this route is not: the caller names their
 * kindergarten by its **ESIS institution number**, which is not its id, and
 * putting it in the path would make an unauthenticated route look like a
 * tenant-scoped one. Nest has no way to give one method in a
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
