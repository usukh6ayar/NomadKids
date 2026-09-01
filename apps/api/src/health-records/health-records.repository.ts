import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Allergies, medication authorisations and vaccinations — RFP Module 2.
 *
 * One repository for three tables because they are one screen and one
 * authorization decision: a caller who may see a child's allergies may see
 * their medication too. Splitting them into three repositories would triple the
 * boilerplate to express a distinction nobody makes.
 */
@Injectable()
export class HealthRecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly person = { select: { id: true, lastName: true, firstName: true } };

  /**
   * The whole health picture for one child, in one round trip.
   *
   * ★ `healthNotes` comes from `Child` in the same call.
   *
   * RFP §3.4's free-text note and these three tables answer the same question
   * on the same screen, and a teacher who saw the structured allergies without
   * the note — or the reverse — would be missing half of what a family told
   * the kindergarten.
   */
  async loadForChild(childId: string) {
    const [child, allergies, medications, vaccinations] = await Promise.all([
      this.prisma.child.findFirst({
        where: { id: childId, deletedAt: null },
        select: { id: true, healthNotes: true },
      }),
      this.prisma.allergyRecord.findMany({
        where: { childId, deletedAt: null },
        // Severe first: a teacher scanning this list before lunch should meet
        // anaphylaxis before a mild pollen reaction, whatever the dates.
        orderBy: [{ endedOn: { sort: "asc", nulls: "first" } }, { severity: "desc" }],
        include: { recordedBy: this.person },
      }),
      this.prisma.medicationAuthorisation.findMany({
        where: { childId, deletedAt: null },
        orderBy: { endsOn: "desc" },
        include: { authorisedBy: this.person },
      }),
      this.prisma.vaccinationRecord.findMany({
        where: { childId, deletedAt: null },
        orderBy: { administeredOn: "desc" },
        include: { recordedBy: this.person },
      }),
    ]);

    return { child, allergies, medications, vaccinations };
  }

  /**
   * Every live allergy in a kindergarten, keyed by child — what the menu
   * cross-check reads.
   *
   * ★ One query for the whole kindergarten, not one per child.
   *
   * The alternative is an N+1 across a roster of hundreds on a screen that
   * renders a week of menus (CLAUDE.md §3.4). The index
   * `(kindergartenId, endedOn)` serves this directly, and the result is small:
   * most children have no allergies at all.
   */
  async listActiveAllergiesForKindergarten(kindergartenId: string) {
    return this.prisma.allergyRecord.findMany({
      // ★ `kind: "FOOD"` — a menu cross-check has no business reading a
      // MEDICATION or ENVIRONMENTAL record. `AllergyLike` doesn't even carry
      // `kind` through to `allergenMatches`, so before this filter a child's
      // "пенициллин" or "тоос" allergy was compared against dish tags on
      // exactly the same footing as an actual food allergy — noise at best,
      // and the kind of warning that teaches a cook to stop reading them.
      where: { kindergartenId, deletedAt: null, endedOn: null, kind: "FOOD" },
      select: {
        id: true,
        childId: true,
        allergen: true,
        severity: true,
        kind: true,
        child: { select: { id: true, lastName: true, firstName: true } },
      },
    });
  }

  // ── Allergies ──────────────────────────────────────────────────────────────

  async createAllergy(data: Record<string, unknown>) {
    return this.prisma.allergyRecord.create({
      data: data as never,
      include: { recordedBy: this.person },
    });
  }

  async findAllergy(id: string) {
    return this.prisma.allergyRecord.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, childId: true, kindergartenId: true },
    });
  }

  async updateAllergy(id: string, data: Record<string, unknown>) {
    return this.prisma.allergyRecord.update({
      where: { id },
      data,
      include: { recordedBy: this.person },
    });
  }

  async softDeleteAllergy(id: string) {
    return this.prisma.allergyRecord.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Medication ─────────────────────────────────────────────────────────────

  async createMedication(data: Record<string, unknown>) {
    return this.prisma.medicationAuthorisation.create({
      data: data as never,
      include: { authorisedBy: this.person },
    });
  }

  async findMedication(id: string) {
    return this.prisma.medicationAuthorisation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, childId: true, kindergartenId: true, authorisedById: true },
    });
  }

  async softDeleteMedication(id: string) {
    return this.prisma.medicationAuthorisation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Vaccination ────────────────────────────────────────────────────────────

  async createVaccination(data: Record<string, unknown>) {
    return this.prisma.vaccinationRecord.create({
      data: data as never,
      include: { recordedBy: this.person },
    });
  }

  async findVaccination(id: string) {
    return this.prisma.vaccinationRecord.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, childId: true, kindergartenId: true },
    });
  }

  async softDeleteVaccination(id: string) {
    return this.prisma.vaccinationRecord.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
