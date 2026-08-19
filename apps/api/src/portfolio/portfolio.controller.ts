import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { PortfolioService } from "./portfolio.service";
import {
  ageParamSchema,
  updateAboutMeSchema,
  updateAgeProfileSchema,
  updateBirthdayNoteSchema,
  type AgeParams,
  type UpdateAboutMeDto,
  type UpdateAgeProfileDto,
  type UpdateBirthdayNoteDto,
} from "./portfolio.dto";

/**
 * Portfolio routes.
 *
 * No `@Roles` on any of them: every role has children whose portfolio they may
 * reach, and which children is decided by `ChildAccessService`, not by role.
 * Adding a role gate here would be redundant at best and wrong at worst — it
 * would exclude a teacher acting as their own child's parent.
 */
@Controller("children/:id")
export class PortfolioController {
  constructor(private readonly service: PortfolioService) {}

  /** "What is in this child's portfolio?" — presence and counts, not content. */
  @Get("portfolio")
  async overview(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.getOverview(actor, params.id);
  }

  @Get("about-me")
  async getAboutMe(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.getAboutMe(actor, params.id);
  }

  @Patch("about-me")
  async updateAboutMe(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateAboutMeSchema)) body: UpdateAboutMeDto,
  ) {
    return this.service.updateAboutMe(actor, params.id, body);
  }

  @Get("age-profiles")
  async listAgeProfiles(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listAgeProfiles(actor, params.id);
  }

  @Get("age-profiles/:age")
  async getAgeProfile(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(ageParamSchema)) params: AgeParams,
  ) {
    return this.service.getAgeProfile(actor, params.id, params.age);
  }

  /** Field-level write rules apply here — see PortfolioService. */
  @Patch("age-profiles/:age")
  async updateAgeProfile(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(ageParamSchema)) params: AgeParams,
    @Body(new ZodValidationPipe(updateAgeProfileSchema)) body: UpdateAgeProfileDto,
  ) {
    return this.service.updateAgeProfile(actor, params.id, params.age, body);
  }

  @Get("birthday-notes")
  async listBirthdayNotes(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listBirthdayNotes(actor, params.id);
  }

  @Patch("birthday-notes/:age")
  async updateBirthdayNote(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(ageParamSchema)) params: AgeParams,
    @Body(new ZodValidationPipe(updateBirthdayNoteSchema)) body: UpdateBirthdayNoteDto,
  ) {
    return this.service.updateBirthdayNote(actor, params.id, params.age, body);
  }
}
