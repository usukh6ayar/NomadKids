import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import type { MealKind } from "../domain/enums";
import { HealthRecordsRepository } from "../health-records/health-records.repository";
import { MealsRepository } from "./meals.repository";
import { findAllergenWarnings, type DishLike } from "./allergen-match";
import type { RecordGroupMealsDto, SaveMenuDayDto } from "./meals.dto";

@Injectable()
export class MealsService {
  constructor(
    private readonly repo: MealsRepository,
    private readonly tenants: TenantAccessService,
    private readonly health: HealthRecordsRepository,
    private readonly childAccess: ChildAccessService,
    private readonly authz: AuthzRepository,
    private readonly audit: AuditRepository,
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
    return this.repo.upsertDay(
      kindergartenId,
      date,
      dto.dishes,
      dto.totalCalories ?? null,
      actor.userId,
    );
  }

  // ── The meal register — нэмэлт.md §2 ───────────────────────────────────────

  /**
   * A group's sitting for one day — everyone enrolled, marked or not.
   *
   * ★ Staff only, and a group a teacher is actually assigned to. Membership of
   * the kindergarten is not enough — the same check the attendance day sheet
   * makes, for the same reason.
   */
  async groupMealSheet(actor: Actor, groupId: string, dateIso: string, kind: MealKind) {
    const group = await this.repo.findGroupForMeals(
      groupId,
      this.tenants.memberKindergartenIds(actor),
    );
    if (!group) throw new NotFoundException();
    this.tenants.assertStaff(actor, group.kindergartenId);

    if (!this.tenants.isAdmin(actor, group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(groupId)) throw new NotFoundException();
    }

    const date = toDate(dateIso);
    const { enrollments, records } = await this.repo.groupMealSheet(groupId, date, kind);
    const byEnrollment = new Map(records.map((r) => [r.enrollmentId, r]));

    return enrollments.map((enrollment) => ({
      child: enrollment.child,
      enrollmentId: enrollment.id,
      record: byEnrollment.get(enrollment.id) ?? null,
    }));
  }

  /**
   * Records a whole sitting — §2's fast one-screen entry.
   *
   * ★ A child not enrolled in this group is dropped, not an error.
   *
   * The client sends the roster it was given; between the sheet loading and the
   * teacher pressing save, a child may have transferred. Failing the whole
   * batch for one stale row would lose nineteen correct marks — and silently
   * writing the row would attribute a meal to the wrong group's register, which
   * §3 then bills to the wrong kindergarten.
   */
  async recordGroupMeals(actor: Actor, groupId: string, dto: RecordGroupMealsDto) {
    const group = await this.repo.findGroupForMeals(
      groupId,
      this.tenants.memberKindergartenIds(actor),
    );
    if (!group) throw new NotFoundException();
    this.tenants.assertStaff(actor, group.kindergartenId);

    /*
      ★ The same assignment check `groupMealSheet` makes, and it was missing
      here until 2026-08-27.

      The read was guarded and the write was not, so a teacher assigned to one
      group could record meals for any other group in their kindergarten —
      rows that §3 turns into that group's food cost. A write is strictly more
      privileged than the read beside it, so this was an omission rather than a
      decision: `AssessmentService.saveGroupColumn`, the closest sibling and the
      same shape of group-scoped batch write, has carried it on both paths from
      the start.

      It sits *before* the date validation deliberately. Validating first would
      answer an unassigned teacher with 400 for a future date and 404 otherwise,
      which is exactly the oracle CLAUDE.md §1.7 closes — the response must not
      reveal that the group exists.
    */
    if (!this.tenants.isAdmin(actor, group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(groupId)) throw new NotFoundException();
    }

    const date = toDate(dto.date);
    if (date.getTime() > Date.now()) {
      throw new BadRequestException("Хоолны огноо ирээдүйд байж болохгүй");
    }

    const { enrollments } = await this.repo.groupMealSheet(groupId, date, dto.kind);
    const byChild = new Map(enrollments.map((e) => [e.childId, e.id]));

    const rows = dto.entries.flatMap((entry) => {
      const enrollmentId = byChild.get(entry.childId);
      if (!enrollmentId) return [];

      return [
        {
          kindergartenId: group.kindergartenId,
          childId: entry.childId,
          enrollmentId,
          date,
          kind: dto.kind,
          status: entry.status,
          note: entry.note ?? null,
          recordedById: actor.userId,
        },
      ];
    });

    if (rows.length === 0) throw new BadRequestException("Бүртгэх хүүхэд олдсонгүй");

    const saved = await this.repo.recordGroupMeals(rows);

    // §14 asks for a financial audit trail, and the meal register feeds the
    // food-cost calculation — one row for the sitting rather than one per
    // child, which is the act a teacher actually performed.
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: group.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MealRecord",
      objectId: groupId,
      metadata: { date: dto.date, kind: dto.kind, count: saved.length },
    });

    return saved;
  }

  /** A child's month, by sitting and status — the input to нэмэлт.md §3. */
  async childMealSummary(actor: Actor, childId: string, month: string) {
    await this.childAccess.assertCanAccess(actor, childId);

    const [year, monthNum] = month.split("-").map(Number) as [number, number];
    const from = new Date(Date.UTC(year, monthNum - 1, 1));
    const to = new Date(Date.UTC(year, monthNum, 0));

    const { counts, daysFed } = await this.repo.monthlyMealCounts(childId, from, to);

    return {
      month,
      counts,
      /*
       * The figure §3 multiplies — distinct dates on which the child ate
       * something, never a count of sittings.
       *
       * ★ This used to sum `counts`, which was wrong by however many meals a
       * kindergarten serves: `MealRecord` is one row per sitting, so a child
       * fed breakfast, lunch and a snack scored three "days" for one day.
       * `нэмэлт.md` says "хооллосон **өдөр**" and §6 reports it beside "ирсэн
       * **өдөр**"; both are days. The repository now counts distinct dates.
       *
       * `PARTIAL` and `SPECIAL` still count as fed and `NOT_TAKEN` still does
       * not — the status meanings are unchanged, only the unit. A tariff that
       * prices them differently reads `counts`, which is why that breakdown
       * stays.
       */
      daysFed,
    };
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
/** `YYYY-MM-DD` to the UTC midnight `@db.Date` stores. */
function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
