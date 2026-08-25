import { Injectable } from "@nestjs/common";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { HealthRecordsRepository } from "../health-records/health-records.repository";
import { MealsRepository } from "./meals.repository";
import { findAllergenWarnings, type DishLike } from "./allergen-match";
import type { SaveMenuDayDto } from "./meals.dto";

@Injectable()
export class MealsService {
  constructor(
    private readonly repo: MealsRepository,
    private readonly tenants: TenantAccessService,
    private readonly health: HealthRecordsRepository,
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

  /**
   * The menu plus the allergy warnings it raises — RFP Module 2's
   * "Долоо хоногийн цэс ба анхааруулга".
   *
   * ★ Staff only, and that is a privacy decision rather than a role habit.
   *
   * The warning names *other people's children*: "Сүүтэй будаа — Ганболд
   * Батбаяр, ноцтой". A parent reading the same menu must see the dishes and
   * not the list of which classmates are allergic to what, which is medical
   * information about another family. So the plain menu endpoint stays open to
   * everyone and this one does not.
   *
   * ★★ One query for the whole kindergarten's allergies, not one per child.
   * A week of menus against a roster of hundreds would otherwise be an N+1 —
   * CLAUDE.md §3.4.
   */
  async listWithAllergenWarnings(actor: Actor, kindergartenId: string, from: string, to: string) {
    this.tenants.assertStaff(actor, kindergartenId);

    const [days, allergies] = await Promise.all([
      this.repo.findInRange(
        kindergartenId,
        new Date(`${from}T00:00:00.000Z`),
        new Date(`${to}T00:00:00.000Z`),
      ),
      this.health.listActiveAllergiesForKindergarten(kindergartenId),
    ]);

    return days.map((day) => ({
      ...day,
      // `dishes` is Json, so its shape is asserted rather than guaranteed by the
      // database — a day written before the current shape existed must not
      // crash the screen that reads it.
      warnings: findAllergenWarnings(asDishes(day.dishes), allergies),
    }));
  }

  /** Staff only. */
  async saveDay(actor: Actor, kindergartenId: string, dateIso: string, dto: SaveMenuDayDto) {
    this.tenants.assertStaff(actor, kindergartenId);
    const date = new Date(`${dateIso}T00:00:00.000Z`);
    return this.repo.upsertDay(kindergartenId, date, dto.dishes, actor.userId);
  }
}

/** Defensive read of a `Json` column: anything unexpected becomes no dishes. */
function asDishes(value: unknown): DishLike[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const dish = entry as { name?: unknown; allergenTags?: unknown };
    if (typeof dish.name !== "string") return [];

    return [
      {
        name: dish.name,
        allergenTags: Array.isArray(dish.allergenTags)
          ? dish.allergenTags.filter((tag): tag is string => typeof tag === "string")
          : [],
      },
    ];
  });
}
