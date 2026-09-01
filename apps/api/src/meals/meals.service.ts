import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import type { MealKind } from "../domain/enums";
import { HealthRecordsRepository } from "../health-records/health-records.repository";
import { KitchenService } from "../kitchen/kitchen.service";
import { MediaService } from "../media/media.service";
import { parseDishes, type MenuDishLike } from "./dish-json";
import { MealsRepository } from "./meals.repository";
import { findAllergenWarnings } from "./allergen-match";
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
    private readonly kitchen: KitchenService,
    private readonly media: MediaService,
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
    /*
      ★ The cook, as of 2026-08-30 — this is the screen the role exists for.

      The warnings name which children react to what, which is medical
      information about a family and the reason this is a separate route from
      the plain menu. A cook decides what goes in the pot, so they are exactly
      who needs it; withholding it would leave the one person who can act on an
      allergy unable to see it.
    */
    this.tenants.assertCanManageMeals(actor, kindergartenId);

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
      warnings: findAllergenWarnings(parseDishes(day.dishes), allergies),
    }));
  }

  /**
   * Staff only. Writing the weekly menu is the cook's own work; the teacher
   * keeps it too — they serve it and answer for it when a parent asks.
   *
   * ★ A dish carrying `recipeId` has its name/allergens/calories **frozen**
   * from the (APPROVED) recipe here, not trusted from the client and not
   * resolved live on every later read — same reasoning as `Invoice`'s frozen
   * amount columns: what a family reads about a day already served must not
   * change because someone edited the recipe afterwards. `Recipe` stays the
   * live document; `MenuDay.dishes` is a dated snapshot of it.
   *
   * Refuses once the day has been consumed (`consumedAt` set) — the stock
   * ledger has already been written against this plan, and editing it after
   * the fact would leave the two silently disagreeing. A correction at that
   * point is a stock `ADJUSTMENT`, not a rewritten plan.
   */
  async saveDay(actor: Actor, kindergartenId: string, dateIso: string, dto: SaveMenuDayDto) {
    this.tenants.assertCanManageMeals(actor, kindergartenId);
    const date = new Date(`${dateIso}T00:00:00.000Z`);

    const existing = await this.repo.findDayState(kindergartenId, date);
    if (existing?.consumedAt) {
      throw new BadRequestException("Энэ өдрийг хэрэглээнд бүртгэсэн тул цэсийг өөрчлөх боломжгүй");
    }

    const dishes = await Promise.all(
      dto.dishes.map(async (dish) => {
        // ★ A photo id must be this kindergarten's own MENU_DISH upload —
        // never trusted just because the client sent a well-formed uuid.
        // Without this a cook could paste any media id (a private child
        // photo, another kindergarten's file) into a dish, and it would sit
        // on the plain menu every family in this kindergarten reads.
        if (dish.photoMediaFileId) {
          const ok = await this.media.isMenuDishPhoto(kindergartenId, dish.photoMediaFileId);
          if (!ok) throw new BadRequestException("Хоолны зураг олдсонгүй");
        }

        if (!dish.recipeId) return dish;
        const resolved = await this.kitchen.resolveApprovedRecipeForDish(
          kindergartenId,
          dish.recipeId,
        );
        return {
          ...dish,
          name: resolved.name,
          allergenTags: resolved.allergenTags,
          calories: resolved.calories,
        };
      }),
    );

    return this.repo.upsertDay(
      kindergartenId,
      date,
      dishes,
      dto.totalCalories ?? null,
      actor.userId,
    );
  }

  /**
   * Батлагдсан цэс — signing a planned day off. COOK/ADMIN only
   * (`assertCanManageKitchen`), narrower than `saveDay`: a teacher serves and
   * marks the register, but approving what the kitchen is about to cook is
   * the kitchen's own act.
   */
  async approveDay(actor: Actor, kindergartenId: string, dateIso: string) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    const date = new Date(`${dateIso}T00:00:00.000Z`);

    const day = await this.repo.findDayState(kindergartenId, date);
    if (!day) throw new NotFoundException();
    if (day.status === "APPROVED") return day;

    const saved = await this.repo.approveDay(day.id, actor.userId);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "MenuDay",
      objectId: day.id,
      metadata: { approved: true, date: dateIso },
    });

    return saved;
  }

  /**
   * Зарцуулалт — deducts this day's cooking from stock, one `StockMovement`
   * OUT per ingredient.
   *
   * ★ `dish.portions` is a **batch multiplier**, not a headcount.
   *
   * `menuDishInputSchema.portions` predates recipes and caps at 10 — a real
   * ceiling for "how many portions is this one plate" but not for "how many
   * children ate it". Rather than widen a field whose existing tests already
   * pin its meaning (`meals.test.ts`), a recipe-linked dish reuses it as *how
   * many times the card's batch was cooked*: a technology card already states
   * how many children one batch feeds (`yieldPortions`), so a kindergarten of
   * eighty children against a card written for twenty is `portions: 4`, still
   * comfortably under the cap. Ingredient deduction is therefore `quantity ×
   * portions` directly — no division.
   *
   * §7's own explicit scope cut: this reads the *planned* batches on the
   * menu, not `MealRecord` attendance — see the plan doc.
   *
   * A dish whose recipe has since been deleted is skipped rather than
   * failing the whole call — its frozen name/allergens/calories are still
   * correct; only the ingredient it would have deducted is unknown now.
   */
  async consumeDay(actor: Actor, kindergartenId: string, dateIso: string) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    const date = new Date(`${dateIso}T00:00:00.000Z`);

    const day = await this.repo.findDay(kindergartenId, date);
    if (!day) throw new NotFoundException();
    if (day.status !== "APPROVED") {
      throw new BadRequestException("Эхлээд өдрийн цэсийг батлана уу");
    }
    if (day.consumedAt) {
      throw new BadRequestException("Энэ өдрийг хэрэглээнд аль хэдийн бүртгэсэн байна");
    }

    const dishes = parseDishes(day.dishes).filter(
      (dish): dish is MenuDishLike & { recipeId: string; portions: number } =>
        Boolean(dish.recipeId) && Boolean(dish.portions) && (dish.portions ?? 0) > 0,
    );
    if (dishes.length === 0) {
      throw new BadRequestException("Технологийн картаар холбогдсон, порц бүхий хоол алга");
    }

    const deductions = new Map<string, number>();
    for (const dish of dishes) {
      const recipe = await this.kitchen.getRecipeIngredientLines(kindergartenId, dish.recipeId);
      if (!recipe) continue;

      for (const line of recipe.lines) {
        deductions.set(
          line.ingredientId,
          (deductions.get(line.ingredientId) ?? 0) + line.quantity * dish.portions,
        );
      }
    }

    if (deductions.size === 0) {
      throw new BadRequestException("Энэ өдрийн технологийн картууд олдсонгүй");
    }

    await this.kitchen.consumeForMenuDay(
      kindergartenId,
      day.id,
      actor.userId,
      date,
      deductions,
      `Цэс — ${dateIso}`,
    );

    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "MenuDay",
      objectId: day.id,
      metadata: { consumed: true, date: dateIso, ingredientCount: deductions.size },
    });

    return { id: day.id, ingredientCount: deductions.size };
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
    /*
      ★ Still `assertStaff` — the cook does not read this one.

      The group register names individual children and what each of them ate.
      A cook cooks for a count, not for a named child, and the client's own
      line was to grant no more than the role needs: "шинээр хэт их эрх
      олгохгүй". The kindergarten-wide menu is the kitchen's screen; this is the
      teacher's register and it is child data.
    */
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

/** `YYYY-MM-DD` to the UTC midnight `@db.Date` stores. */
function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
