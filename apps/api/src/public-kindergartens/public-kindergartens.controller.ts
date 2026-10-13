import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { publicKindergartensQuerySchema, type PublicKindergartensQuery } from "@kinder/contracts";
import { Public } from "../auth/decorators/public.decorator";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PublicKindergartensService } from "./public-kindergartens.service";

const HOUR = 60 * 60 * 1000;

/**
 * «Цэцэрлэгээр» on the staff sign-up: district → kindergarten → register
 * number (#211). Public — the person has no account yet.
 *
 * ★ Names a contracted kindergarten already shows on its own gate. The
 * register-number check behind it is unchanged and keeps its one refusal.
 * Sixty an hour from one address: a person changes district a few times,
 * a scraper wants every district at once.
 */
@Controller("public/kindergartens")
@UseGuards(RateLimitGuard)
export class PublicKindergartensController {
  constructor(private readonly service: PublicKindergartensService) {}

  @Public()
  @Get()
  @RateLimit({ limit: 60, windowMs: HOUR })
  list(
    @Query(new ZodValidationPipe(publicKindergartensQuerySchema)) query: PublicKindergartensQuery,
  ) {
    return this.service.listInLocation(query.location);
  }
}
