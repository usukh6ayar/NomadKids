import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { Public } from "../auth/decorators/public.decorator";
import { SuperAdmin } from "../auth/decorators/super-admin.decorator";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { OnboardingService } from "./onboarding.service";
import {
  approveApplicationSchema,
  listApplicationsQuerySchema,
  rejectApplicationSchema,
  submitApplicationSchema,
  type ApproveApplicationDto,
  type ListApplicationsQuery,
  type RejectApplicationDto,
  type SubmitApplicationDto,
} from "./onboarding.dto";

const HOUR = 60 * 60 * 1000;

/**
 * The public registration form — `docs/CONTRACT_ONBOARDING.md` steps 1–2.
 *
 * ★★★ **This is the product's only unauthenticated write**, and the three
 * lines below are what make that acceptable:
 *
 *   `@Public()`        — there is no session; a kindergarten has no account yet
 *   `@RateLimit`       — five an hour from one address, because a form anyone
 *                        can post is a form a script can post ten thousand times
 *   `submitApplication`— every field bounded and shaped, no free strings
 *
 * ★★ It writes to `KindergartenApplication`, **never** to `Kindergarten`. An
 * anonymous request must not be able to create a tenant: `Kindergarten.id` is
 * the key every isolation boundary in this system is built on. A person
 * approves the application first (step 3), and only then does a tenant exist.
 *
 * ★ The response is the same whether or not the registration number is already
 * on file — see `OnboardingService.submit`. A 409 here would turn the form into
 * a way of asking which kindergartens work with this platform.
 */
@Controller("applications")
@UseGuards(RateLimitGuard)
export class ApplicationsController {
  constructor(private readonly service: OnboardingService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 5, windowMs: HOUR })
  async submit(@Body(new ZodValidationPipe(submitApplicationSchema)) body: SubmitApplicationDto) {
    return this.service.submit(body);
  }
}

/**
 * The operator's review queue — steps 3 and 4.
 *
 * ★ Mounted under `/platform`, beside the other superadmin surfaces, so the
 * route itself says who it is for. Every method calls `assertSuperAdmin`, which
 * throws **404** rather than 403 — the same discipline as child data
 * (`docs/SECURITY.md` §5.4): a 403 would confirm the queue exists.
 */
@Controller("platform/applications")
@SuperAdmin()
export class PlatformApplicationsController {
  constructor(private readonly service: OnboardingService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listApplicationsQuerySchema)) query: ListApplicationsQuery,
  ) {
    return this.service.list(actor, query);
  }

  @Get(":id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(approveApplicationSchema)) body: ApproveApplicationDto,
  ) {
    return this.service.approve(actor, params.id, body);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(rejectApplicationSchema)) body: RejectApplicationDto,
  ) {
    return this.service.reject(actor, params.id, body);
  }
}
