import { Injectable } from "@nestjs/common";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { MealsRepository } from "./meals.repository";
import type { SaveMenuDayDto } from "./meals.dto";

@Injectable()
export class MealsService {
  constructor(
    private readonly repo: MealsRepository,
    private readonly tenants: TenantAccessService,
  ) {}

  /** Every role reads this — a parent's screen shows the same menu a
   * teacher does, same reasoning as `AssessmentService.listConfig`. */
  async listForKindergarten(actor: Actor, kindergartenId: string, from: string, to: string) {
    this.tenants.assertMember(actor, kindergartenId);
    return this.repo.findInRange(
      kindergartenId,
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${to}T00:00:00.000Z`),
    );
  }

  /** Staff only. */
  async saveDay(actor: Actor, kindergartenId: string, dateIso: string, dto: SaveMenuDayDto) {
    this.tenants.assertStaff(actor, kindergartenId);
    const date = new Date(`${dateIso}T00:00:00.000Z`);
    return this.repo.upsertDay(kindergartenId, date, dto.dishes, actor.userId);
  }
}
