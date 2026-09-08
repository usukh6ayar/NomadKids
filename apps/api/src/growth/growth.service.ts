import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ageInMonths } from "@kinder/contracts";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { GrowthRepository } from "./growth.repository";
import { referenceBands } from "./growth-reference";
import type { RecordGrowthDto } from "./growth.dto";

@Injectable()
export class GrowthService {
  constructor(
    private readonly repo: GrowthRepository,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The chart — RFP §7.2.
   *
   * Returns the series, the change since the previous measurement, and the
   * reference band, in one response. Three requests would let a screen render a
   * child's line without the band that gives it meaning, or the band without
   * the disclaimer §7.2 requires beside it.
   */
  async chart(actor: Actor, childId: string, from?: string, to?: string) {
    await this.childAccess.assertCanAccess(actor, childId);

    const child = await this.repo.findChildFacts(childId);
    if (!child) throw new NotFoundException();

    const rows = await this.repo.listForChild(childId, toDate(from), toDate(to));

    /*
     * ★ The delta is computed against the previous row in the *series*, not
     * against the previous calendar month.
     *
     * RFP §7.2 asks to "өмнөх хэмжилттэй харьцуулах" — compare with the previous
     * measurement. Measurements are irregular: a term-time gap of four months is
     * ordinary, and a delta divided by an assumed interval would report a
     * growth rate nobody measured.
     */
    let previousHeight: number | null = null;
    let previousWeight: number | null = null;

    const points = rows.map((row) => {
      const heightCm = toNumber(row.heightCm);
      const weightKg = toNumber(row.weightKg);
      const ageMonths = ageInMonths(child.dateOfBirth, row.measuredOn);

      const point = {
        id: row.id,
        measuredOn: toDateOnly(row.measuredOn),
        ageMonths,
        ageYears: ageMonths / 12,
        heightCm,
        weightKg,
        headCircumferenceCm: toNumber(row.headCircumferenceCm),
        note: row.note,
        recordedBy: row.recordedBy,
        // Null on the first point, and null when the earlier row did not carry
        // this quantity — "+0.0 cm" against a measurement nobody took is a
        // fabricated fact.
        heightChangeCm: delta(previousHeight, heightCm),
        weightChangeKg: delta(previousWeight, weightKg),
      };

      if (heightCm !== null) previousHeight = heightCm;
      if (weightKg !== null) previousWeight = weightKg;

      return point;
    });

    return {
      points,
      /*
       * Null when the child's sex is unknown — `referenceBands` refuses to pick
       * one. A chart without a reference line is honest; a chart with the wrong
       * one is not. The source and the "not a medical diagnosis" notice travel
       * inside this object, so the UI cannot render the band without them.
       */
      reference: referenceBands(child.sex),
    };
  }

  /**
   * Records or updates one measurement for one day.
   *
   * ★ Guardians may write, and that is RFP §2.3 in as many words: "Өсөлтийн
   * мэдээлэл оруулах" is listed under what a parent does. So this uses the same
   * predicate as the photo album rather than `assertCanRecord`, which is the
   * staff-only check that governs observations and assessments. A family
   * measuring their child at home is the ordinary case, not an intrusion.
   *
   * `recordedById` is taken from the authenticated actor, never from the body,
   * so a measurement is always attributable to whoever actually entered it.
   */
  async record(actor: Actor, childId: string, dateIso: string, dto: RecordGrowthDto) {
    const facts = await this.childAccess.assertCanContributeMedia(actor, childId);

    const measuredOn = new Date(`${dateIso}T00:00:00.000Z`);
    const child = await this.repo.findChildFacts(childId);
    if (!child) throw new NotFoundException();

    // A future measurement is a typo — nobody has measured tomorrow.
    if (measuredOn.getTime() > Date.now()) {
      throw new BadRequestException("Хэмжилтийн огноо ирээдүйд байж болохгүй");
    }
    // Before the child was born is the other end of the same mistake.
    if (measuredOn < startOfDay(child.dateOfBirth)) {
      throw new BadRequestException("Хэмжилтийн огноо төрсөн өдрөөс өмнө байж болохгүй");
    }

    const saved = await this.repo.record({
      childId,
      kindergartenId: facts.childKindergartenId,
      measuredOn,
      heightCm: dto.heightCm ?? null,
      weightKg: dto.weightKg ?? null,
      headCircumferenceCm: dto.headCircumferenceCm ?? null,
      note: dto.note ?? null,
      recordedById: actor.userId,
    });

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "GrowthMeasurement",
      objectId: saved.id,
      childId,
      metadata: { measuredOn: dateIso, byGuardian: isGuardianOf(actor, facts) },
    });

    return saved;
  }

  /**
   * Soft-deletes a measurement — CLAUDE.md §3.2.
   *
   * ★ Staff only, unlike the write path.
   *
   * A guardian adding a measurement adds a fact; removing one edits the record
   * a kindergarten keeps, and a wrong value is corrected by writing the day
   * again rather than by deleting it. This matches the album, where a family may
   * contribute a photograph and may not delete one.
   */
  async remove(actor: Actor, id: string) {
    const measurement = await this.repo.findById(id);
    if (!measurement) throw new NotFoundException();

    await this.childAccess.assertCanRecord(actor, measurement.childId);
    await this.repo.softDelete(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: measurement.kindergartenId,
      actorUserId: actor.userId,
      objectType: "GrowthMeasurement",
      objectId: id,
      childId: measurement.childId,
    });

    return { id };
  }
}

/**
 * Prisma returns `Decimal` for these columns; JSON.stringify would render it as
 * an object. A number is what a chart plots.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function delta(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null) return null;
  // One decimal place: the measurements themselves carry one, and floating
  // point subtraction otherwise produces 1.7999999999999998.
  return Math.round((current - previous) * 10) / 10;
}

function toDate(iso?: string): Date | undefined {
  return iso ? new Date(`${iso}T00:00:00.000Z`) : undefined;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0),
  );
}
