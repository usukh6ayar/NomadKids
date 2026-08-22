import { Module } from "@nestjs/common";
import {
  AssessmentLevelsController,
  DevelopmentDomainsController,
  KindergartenCatalogController,
  ObservationTypesController,
} from "./catalog.controller";
import { CatalogRepository } from "./catalog.repository";
import { CatalogService } from "./catalog.service";

/**
 * Administrator-editable configuration: development domains, assessment levels
 * and observation types.
 *
 * A module of its own rather than more surface on `AssessmentModule` and
 * `ObservationsModule`, because the audience is different. Those two serve
 * teachers and families reading active configuration while they record; this
 * one serves an administrator changing it, sees deactivated rows, and is gated
 * on ADMIN throughout. Splitting them keeps the hot read path free of the
 * management concerns.
 */
@Module({
  controllers: [
    KindergartenCatalogController,
    DevelopmentDomainsController,
    AssessmentLevelsController,
    ObservationTypesController,
  ],
  providers: [CatalogService, CatalogRepository],
  exports: [CatalogService],
})
export class CatalogModule {}
