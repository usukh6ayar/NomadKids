import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { HealthRecordsService } from "./health-records.service";
import {
  createAllergySchema,
  createMedicationSchema,
  createSpecialNeedSchema,
  createVaccinationSchema,
  updateAllergySchema,
  updateSpecialNeedSchema,
  type CreateAllergyDto,
  type CreateMedicationDto,
  type CreateSpecialNeedDto,
  type CreateVaccinationDto,
  type UpdateAllergyDto,
  type UpdateSpecialNeedDto,
} from "./health-records.dto";

/**
 * A child's health record — RFP Module 2.
 *
 * ★ One GET for all three kinds plus the free-text note.
 *
 * The child's header renders a red allergy badge and a medication reminder from
 * this response. Fetching them separately would show the badge a beat before or
 * after the record it belongs to — on a slow connection, long enough to serve
 * the wrong lunch.
 */
@Controller("children/:id/health")
export class ChildHealthController {
  constructor(private readonly service: HealthRecordsService) {}

  @Get()
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  /** Staff only — an allergy flag is an instruction other people act on. */
  @Post("allergies")
  @Roles("TEACHER", "ADMIN")
  async createAllergy(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createAllergySchema)) body: CreateAllergyDto,
  ) {
    return this.service.createAllergy(actor, params.id, body);
  }

  /*
   * No `@Roles`: a guardian authorises medication for their own child, which is
   * RFP Module 2's whole point. The service decides.
   */
  @Post("medications")
  async createMedication(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createMedicationSchema)) body: CreateMedicationDto,
  ) {
    return this.service.createMedication(actor, params.id, body);
  }

  /**
   * The categories this child may be filed under — Order А/261, criterion 11.
   *
   * ★ Hung off the child rather than the kindergarten, unlike the other
   * reference lists in `catalog.controller.ts`. Those are an administrator
   * editing configuration; this is the picker on the health screen, and the
   * caller there has a child id and no reason to know a kindergarten id.
   */
  @Get("special-needs/categories")
  @Roles("TEACHER", "ADMIN")
  async listSpecialNeedsCategories(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listSpecialNeedsCategories(actor, params.id);
  }

  /** Staff only — a classification is something other people act on. */
  @Post("special-needs")
  @Roles("TEACHER", "ADMIN")
  async createSpecialNeed(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createSpecialNeedSchema)) body: CreateSpecialNeedDto,
  ) {
    return this.service.createSpecialNeed(actor, params.id, body);
  }

  @Post("vaccinations")
  @Roles("TEACHER", "ADMIN")
  async createVaccination(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createVaccinationSchema)) body: CreateVaccinationDto,
  ) {
    return this.service.createVaccination(actor, params.id, body);
  }
}

@Controller()
export class HealthRecordsController {
  constructor(private readonly service: HealthRecordsService) {}

  @Patch("allergies/:id")
  @Roles("TEACHER", "ADMIN")
  async updateAllergy(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateAllergySchema)) body: UpdateAllergyDto,
  ) {
    return this.service.updateAllergy(actor, params.id, body);
  }

  @Delete("allergies/:id")
  @Roles("TEACHER", "ADMIN")
  async removeAllergy(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.removeAllergy(actor, params.id);
  }

  @Patch("special-needs/:id")
  @Roles("TEACHER", "ADMIN")
  async updateSpecialNeed(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateSpecialNeedSchema)) body: UpdateSpecialNeedDto,
  ) {
    return this.service.updateSpecialNeed(actor, params.id, body);
  }

  @Delete("special-needs/:id")
  @Roles("TEACHER", "ADMIN")
  async removeSpecialNeed(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.removeSpecialNeed(actor, params.id);
  }

  /** The guardian who authorised it, or staff — see the service. */
  @Delete("medications/:id")
  async removeMedication(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.removeMedication(actor, params.id);
  }

  @Delete("vaccinations/:id")
  @Roles("TEACHER", "ADMIN")
  async removeVaccination(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.removeVaccination(actor, params.id);
  }
}
